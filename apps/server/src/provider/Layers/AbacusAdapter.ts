// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off cryptoRandomUUID:off cryptoRandomUUIDInEffect:off globalDate:off globalTimersInEffect:off unknownInEffectCatch:off anyUnknownInErrorContext:off
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  type CanonicalItemType,
  EventId,
  ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  RuntimeItemId,
  type ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";

const PROVIDER = ProviderDriverKind.make("abacus");
const MAX_BUFFER = 1024 * 1024;
const MAX_TURN_STEPS = 20;
export const MAX_TOOL_OUTPUT_BYTES = 30 * 1024;
export const MAX_HEAD_LINES = 200;
export const MAX_TAIL_LINES = 300;

type Fetch = typeof globalThis.fetch;

export interface ToolCall {
  readonly id: string;
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
}

export type AbacusMessage =
  | { readonly role: "system"; readonly content: string }
  | { readonly role: "user"; readonly content: string }
  | {
      readonly role: "assistant";
      readonly content: string | null;
      readonly tool_calls?: ReadonlyArray<ToolCall>;
    }
  | { readonly role: "tool"; readonly tool_call_id: string; readonly content: string };

type Active = {
  readonly turnId: TurnId;
  readonly controller: AbortController;
  currentProcess?: childProcess.ChildProcess | undefined;
  cancelled: boolean;
  settled: boolean;
};

type Context = {
  session: ProviderSession;
  readonly messages: AbacusMessage[];
  active?: Active | undefined;
};

export interface AbacusAdapterOptions {
  readonly apiBaseUrl: string;
  readonly apiKey: string;
  readonly defaultModel: string;
  readonly instanceId: ProviderInstanceId;
  readonly fetch?: Fetch;
  readonly requestTimeoutMs?: number;
}

export const ABACUS_AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read the contents of a file. Specify path (relative to workspace or absolute). Optionally specify start_line and end_line (1-indexed).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file to read" },
          start_line: {
            type: "integer",
            description: "Optional starting line number (1-indexed)",
          },
          end_line: {
            type: "integer",
            description: "Optional ending line number (1-indexed)",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create a new file or completely overwrite an existing file in the workspace.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the file to write (must be inside workspace)",
          },
          content: {
            type: "string",
            description: "The complete content to write into the file",
          },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description:
        "Make targeted modifications to an existing file in the workspace by replacing an exact string match (old_string) with new content (new_string).",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the file to edit (must be inside workspace)",
          },
          old_string: {
            type: "string",
            description: "The exact existing text chunk to find and replace",
          },
          new_string: {
            type: "string",
            description: "The replacement text",
          },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description:
        "List files and directories in a given path. Path can be relative to workspace or absolute. Defaults to current workspace directory.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Directory path to list. Defaults to workspace root if empty or omitted.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "execute_command",
      description: "Execute a shell command in the workspace directory. Subject to a 60s timeout.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The shell command to execute",
          },
        },
        required: ["command"],
      },
    },
  },
] as const;

export const DANGEROUS_PATTERNS: ReadonlyArray<RegExp> = [
  /\bsudo\b/i,
  /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+[\/~]/i,
  /\brm\s+-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*\s+[\/~]/i,
  /\bcurl\b.*\|\s*(ba)?sh\b/i,
  /\bwget\b.*\|\s*(ba)?sh\b/i,
  /\bgit\s+push\s+.*(-f|--force)\b/i,
  /\bgit\s+clean\s+.*-f[a-zA-Z]*x/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
];

export function checkCommandSafety(command: string): string | null {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return `Command blocked by safety filter: matched forbidden pattern (${pattern.source})`;
    }
  }
  return null;
}

export function resolvePath(filePath: string, cwd: string): string {
  if (path.isAbsolute(filePath)) {
    return path.normalize(filePath);
  }
  return path.normalize(path.resolve(cwd, filePath));
}

export function isInsideWorkspace(targetPath: string, workspaceDir: string): boolean {
  const rel = path.relative(path.resolve(workspaceDir), path.resolve(targetPath));
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function truncateToolOutput(output: string): string {
  const lines = output.split("\n");
  if (lines.length > MAX_HEAD_LINES + MAX_TAIL_LINES) {
    const head = lines.slice(0, MAX_HEAD_LINES).join("\n");
    const tail = lines.slice(-MAX_TAIL_LINES).join("\n");
    const omitted = lines.length - (MAX_HEAD_LINES + MAX_TAIL_LINES);
    return `${head}\n\n[... ${omitted} lines truncated ...]\n\n${tail}`;
  }
  if (Buffer.byteLength(output, "utf-8") > MAX_TOOL_OUTPUT_BYTES) {
    const half = Math.floor(MAX_TOOL_OUTPUT_BYTES / 2);
    const head = output.slice(0, half);
    const tail = output.slice(-half);
    return `${head}\n\n[... output truncated ...]\n\n${tail}`;
  }
  return output;
}

export function buildAbacusSystemPrompt(workspaceDir: string, model: string): string {
  return `You are an expert AI software engineering agent working in T3 Code on macOS.
The active workspace directory is: ${workspaceDir}

You have access to tools to inspect and modify this workspace:
- read_file: Read the contents of a file (supports optional line numbers).
- edit_file: Make targeted modifications to an existing file in the workspace by replacing an exact string match (old_string) with (new_string).
- write_file: Create a new file or completely overwrite a file in the workspace.
- list_directory: List files and folders in a directory.
- execute_command: Run a shell command in the workspace directory (subject to a 60s timeout).

Rules and Guidelines:
1. Always inspect relevant files before modifying them or answering complex codebase questions.
2. When editing existing files, prefer edit_file with precise exact-match replacements rather than overwriting full files with write_file.
3. All writes must remain within the workspace directory.
4. Shell commands are executed non-interactively in the workspace root. Never run interactive programs (e.g. vim, nano), continuous background daemons, or destructive system commands.
5. If a command or file read produces extensive output, rely on the summary and inspect specific sections as needed.
6. When your work is complete, provide a concise summary of the changes made and any verification performed.

<runtime_info>In case you're asked: you are running in T3 Code through the ChatLLM harness, as ${model}. No need to mention this otherwise. You can embed images and videos in your response using Markdown with absolute file paths.</runtime_info>`;
}

export function handleReadFile(
  args: { path: string; start_line?: number; end_line?: number },
  cwd: string,
): string {
  const target = resolvePath(args.path, cwd);
  if (!fs.existsSync(target)) {
    return `Error: File not found: ${args.path}`;
  }
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    return `Error: Path is a directory, not a file: ${args.path}`;
  }
  const content = fs.readFileSync(target, "utf-8");
  if (args.start_line !== undefined || args.end_line !== undefined) {
    const allLines = content.split("\n");
    const start = Math.max(1, args.start_line ?? 1);
    const end = Math.min(allLines.length, args.end_line ?? allLines.length);
    const selected = allLines.slice(start - 1, end);
    return selected.map((line, idx) => `${start + idx} | ${line}`).join("\n");
  }
  return content;
}

export function handleWriteFile(args: { path: string; content: string }, cwd: string): string {
  const target = resolvePath(args.path, cwd);
  if (!isInsideWorkspace(target, cwd)) {
    return "Access denied: Write operations are only permitted inside the workspace directory.";
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, args.content, "utf-8");
  return `Successfully wrote ${Buffer.byteLength(args.content, "utf-8")} bytes to ${args.path}`;
}

export function handleEditFile(
  args: { path: string; old_string: string; new_string: string },
  cwd: string,
): string {
  const target = resolvePath(args.path, cwd);
  if (!isInsideWorkspace(target, cwd)) {
    return "Access denied: Write operations are only permitted inside the workspace directory.";
  }
  if (!fs.existsSync(target)) {
    return `Error: File not found: ${args.path}`;
  }
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    return `Error: Path is a directory: ${args.path}`;
  }
  const content = fs.readFileSync(target, "utf-8");
  if (!args.old_string) {
    return "Error: old_string cannot be empty.";
  }
  const occurrences = content.split(args.old_string).length - 1;
  if (occurrences === 0) {
    return `Error: Could not find exact match for 'old_string' in ${args.path}. Please inspect the file with read_file and provide the exact existing text.`;
  }
  if (occurrences > 1) {
    return `Error: 'old_string' matched ${occurrences} times in ${args.path}. Please provide a larger, unique context snippet.`;
  }
  const newContent = content.replace(args.old_string, args.new_string);
  fs.writeFileSync(target, newContent, "utf-8");
  return `Successfully edited ${args.path}`;
}

export function handleListDirectory(args: { path?: string }, cwd: string): string {
  const target = resolvePath(args.path || ".", cwd);
  if (!fs.existsSync(target)) {
    return `Error: Directory not found: ${args.path ?? "."}`;
  }
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) {
    return `Error: Path is a file, not a directory: ${args.path ?? "."}`;
  }
  const entries = fs.readdirSync(target, { withFileTypes: true });
  const formatted = entries
    .slice(0, 500)
    .map((e) => (e.isDirectory() ? `[dir]  ${e.name}/` : `[file] ${e.name}`))
    .join("\n");
  return formatted || "(empty directory)";
}

export function handleExecuteCommand(
  command: string,
  cwd: string,
  signal: AbortSignal,
  onProcessStarted?: (proc: childProcess.ChildProcess) => void,
): Promise<string> {
  const safetyError = checkCommandSafety(command);
  if (safetyError) {
    return Promise.resolve(safetyError);
  }

  return new Promise((resolve) => {
    const proc = childProcess.exec(
      command,
      {
        cwd,
        timeout: 60_000,
        shell: process.platform === "win32" ? undefined : "/bin/zsh",
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        let result = "";
        if (error) {
          if (error.killed) {
            result += "Command timed out or was terminated.\n";
          } else {
            result += `Exit code: ${error.code ?? 1}\n`;
          }
        } else {
          result += "Exit code: 0\n";
        }
        if (stdout) result += `stdout:\n${stdout}\n`;
        if (stderr) result += `stderr:\n${stderr}\n`;
        resolve(result.trim());
      },
    );

    onProcessStarted?.(proc);

    if (signal.aborted) {
      proc.kill("SIGTERM");
    } else {
      signal.addEventListener(
        "abort",
        () => {
          proc.kill("SIGTERM");
        },
        { once: true },
      );
    }
  });
}

export function abacusChatCompletionsUrl(base: string): string {
  const url = new URL(base);
  url.search = "";
  url.hash = "";
  const normalizedPath = url.pathname.replace(/\/+$/u, "");
  url.pathname = normalizedPath.endsWith("/v1")
    ? `${normalizedPath}/chat/completions`
    : `${normalizedPath}/v1/chat/completions`;
  return url.toString();
}

export async function* parseAbacusSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  const line = (value: string) => {
    if (value === "") {
      const event = data.length ? data.join("\n") : undefined;
      data = [];
      return event;
    }
    if (value.startsWith(":")) return undefined;
    if (value === "data") data.push("");
    else if (value.startsWith("data:")) data.push(value.slice(5).replace(/^ /u, ""));
    return undefined;
  };
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      buffer += decoder.decode(next.value, { stream: true });
      if (new TextEncoder().encode(buffer).byteLength > MAX_BUFFER)
        throw new Error("RouteLLM stream event exceeded the buffer limit.");
      for (let i = buffer.indexOf("\n"); i >= 0; i = buffer.indexOf("\n")) {
        const event = line(buffer.slice(0, i).replace(/\r$/u, ""));
        buffer = buffer.slice(i + 1);
        if (event !== undefined) yield event;
      }
    }
    buffer += decoder.decode();
    if (buffer) {
      const event = line(buffer.replace(/\r$/u, ""));
      if (event !== undefined) yield event;
    }
    const event = line("");
    if (event !== undefined) yield event;
  } finally {
    reader.releaseLock();
  }
}

function httpError(status: number): string {
  if (status === 401 || status === 403) return "RouteLLM rejected the API key.";
  if (status === 429) return "RouteLLM rate limit exceeded.";
  return status >= 500
    ? `RouteLLM server failed with HTTP ${status}.`
    : `RouteLLM request failed with HTTP ${status}.`;
}

export const makeAbacusAdapter = (
  options: AbacusAdapterOptions,
): Effect.Effect<ProviderAdapterShape<ProviderAdapterError>> =>
  Effect.gen(function* () {
    const bus = yield* PubSub.unbounded<ProviderRuntimeEvent>();
    const sessions = new Map<ThreadId, Context>();
    const fetch = options.fetch ?? globalThis.fetch;
    const now = () => new Date().toISOString();
    const stamp = () => ({ eventId: EventId.make(crypto.randomUUID()), createdAt: now() });
    const emit = (event: ProviderRuntimeEvent) => PubSub.publish(bus, event).pipe(Effect.asVoid);
    const requireSession = (
      threadId: ThreadId,
    ): Effect.Effect<Context, ProviderAdapterSessionNotFoundError> => {
      const value = sessions.get(threadId);
      return value
        ? Effect.succeed(value)
        : Effect.fail(new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }));
    };
    const unsupported = (method: string) =>
      Effect.fail(
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method,
          detail: "ChatLLM adapter does not support this operation.",
        }),
      );

    const startSession: ProviderAdapterShape<ProviderAdapterError>["startSession"] = Effect.fn(
      "AbacusAdapter.startSession",
    )(function* (input) {
      if (!options.apiKey)
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "startSession",
          issue: "Set ABACUS_API_KEY before starting a ChatLLM session.",
        });
      if (input.resumeCursor !== undefined)
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "startSession",
          issue: "ChatLLM sessions cannot recover history after a server restart.",
        });
      const existing = sessions.get(input.threadId);
      if (existing) return existing.session;
      const createdAt = now();
      const model = input.modelSelection?.model ?? options.defaultModel;
      const cwd = input.cwd ?? process.cwd();
      const session: ProviderSession = {
        provider: PROVIDER,
        providerInstanceId: options.instanceId,
        status: "ready",
        runtimeMode: input.runtimeMode,
        cwd,
        model,
        threadId: input.threadId,
        createdAt,
        updatedAt: createdAt,
      };
      sessions.set(input.threadId, { session, messages: [] });
      yield* emit({
        type: "session.started",
        payload: {},
        ...stamp(),
        provider: PROVIDER,
        providerInstanceId: options.instanceId,
        threadId: input.threadId,
      });
      yield* emit({
        type: "session.state.changed",
        payload: { state: "ready", reason: "ChatLLM agent session ready" },
        ...stamp(),
        provider: PROVIDER,
        providerInstanceId: options.instanceId,
        threadId: input.threadId,
      });
      yield* emit({
        type: "thread.started",
        payload: { providerThreadId: input.threadId },
        ...stamp(),
        provider: PROVIDER,
        providerInstanceId: options.instanceId,
        threadId: input.threadId,
      });
      return session;
    });

    const sendTurn: ProviderAdapterShape<ProviderAdapterError>["sendTurn"] = Effect.fn(
      "AbacusAdapter.sendTurn",
    )(function* (input) {
      const context = yield* requireSession(input.threadId);
      if (context.active && !context.active.settled)
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: "A ChatLLM turn is already running for this session.",
        });
      if (input.attachments?.length)
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: "ChatLLM text chat does not support attachments.",
        });
      if (!input.input)
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: "ChatLLM agent requires a prompt.",
        });
      if (input.modelSelection && input.modelSelection.instanceId !== options.instanceId)
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: "The selected model belongs to another provider instance.",
        });

      const model = input.modelSelection?.model ?? context.session.model ?? options.defaultModel;
      const cwd = context.session.cwd ?? process.cwd();
      const turnId = TurnId.make(crypto.randomUUID());
      const controller = new AbortController();
      const active: Active = { turnId, controller, cancelled: false, settled: false };
      context.active = active;
      context.session = {
        ...context.session,
        status: "running",
        activeTurnId: turnId,
        model,
        updatedAt: now(),
      };

      const initialMessageCount = context.messages.length;
      if (context.messages.length === 0) {
        context.messages.push({
          role: "system",
          content: buildAbacusSystemPrompt(cwd, model),
        });
      }
      context.messages.push({ role: "user", content: input.input });

      yield* emit({
        type: "turn.started",
        ...stamp(),
        provider: PROVIDER,
        providerInstanceId: options.instanceId,
        threadId: input.threadId,
        turnId,
        payload: { model },
      });

      const timeout = setTimeout(
        () => controller.abort("timeout"),
        options.requestTimeoutMs ?? 600_000,
      );

      let stepCount = 0;
      let finalFinishReason: string | undefined;
      let finalUsage: unknown;
      let failure: string | undefined;

      while (!active.cancelled) {
        let assistantText = "";
        let finishReason: string | undefined;
        let usage: unknown;
        let done = false;
        let failureHint: string | undefined;
        const currentAssistantItemId = RuntimeItemId.make(crypto.randomUUID());
        let hasStartedAssistantItem = false;

        const toolCallAccumulators = new Map<
          number,
          {
            id: string;
            type: "function";
            function: { name: string; arguments: string };
          }
        >();

        const requestExit = yield* Effect.tryPromise({
          try: async () => {
            const response = await fetch(abacusChatCompletionsUrl(options.apiBaseUrl), {
              method: "POST",
              headers: {
                Authorization: `Bearer ${options.apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model,
                messages: context.messages,
                stream: true,
                stream_options: { include_usage: true },
                tools: ABACUS_AGENT_TOOLS,
                tool_choice: "auto",
              }),
              signal: controller.signal,
            });

            if (!response.ok) {
              failureHint = httpError(response.status);
              throw new Error(failureHint);
            }
            if (!response.body) {
              failureHint = "RouteLLM returned an empty streaming response.";
              throw new Error(failureHint);
            }

            for await (const payload of parseAbacusSse(response.body)) {
              if (payload === "[DONE]") {
                done = true;
                break;
              }
              if (active.cancelled) break;
              let chunk: {
                choices?: Array<{
                  delta?: {
                    content?: unknown;
                    tool_calls?: Array<{
                      index: number;
                      id?: string;
                      type?: string;
                      function?: { name?: string; arguments?: string };
                    }>;
                  };
                  finish_reason?: unknown;
                }>;
                usage?: unknown;
              };
              try {
                chunk = JSON.parse(payload) as typeof chunk;
              } catch {
                failureHint = "RouteLLM returned malformed streaming data.";
                throw new Error(failureHint);
              }
              if (chunk.usage !== undefined) usage = chunk.usage;

              for (const choice of chunk.choices ?? []) {
                if (typeof choice.finish_reason === "string") {
                  finishReason = choice.finish_reason;
                }

                const deltaText = choice.delta?.content;
                if (typeof deltaText === "string" && deltaText) {
                  if (!hasStartedAssistantItem) {
                    hasStartedAssistantItem = true;
                    await Effect.runPromise(
                      emit({
                        type: "item.started",
                        ...stamp(),
                        provider: PROVIDER,
                        providerInstanceId: options.instanceId,
                        threadId: input.threadId,
                        turnId,
                        itemId: currentAssistantItemId,
                        payload: { itemType: "assistant_message", status: "inProgress" },
                      }),
                    );
                  }
                  assistantText += deltaText;
                  await Effect.runPromise(
                    emit({
                      type: "content.delta",
                      ...stamp(),
                      provider: PROVIDER,
                      providerInstanceId: options.instanceId,
                      threadId: input.threadId,
                      turnId,
                      itemId: currentAssistantItemId,
                      payload: { streamKind: "assistant_text", delta: deltaText },
                    }),
                  );
                }

                if (choice.delta?.tool_calls) {
                  for (const tc of choice.delta.tool_calls) {
                    const idx = tc.index ?? 0;
                    let acc = toolCallAccumulators.get(idx);
                    if (!acc) {
                      acc = {
                        id: tc.id ?? `call_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
                        type: "function",
                        function: {
                          name: tc.function?.name ?? "",
                          arguments: tc.function?.arguments ?? "",
                        },
                      };
                      toolCallAccumulators.set(idx, acc);
                    } else {
                      if (tc.id) acc.id = tc.id;
                      if (tc.function?.name) acc.function.name += tc.function.name;
                      if (tc.function?.arguments) acc.function.arguments += tc.function.arguments;
                    }
                  }
                }
              }
            }

            if (!active.cancelled && !done) {
              failureHint = "RouteLLM stream ended before its completion marker.";
              throw new Error(failureHint);
            }
          },
          catch: (cause) => cause,
        }).pipe(Effect.exit);

        if (!active.cancelled && Exit.isFailure(requestExit)) {
          failure =
            controller.signal.reason === "timeout"
              ? "RouteLLM request timed out."
              : (failureHint ?? "RouteLLM request failed.");
          break;
        }

        if (hasStartedAssistantItem) {
          yield* emit({
            type: "item.completed",
            ...stamp(),
            provider: PROVIDER,
            providerInstanceId: options.instanceId,
            threadId: input.threadId,
            turnId,
            itemId: currentAssistantItemId,
            payload: { itemType: "assistant_message", status: "completed" },
          });
        }

        if (finishReason) finalFinishReason = finishReason;
        if (usage !== undefined) finalUsage = usage;

        const toolCalls: ToolCall[] = Array.from(toolCallAccumulators.entries())
          .sort(([a], [b]) => a - b)
          .map(([_, acc]) => ({
            id: acc.id || `call_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
            type: "function" as const,
            function: {
              name: acc.function.name,
              arguments: acc.function.arguments,
            },
          }));

        if (toolCalls.length === 0) {
          // Model finished its text response without calling tools
          if (assistantText) {
            context.messages.push({
              role: "assistant",
              content: assistantText,
            });
          }
          break;
        }

        // Model requested tool calls
        context.messages.push({
          role: "assistant",
          content: assistantText || null,
          tool_calls: toolCalls,
        });

        stepCount += toolCalls.length;
        if (stepCount > MAX_TURN_STEPS) {
          const ceilingMessage =
            "\n\nI have reached the 20-step tool ceiling for this turn. Would you like me to continue with the remaining steps?";
          const ceilingItemId = RuntimeItemId.make(crypto.randomUUID());
          yield* emit({
            type: "item.started",
            ...stamp(),
            provider: PROVIDER,
            providerInstanceId: options.instanceId,
            threadId: input.threadId,
            turnId,
            itemId: ceilingItemId,
            payload: { itemType: "assistant_message", status: "inProgress" },
          });
          yield* emit({
            type: "content.delta",
            ...stamp(),
            provider: PROVIDER,
            providerInstanceId: options.instanceId,
            threadId: input.threadId,
            turnId,
            itemId: ceilingItemId,
            payload: { streamKind: "assistant_text", delta: ceilingMessage },
          });
          yield* emit({
            type: "item.completed",
            ...stamp(),
            provider: PROVIDER,
            providerInstanceId: options.instanceId,
            threadId: input.threadId,
            turnId,
            itemId: ceilingItemId,
            payload: { itemType: "assistant_message", status: "completed" },
          });
          context.messages.push({
            role: "assistant",
            content: ceilingMessage,
          });
          break;
        }

        // Execute tool calls
        for (const tc of toolCalls) {
          if (active.cancelled) break;

          let toolArgs: Record<string, unknown> = {};
          try {
            toolArgs = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
          } catch {
            toolArgs = {};
          }

          let itemType: CanonicalItemType = "dynamic_tool_call";
          let title = tc.function.name;
          let detail = "";
          let data: Record<string, unknown> = {
            toolName: tc.function.name,
            toolCallId: tc.id,
          };

          if (tc.function.name === "execute_command") {
            itemType = "command_execution";
            title = "Run command";
            detail = typeof toolArgs.command === "string" ? toolArgs.command : "";
            data = { ...data, command: toolArgs.command };
          } else if (tc.function.name === "write_file" || tc.function.name === "edit_file") {
            itemType = "file_change";
            title = tc.function.name === "write_file" ? "Write file" : "Edit file";
            const filePath = typeof toolArgs.path === "string" ? toolArgs.path : "";
            detail = filePath;
            data = {
              ...data,
              files: [{ path: resolvePath(filePath, cwd) }],
              filePath: resolvePath(filePath, cwd),
            };
          } else if (tc.function.name === "read_file") {
            title = "Read file";
            detail = typeof toolArgs.path === "string" ? toolArgs.path : "";
          } else if (tc.function.name === "list_directory") {
            title = "List directory";
            detail = typeof toolArgs.path === "string" ? toolArgs.path : ".";
          }

          const toolItemId = RuntimeItemId.make(crypto.randomUUID());
          yield* emit({
            type: "item.started",
            ...stamp(),
            provider: PROVIDER,
            providerInstanceId: options.instanceId,
            threadId: input.threadId,
            turnId,
            itemId: toolItemId,
            payload: {
              itemType,
              status: "inProgress",
              title,
              ...(detail ? { detail } : {}),
              data,
            },
          });

          let rawOutput = "";
          try {
            switch (tc.function.name) {
              case "read_file":
                rawOutput = handleReadFile(
                  toolArgs as { path: string; start_line?: number; end_line?: number },
                  cwd,
                );
                break;
              case "write_file":
                rawOutput = handleWriteFile(toolArgs as { path: string; content: string }, cwd);
                break;
              case "edit_file":
                rawOutput = handleEditFile(
                  toolArgs as { path: string; old_string: string; new_string: string },
                  cwd,
                );
                break;
              case "list_directory":
                rawOutput = handleListDirectory(toolArgs as { path?: string }, cwd);
                break;
              case "execute_command":
                rawOutput = yield* Effect.promise(() =>
                  handleExecuteCommand(
                    String(toolArgs.command ?? ""),
                    cwd,
                    controller.signal,
                    (proc) => {
                      active.currentProcess = proc;
                    },
                  ),
                );
                active.currentProcess = undefined;
                break;
              default:
                rawOutput = `Error: Unknown tool '${tc.function.name}'`;
            }
          } catch (err: unknown) {
            rawOutput = `Error executing tool '${tc.function.name}': ${
              err instanceof Error ? err.message : String(err)
            }`;
          }

          const truncated = truncateToolOutput(rawOutput);

          yield* emit({
            type: "item.completed",
            ...stamp(),
            provider: PROVIDER,
            providerInstanceId: options.instanceId,
            threadId: input.threadId,
            turnId,
            itemId: toolItemId,
            payload: {
              itemType,
              status: "completed",
              title,
              ...(detail ? { detail } : {}),
              data: {
                ...data,
                rawOutput: truncated,
                result: truncated,
              },
            },
          });

          context.messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: truncated,
          });
        }
      }

      clearTimeout(timeout);
      controller.abort();
      if (active.currentProcess) {
        active.currentProcess.kill("SIGTERM");
      }

      if (active.cancelled || failure) {
        context.messages.length = initialMessageCount;
      }

      if (!active.settled) {
        active.settled = true;
        yield* emit({
          type: "turn.completed",
          ...stamp(),
          provider: PROVIDER,
          providerInstanceId: options.instanceId,
          threadId: input.threadId,
          turnId,
          payload: {
            state: active.cancelled ? "interrupted" : failure ? "failed" : "completed",
            ...(finalFinishReason ? { stopReason: finalFinishReason } : {}),
            ...(finalUsage !== undefined ? { usage: finalUsage } : {}),
            ...(failure ? { errorMessage: failure } : {}),
          },
        });
      }

      context.active = undefined;
      context.session = {
        ...context.session,
        status: failure ? "error" : "ready",
        activeTurnId: undefined,
        updatedAt: now(),
        ...(failure ? { lastError: failure } : { lastError: undefined }),
      };
      return { threadId: input.threadId, turnId };
    });

    const interruptTurn: ProviderAdapterShape<ProviderAdapterError>["interruptTurn"] = Effect.fn(
      "AbacusAdapter.interruptTurn",
    )(function* (threadId, turnId) {
      const context = yield* requireSession(threadId);
      if (!context.active || context.active.settled || (turnId && turnId !== context.active.turnId))
        return;
      context.active.cancelled = true;
      if (context.active.currentProcess) {
        context.active.currentProcess.kill("SIGTERM");
      }
      context.active.controller.abort("cancelled");
    });

    const stopSession: ProviderAdapterShape<ProviderAdapterError>["stopSession"] = Effect.fn(
      "AbacusAdapter.stopSession",
    )(function* (threadId) {
      const context = sessions.get(threadId);
      if (!context) return;
      if (context.active && !context.active.settled) {
        context.active.cancelled = true;
        if (context.active.currentProcess) {
          context.active.currentProcess.kill("SIGTERM");
        }
        context.active.controller.abort("cancelled");
      }
      sessions.delete(threadId);
      yield* emit({
        type: "session.exited",
        ...stamp(),
        provider: PROVIDER,
        providerInstanceId: options.instanceId,
        threadId,
        payload: { reason: "ChatLLM session stopped", recoverable: false, exitKind: "graceful" },
      });
    });

    return {
      provider: PROVIDER,
      capabilities: { sessionModelSwitch: "unsupported", supportsConversationRollback: false },
      startSession,
      sendTurn,
      interruptTurn,
      respondToRequest: () => unsupported("respondToRequest"),
      respondToUserInput: () => unsupported("respondToUserInput"),
      stopSession,
      listSessions: () => Effect.succeed([...sessions.values()].map((entry) => entry.session)),
      hasSession: (id) => Effect.succeed(sessions.has(id)),
      readThread: (threadId) =>
        requireSession(threadId).pipe(
          Effect.map((context) => ({
            threadId,
            turns: context.messages
              .filter((message) => message.role !== "system")
              .map((message, index) => ({
                id: TurnId.make(`abacus-history-${index}`),
                items: [message],
              })),
          })),
        ),
      rollbackThread: () => unsupported("rollbackThread"),
      stopAll: () => Effect.forEach([...sessions.keys()], stopSession, { discard: true }),
      streamEvents: Stream.fromPubSub(bus),
    };
  });
