// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off cryptoRandomUUID:off cryptoRandomUUIDInEffect:off globalDate:off globalTimersInEffect:off unknownInEffectCatch:off anyUnknownInErrorContext:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import {
  ABACUS_CREDIT_COST_USD,
  ABACUS_DEFAULT_API_BASE_URL,
  AbacusSettings,
  MessageId,
  NodeId,
  normalizeUsageModel,
  ProviderDriverKind,
  ProviderSessionId,
  type ModelSelection,
  type OrchestrationV2ProviderCapabilities,
  type OrchestrationV2ProviderSession,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2ProviderTurn,
  type ProviderInstanceId,
  type ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { AcpProviderCapabilitiesV2 } from "@t3tools/provider-acp/server/adapter";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import {
  ProviderAdapterDriverCreateError,
  type ProviderAdapterDriver,
  type ProviderAdapterDriverCreateInput,
} from "@t3tools/provider-core/server/adapterDriver";
import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import { turnScopedSelectionTransition } from "@t3tools/provider-core/server/selectionTransition";
import { appendProviderTurnUsage } from "../../usage/providerTurnUsageWriter.ts";
import {
  fetchAbacusComputePoints,
  type AbacusComputePointsSnapshot,
} from "../../provider/abacusUsageLimits.ts";
import { STATIC_FALLBACK_RATES } from "../../usage/usagePricing.ts";

export const ABACUS_PROVIDER = ProviderDriverKind.make("abacus");
const decodeAbacusSettings = Schema.decodeSync(AbacusSettings);

/**
 * Tool calls one turn may run. Flash models are cheap enough for long agent
 * loops such as delegated reviews; pricier models stop sooner.
 */
export function abacusMaxTurnSteps(model: string): number {
  return /flash/i.test(model) ? 200 : 50;
}
const makeToolCallId = () => `call_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
const MAX_TOOL_OUTPUT_BYTES = 30 * 1024;
const MAX_HEAD_LINES = 200;
const MAX_TAIL_LINES = 300;

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
            description: "The exact existing text sequence to be replaced",
          },
          new_string: {
            type: "string",
            description: "The new text that will replace old_string",
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
        "List files and subdirectories in a directory path (relative to workspace or absolute).",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Directory path to list (defaults to workspace root)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "execute_command",
      description:
        "Execute a shell command inside the workspace root directory. Command output is returned.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The shell command to run" },
        },
        required: ["command"],
      },
    },
  },
] as const;

const DANGEROUS_PATTERNS: ReadonlyArray<RegExp> = [
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
  if (NodePath.isAbsolute(filePath)) {
    return NodePath.normalize(filePath);
  }
  return NodePath.normalize(NodePath.resolve(cwd, filePath));
}

export function isInsideWorkspace(targetPath: string, workspaceDir: string): boolean {
  const rel = NodePath.relative(NodePath.resolve(workspaceDir), NodePath.resolve(targetPath));
  return !rel.startsWith("..") && !NodePath.isAbsolute(rel);
}

/**
 * Resolves a write target to its real path, returning it only when it lies
 * inside the workspace. Symlinks resolve before the check, so a link inside the
 * workspace cannot redirect a write outside it. Missing segments are re-appended
 * to the nearest existing ancestor; an entry that exists but cannot be resolved,
 * like a dangling link, is refused.
 */
export function resolveWorkspaceWritePath(filePath: string, cwd: string): string | null {
  const missing: Array<string> = [];
  let existing = resolvePath(filePath, cwd);
  let realExisting = realPathOrNull(existing);
  while (realExisting === null) {
    if (NodeFS.lstatSync(existing, { throwIfNoEntry: false })) return null;
    const parent = NodePath.dirname(existing);
    if (parent === existing) return null;
    missing.unshift(NodePath.basename(existing));
    existing = parent;
    realExisting = realPathOrNull(existing);
  }
  const target = NodePath.join(realExisting, ...missing);
  return isInsideWorkspace(target, realPathOrNull(cwd) ?? cwd) ? target : null;
}

function realPathOrNull(path: string): string | null {
  try {
    return NodeFS.realpathSync(path);
  } catch {
    return null;
  }
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
  if (!NodeFS.existsSync(target)) {
    return `Error: File not found: ${args.path}`;
  }
  const stat = NodeFS.statSync(target);
  if (stat.isDirectory()) {
    return `Error: Path is a directory, not a file: ${args.path}`;
  }
  const content = NodeFS.readFileSync(target, "utf-8");
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
  const target = resolveWorkspaceWritePath(args.path, cwd);
  if (target === null) {
    return "Access denied: Write operations are only permitted inside the workspace directory.";
  }
  try {
    NodeFS.mkdirSync(NodePath.dirname(target), { recursive: true });
    NodeFS.writeFileSync(target, args.content, "utf-8");
    return `Successfully wrote ${Buffer.byteLength(args.content, "utf-8")} bytes to ${args.path}`;
  } catch (err: unknown) {
    return `Error writing file ${args.path}: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export function handleEditFile(
  args: { path: string; old_string: string; new_string: string },
  cwd: string,
): string {
  const target = resolveWorkspaceWritePath(args.path, cwd);
  if (target === null) {
    return "Access denied: Write operations are only permitted inside the workspace directory.";
  }
  if (!NodeFS.existsSync(target)) {
    return `Error: File not found: ${args.path}`;
  }
  const currentContent = NodeFS.readFileSync(target, "utf-8");
  if (!currentContent.includes(args.old_string)) {
    return `Error: Could not find exact match for old_string in ${args.path}. No changes made.`;
  }
  const firstIdx = currentContent.indexOf(args.old_string);
  const secondIdx = currentContent.indexOf(args.old_string, firstIdx + 1);
  if (secondIdx !== -1) {
    return `Error: old_string matches multiple locations in ${args.path}. Please provide a larger, unique context.`;
  }
  const newContent = currentContent.replace(args.old_string, args.new_string);
  try {
    NodeFS.writeFileSync(target, newContent, "utf-8");
    return `Successfully edited ${args.path}`;
  } catch (err: unknown) {
    return `Error updating file ${args.path}: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export function handleListDirectory(args: { path?: string }, cwd: string): string {
  const target = resolvePath(args.path ?? ".", cwd);
  if (!NodeFS.existsSync(target)) {
    return `Error: Directory not found: ${args.path ?? "."}`;
  }
  const stat = NodeFS.statSync(target);
  if (!stat.isDirectory()) {
    return `Error: Path is not a directory: ${args.path ?? "."}`;
  }
  const entries = NodeFS.readdirSync(target, { withFileTypes: true });
  const formatted = entries
    .map((e) => `${e.isDirectory() ? "[dir] " : "[file]"} ${e.name}`)
    .sort()
    .join("\n");
  return formatted || "(empty directory)";
}

export function handleExecuteCommand(
  command: string,
  cwd: string,
  signal: AbortSignal,
  platform: NodeJS.Platform = process.platform,
  onProcessStarted?: (proc: NodeChildProcess.ChildProcess) => void,
): Promise<string> {
  const safetyError = checkCommandSafety(command);
  if (safetyError) {
    return Promise.resolve(safetyError);
  }

  return new Promise((resolve) => {
    const proc = NodeChildProcess.exec(
      command,
      {
        cwd,
        timeout: 60_000,
        shell: platform === "win32" ? undefined : "/bin/zsh",
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
    const separator = value.indexOf(":");
    const field = separator === -1 ? value : value.slice(0, separator);
    const text = separator === -1 ? "" : value.slice(separator + 1).replace(/^\s+/u, "");
    if (field === "data") data.push(text);
    return undefined;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf("\n")) !== -1) {
        const raw = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        const event = line(raw.endsWith("\r") ? raw.slice(0, -1) : raw);
        if (event !== undefined) yield event;
      }
    }
    buffer += decoder.decode();
    const event = line(buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer);
    if (event !== undefined) yield event;
  } finally {
    reader.releaseLock();
  }
}

export const AbacusProviderCapabilitiesV2 = {
  ...AcpProviderCapabilitiesV2,
  sessions: {
    ...AcpProviderCapabilitiesV2.sessions,
    supportsMultipleProviderThreadsPerSession: false,
    supportsModelSwitchInSession: false,
    supportsProviderSwitchingViaHandoff: false,
    supportsRuntimeModeSwitchInSession: false,
    pendingRequestsSurviveRestart: false,
  },
  threads: {
    ...AcpProviderCapabilitiesV2.threads,
    canCreateEmptyThread: true,
    canReadThreadSnapshot: true,
    canRollbackThread: false,
    canForkThread: false,
    canForkFromTurn: false,
    canForkFromSubagentThread: false,
    exposesNativeThreadId: false,
  },
  turns: {
    ...AcpProviderCapabilitiesV2.turns,
    exposesNativeTurnId: false,
    emitsTurnStarted: true,
    emitsTurnCompleted: true,
    supportsInterrupt: true,
    supportsActiveSteering: false,
  },
  tools: {
    ...AcpProviderCapabilitiesV2.tools,
    supportsMcpTools: true,
    supportsDynamicToolCallbacks: false,
  },
  subagents: {
    ...AcpProviderCapabilitiesV2.subagents,
    supportsSubagents: false,
  },
} satisfies OrchestrationV2ProviderCapabilities;

export interface AbacusAdapterV2Options {
  readonly instanceId: ProviderInstanceId;
  readonly apiBaseUrl: string;
  readonly apiKey: string;
  readonly defaultModel: string;
  readonly stateDir?: string | undefined;
  readonly fetch?: Fetch;
  readonly requestTimeoutMs?: number;
}

interface ActiveTurn {
  readonly turnId: OrchestrationV2ProviderTurn["id"];
  readonly controller: AbortController;
  currentProcess?: NodeChildProcess.ChildProcess | undefined;
  cancelled: boolean;
  settled: boolean;
}

export const makeAbacusAdapterV2 = Effect.fn("makeAbacusAdapterV2")(function* (
  options: AbacusAdapterV2Options,
) {
  const fetchFn = options.fetch ?? globalThis.fetch;
  let lastKnownComputePoints: AbacusComputePointsSnapshot | null = null;

  return ProviderAdapter.ProviderAdapterV2.of({
    instanceId: options.instanceId,
    driver: ABACUS_PROVIDER,
    getCapabilities: () => Effect.succeed(AbacusProviderCapabilitiesV2),
    planSelectionTransition: () => Effect.succeed(turnScopedSelectionTransition()),
    openSession: Effect.fn("AbacusAdapterV2.openSession")(
      function* (sessionInput: ProviderAdapter.ProviderAdapterV2OpenSessionInput) {
        const events = yield* Queue.unbounded<ProviderAdapter.ProviderAdapterV2Event>();
        const messages: AbacusMessage[] = [];
        const activeTurnRef = yield* Ref.make<ActiveTurn | null>(null);
        const threads = new Map<string, OrchestrationV2ProviderThread>();
        const recordedTurns: Array<{
          turnId: OrchestrationV2ProviderTurn["id"];
          items: Array<{ role: string; content?: string | null }>;
        }> = [];

        const now = yield* DateTime.now;
        const providerSession: OrchestrationV2ProviderSession = {
          id: sessionInput.providerSessionId,
          driver: ABACUS_PROVIDER,
          providerInstanceId: options.instanceId,
          status: "ready",
          model: sessionInput.modelSelection.model,
          cwd: sessionInput.runtimePolicy.cwd ?? process.cwd(),
          capabilities: AbacusProviderCapabilitiesV2,
          createdAt: now,
          updatedAt: now,
          lastError: null,
        };

        const ensureThread = (threadInput: ProviderAdapter.ProviderAdapterV2EnsureThreadInput) =>
          Effect.sync(() => {
            const threadIdStr = String(threadInput.threadId);
            const existing = threads.get(threadIdStr);
            if (existing) return existing;
            const thread: OrchestrationV2ProviderThread = {
              id: IdAllocator.derive.providerThread({
                driver: ABACUS_PROVIDER,
                nativeThreadId: threadIdStr,
                providerInstanceId: options.instanceId,
              }),
              driver: ABACUS_PROVIDER,
              providerInstanceId: options.instanceId,
              providerSessionId: sessionInput.providerSessionId,
              appThreadId: threadInput.threadId,
              ownerNodeId: null,
              nativeThreadRef: {
                driver: ABACUS_PROVIDER,
                nativeId: threadIdStr,
                strength: "weak",
              },
              nativeConversationHeadRef: null,
              status: "idle",
              firstRunOrdinal: null,
              lastRunOrdinal: null,
              handoffIds: [],
              forkedFrom: null,
              createdAt: now,
              updatedAt: now,
            };
            threads.set(threadIdStr, thread);
            return thread;
          });

        const startTurn = (turnInput: ProviderAdapter.ProviderAdapterV2TurnInput) =>
          Effect.gen(function* () {
            if (turnInput.message.attachments.length > 0) {
              return yield* Effect.fail(
                new ProviderAdapter.ProviderAdapterProtocolError({
                  driver: ABACUS_PROVIDER,
                  detail: "ChatLLM does not support file or image attachments.",
                }),
              );
            }

            yield* Queue.offer(events, {
              type: "provider_thread.updated",
              driver: ABACUS_PROVIDER,
              providerThread: turnInput.providerThread,
            });

            const syntheticNativeTurnId = `${turnInput.providerThread.id}:turn:${turnInput.runOrdinal}`;
            const providerTurnId = IdAllocator.derive.providerTurn({
              driver: ABACUS_PROVIDER,
              nativeTurnId: syntheticNativeTurnId,
            });
            const startedAt = yield* DateTime.now;
            const providerTurn: OrchestrationV2ProviderTurn = {
              id: providerTurnId,
              providerThreadId: turnInput.providerThread.id,
              nodeId: turnInput.rootNodeId,
              runAttemptId: turnInput.attemptId,
              nativeTurnRef: {
                driver: ABACUS_PROVIDER,
                nativeId: syntheticNativeTurnId,
                strength: "weak",
              },
              ordinal: turnInput.providerTurnOrdinal,
              status: "running",
              startedAt,
              completedAt: null,
            };
            yield* Queue.offer(events, {
              type: "provider_turn.updated",
              driver: ABACUS_PROVIDER,
              threadId: turnInput.threadId,
              providerTurn,
            });

            const controller = new AbortController();
            const active: ActiveTurn = {
              turnId: providerTurnId,
              controller,
              cancelled: false,
              settled: false,
            };
            yield* Ref.set(activeTurnRef, active);

            const cwd = turnInput.runtimePolicy.cwd ?? process.cwd();
            const turnModel = turnInput.modelSelection.model || options.defaultModel;
            const maxTurnSteps = abacusMaxTurnSteps(turnModel);
            const initialMessageCount = messages.length;
            if (messages.length === 0) {
              messages.push({
                role: "system",
                content: buildAbacusSystemPrompt(cwd, turnModel),
              });
            }
            messages.push({ role: "user", content: turnInput.message.text });

            const currentTurnItems: Array<{ role: string; content?: string | null }> = [
              { role: "user", content: turnInput.message.text },
            ];

            let stepCount = 0;
            let finalUsage: unknown;
            let failure: string | undefined;

            while (!active.cancelled) {
              let assistantText = "";
              let finishReason: string | undefined;
              let usage: unknown;
              let done = false;
              let failureHint: string | undefined;
              let hasStartedAssistantItem = false;

              const toolCallAccumulators = new Map<
                number,
                {
                  id: string;
                  type: "function";
                  function: { name: string; arguments: string };
                }
              >();

              const assistantMessageId = MessageId.make(
                `msg-abacus-assistant-${syntheticNativeTurnId}-${stepCount}`,
              );
              const assistantTurnItemId = TurnItemId.make(
                `item-abacus-assistant-${syntheticNativeTurnId}-${stepCount}`,
              );

              // Per request: a long tool loop may run well past one request's budget.
              const timeout = setTimeout(
                () => controller.abort("timeout"),
                options.requestTimeoutMs ?? 600_000,
              );
              const requestExit = yield* Effect.tryPromise({
                try: async () => {
                  const response = await fetchFn(abacusChatCompletionsUrl(options.apiBaseUrl), {
                    method: "POST",
                    headers: {
                      Authorization: `Bearer ${options.apiKey}`,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      model: turnModel,
                      messages,
                      stream: true,
                      stream_options: { include_usage: true },
                      tools: ABACUS_AGENT_TOOLS,
                      tool_choice: "auto",
                    }),
                    signal: controller.signal,
                  });

                  if (!response.ok) {
                    failureHint = `HTTP ${response.status}`;
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
                        assistantText += deltaText;
                        if (!hasStartedAssistantItem) {
                          hasStartedAssistantItem = true;
                        }
                        await Effect.runPromise(
                          Queue.offer(events, {
                            type: "turn_item.updated",
                            driver: ABACUS_PROVIDER,
                            turnItem: {
                              id: assistantTurnItemId,
                              threadId: turnInput.threadId,
                              runId: turnInput.runId,
                              nodeId: turnInput.rootNodeId,
                              providerThreadId: turnInput.providerThread.id,
                              providerTurnId,
                              nativeItemRef: null,
                              parentItemId: null,
                              ordinal: turnInput.providerTurnOrdinal * 100 + stepCount * 2 + 1,
                              status: "running",
                              title: null,
                              startedAt,
                              completedAt: null,
                              updatedAt: DateTime.nowUnsafe(),
                              type: "assistant_message",
                              messageId: assistantMessageId,
                              text: assistantText,
                              streaming: true,
                            },
                          }),
                        );
                      }

                      if (choice.delta?.tool_calls) {
                        for (const tc of choice.delta.tool_calls) {
                          const idx = tc.index ?? 0;
                          let acc = toolCallAccumulators.get(idx);
                          if (!acc) {
                            acc = {
                              id: tc.id ?? makeToolCallId(),
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
              clearTimeout(timeout);

              if (!active.cancelled && requestExit._tag === "Failure") {
                failure =
                  controller.signal.reason === "timeout"
                    ? "RouteLLM request timed out."
                    : (failureHint ?? "RouteLLM request failed.");
                break;
              }

              if (hasStartedAssistantItem) {
                const messageNow = yield* DateTime.now;
                yield* Queue.offer(events, {
                  type: "message.updated",
                  driver: ABACUS_PROVIDER,
                  message: {
                    id: assistantMessageId,
                    threadId: turnInput.threadId,
                    runId: turnInput.runId,
                    nodeId: turnInput.rootNodeId,
                    role: "assistant",
                    text: assistantText,
                    attachments: [],
                    streaming: false,
                    createdBy: "agent",
                    creationSource: "provider",
                    createdAt: startedAt,
                    updatedAt: messageNow,
                  },
                });
                yield* Queue.offer(events, {
                  type: "turn_item.updated",
                  driver: ABACUS_PROVIDER,
                  turnItem: {
                    id: assistantTurnItemId,
                    threadId: turnInput.threadId,
                    runId: turnInput.runId,
                    nodeId: turnInput.rootNodeId,
                    providerThreadId: turnInput.providerThread.id,
                    providerTurnId,
                    nativeItemRef: null,
                    parentItemId: null,
                    ordinal: turnInput.providerTurnOrdinal * 100 + stepCount * 2 + 1,
                    status: "completed",
                    title: null,
                    startedAt,
                    completedAt: yield* DateTime.now,
                    updatedAt: yield* DateTime.now,
                    type: "assistant_message",
                    messageId: assistantMessageId,
                    text: assistantText,
                    streaming: false,
                  },
                });
              }

              if (usage !== undefined) finalUsage = usage;

              const toolCalls: ToolCall[] = Array.from(toolCallAccumulators.entries())
                .sort(([a], [b]) => a - b)
                .map(([_, acc]) => ({
                  id: acc.id || makeToolCallId(),
                  type: "function" as const,
                  function: {
                    name: acc.function.name,
                    arguments: acc.function.arguments,
                  },
                }));

              if (toolCalls.length === 0) {
                if (assistantText) {
                  messages.push({ role: "assistant", content: assistantText });
                  currentTurnItems.push({ role: "assistant", content: assistantText });
                }
                break;
              }

              if (stepCount + toolCalls.length > maxTurnSteps) {
                // Ends the turn without running this batch, so the history
                // holds no unanswered tool calls for the next turn. The notice
                // is the turn's last assistant text, which delegated tasks
                // report as their summary.
                const ceilingText = `Stopped after ${stepCount} tool calls: ${turnModel} is limited to ${maxTurnSteps} per turn. Send a follow-up to continue.`;
                const content = assistantText ? `${assistantText}\n\n${ceilingText}` : ceilingText;
                messages.push({ role: "assistant", content });
                currentTurnItems.push({ role: "assistant", content });
                const ceilingNow = yield* DateTime.now;
                const ceilingMessageId = MessageId.make(
                  `msg-abacus-assistant-${syntheticNativeTurnId}-step-limit`,
                );
                yield* Queue.offer(events, {
                  type: "message.updated",
                  driver: ABACUS_PROVIDER,
                  message: {
                    id: ceilingMessageId,
                    threadId: turnInput.threadId,
                    runId: turnInput.runId,
                    nodeId: turnInput.rootNodeId,
                    role: "assistant",
                    text: ceilingText,
                    attachments: [],
                    streaming: false,
                    createdBy: "agent",
                    creationSource: "provider",
                    createdAt: ceilingNow,
                    updatedAt: ceilingNow,
                  },
                });
                yield* Queue.offer(events, {
                  type: "turn_item.updated",
                  driver: ABACUS_PROVIDER,
                  turnItem: {
                    id: TurnItemId.make(`item-abacus-assistant-${syntheticNativeTurnId}-step-limit`),
                    threadId: turnInput.threadId,
                    runId: turnInput.runId,
                    nodeId: turnInput.rootNodeId,
                    providerThreadId: turnInput.providerThread.id,
                    providerTurnId,
                    nativeItemRef: null,
                    parentItemId: null,
                    ordinal: turnInput.providerTurnOrdinal * 100 + stepCount * 2 + 3,
                    status: "completed",
                    title: null,
                    startedAt: ceilingNow,
                    completedAt: ceilingNow,
                    updatedAt: ceilingNow,
                    type: "assistant_message",
                    messageId: ceilingMessageId,
                    text: ceilingText,
                    streaming: false,
                  },
                });
                break;
              }

              messages.push({
                role: "assistant",
                content: assistantText || null,
                tool_calls: toolCalls,
              });
              if (assistantText) {
                currentTurnItems.push({ role: "assistant", content: assistantText });
              }

              stepCount += toolCalls.length;

              for (const tc of toolCalls) {
                if (active.cancelled) break;

                let toolArgs: Record<string, unknown> = {};
                try {
                  toolArgs = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
                } catch {
                  toolArgs = {};
                }

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
                      rawOutput = handleWriteFile(
                        toolArgs as { path: string; content: string },
                        cwd,
                      );
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
                          process.platform,
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
                const toolTurnItemId = TurnItemId.make(
                  `item-abacus-tool-${syntheticNativeTurnId}-${tc.id}`,
                );
                const toolNow = yield* DateTime.now;

                if (tc.function.name === "execute_command") {
                  yield* Queue.offer(events, {
                    type: "turn_item.updated",
                    driver: ABACUS_PROVIDER,
                    turnItem: {
                      id: toolTurnItemId,
                      threadId: turnInput.threadId,
                      runId: turnInput.runId,
                      nodeId: turnInput.rootNodeId,
                      providerThreadId: turnInput.providerThread.id,
                      providerTurnId,
                      nativeItemRef: null,
                      parentItemId: null,
                      ordinal: turnInput.providerTurnOrdinal * 100 + stepCount * 2 + 2,
                      status: "completed",
                      title: "Run command",
                      startedAt: toolNow,
                      completedAt: toolNow,
                      updatedAt: toolNow,
                      type: "command_execution",
                      input: String(toolArgs.command ?? ""),
                      output: truncated,
                    },
                  });
                } else {
                  yield* Queue.offer(events, {
                    type: "turn_item.updated",
                    driver: ABACUS_PROVIDER,
                    turnItem: {
                      id: toolTurnItemId,
                      threadId: turnInput.threadId,
                      runId: turnInput.runId,
                      nodeId: turnInput.rootNodeId,
                      providerThreadId: turnInput.providerThread.id,
                      providerTurnId,
                      nativeItemRef: null,
                      parentItemId: null,
                      ordinal: turnInput.providerTurnOrdinal * 100 + stepCount * 2 + 2,
                      status: "completed",
                      title: tc.function.name,
                      startedAt: toolNow,
                      completedAt: toolNow,
                      updatedAt: toolNow,
                      type: "dynamic_tool",
                      toolName: tc.function.name,
                      input: toolArgs,
                      output: truncated,
                    },
                  });
                }

                messages.push({
                  role: "tool",
                  tool_call_id: tc.id,
                  content: truncated,
                });
              }
            }

            controller.abort();
            if (active.currentProcess) {
              active.currentProcess.kill("SIGTERM");
            }

            if (active.cancelled || failure) {
              messages.length = initialMessageCount;
            } else {
              recordedTurns.push({
                turnId: providerTurnId,
                items: currentTurnItems,
              });
            }

            if (options.stateDir) {
              const currentPoints = yield* Effect.promise(() =>
                fetchAbacusComputePoints(options.apiKey, undefined, fetchFn, 3000),
              ).pipe(Effect.catchCause(() => Effect.succeed(null)));

              let credits: number | undefined;
              if (currentPoints) {
                if (lastKnownComputePoints) {
                  const usageDelta =
                    (currentPoints.currMonthUsage ?? 0) -
                    (lastKnownComputePoints.currMonthUsage ?? 0);
                  const leftDelta =
                    (lastKnownComputePoints.computePointsLeft ?? 0) -
                    (currentPoints.computePointsLeft ?? 0);
                  if (usageDelta > 0) {
                    credits = Math.round(usageDelta * 100) / 100;
                  } else if (leftDelta > 0) {
                    credits = Math.round(leftDelta * 100) / 100;
                  }
                }
                lastKnownComputePoints = currentPoints;
              }

              const usageObj = finalUsage as
                | {
                    prompt_tokens?: number;
                    input_tokens?: number;
                    completion_tokens?: number;
                    output_tokens?: number;
                    prompt_tokens_details?: { cached_tokens?: number };
                    completion_tokens_details?: { reasoning_tokens?: number };
                    cached_tokens?: number;
                    reasoning_tokens?: number;
                  }
                | undefined;
              const promptTokens = usageObj?.prompt_tokens ?? usageObj?.input_tokens ?? 0;
              const cachedTokens =
                usageObj?.prompt_tokens_details?.cached_tokens ?? usageObj?.cached_tokens ?? 0;
              let outputTokens = usageObj?.completion_tokens ?? usageObj?.output_tokens ?? 0;
              const reasoningTokens =
                usageObj?.completion_tokens_details?.reasoning_tokens ??
                usageObj?.reasoning_tokens ??
                0;

              let uncachedInput = Math.max(0, promptTokens - cachedTokens);
              if (uncachedInput === 0 && outputTokens === 0) {
                let promptChars = 0;
                for (const msg of messages) {
                  if (typeof msg.content === "string") promptChars += msg.content.length;
                }
                uncachedInput = Math.max(1, Math.ceil(promptChars / 4));
                outputTokens = 1;
              }

              if (credits === undefined || credits === 0) {
                const normModel = normalizeUsageModel(turnModel);
                const rate =
                  STATIC_FALLBACK_RATES.get(normModel) ?? STATIC_FALLBACK_RATES.get("route-llm");
                if (rate) {
                  const cost =
                    uncachedInput * rate.inputCostPerToken +
                    cachedTokens * rate.cacheReadCostPerToken +
                    outputTokens * rate.outputCostPerToken;
                  credits = Math.round((cost / ABACUS_CREDIT_COST_USD) * 100) / 100;
                }
              }

              if (uncachedInput > 0 || outputTokens > 0 || (credits !== undefined && credits > 0)) {
                yield* Effect.promise(() =>
                  appendProviderTurnUsage({
                    stateDir: options.stateDir!,
                    provider: "abacus",
                    sessionId: String(turnInput.threadId),
                    turnId: String(providerTurnId),
                    model: turnModel,
                    tokens: {
                      inputTokens: uncachedInput,
                      cachedInputTokens: cachedTokens,
                      outputTokens,
                      reasoningTokens,
                    },
                    ...(credits !== undefined ? { credits } : {}),
                  }),
                ).pipe(Effect.catchCause(() => Effect.void));
              }
            }

            if (!active.settled) {
              active.settled = true;
              if (active.cancelled) {
                yield* Queue.offer(events, {
                  type: "turn.terminal",
                  driver: ABACUS_PROVIDER,
                  providerThreadId: turnInput.providerThread.id,
                  providerTurnId,
                  runOrdinal: turnInput.runOrdinal,
                  status: "interrupted",
                  failure: null,
                  threadDisposition: "reusable",
                });
              } else if (failure) {
                yield* Queue.offer(events, {
                  type: "turn.terminal",
                  driver: ABACUS_PROVIDER,
                  providerThreadId: turnInput.providerThread.id,
                  providerTurnId,
                  runOrdinal: turnInput.runOrdinal,
                  failureItemOrdinal: 1,
                  status: "failed",
                  failure: {
                    class: "provider_error",
                    message: failure.slice(0, 4096),
                    code: null,
                    retryable: false,
                  },
                  threadDisposition: "reusable",
                });
              } else {
                yield* Queue.offer(events, {
                  type: "turn.terminal",
                  driver: ABACUS_PROVIDER,
                  providerThreadId: turnInput.providerThread.id,
                  providerTurnId,
                  runOrdinal: turnInput.runOrdinal,
                  status: "completed",
                  failure: null,
                  threadDisposition: "reusable",
                });
              }
            }

            yield* Ref.set(activeTurnRef, null);
          });

        const interruptTurn = (_interruptInput: ProviderAdapter.ProviderAdapterV2InterruptInput) =>
          Effect.gen(function* () {
            const active = yield* Ref.get(activeTurnRef);
            if (active && !active.settled) {
              active.cancelled = true;
              if (active.currentProcess) {
                active.currentProcess.kill("SIGTERM");
              }
              active.controller.abort("cancelled");
            }
          });

        const readThreadSnapshot = (
          readInput: ProviderAdapter.ProviderAdapterV2ReadThreadSnapshotInput,
        ): Effect.Effect<ProviderAdapter.ProviderAdapterV2ThreadSnapshot, never, never> =>
          Effect.sync(() => ({
            providerThread: readInput.providerThread,
            providerTurns: [],
            messages: recordedTurns.flatMap((turn) =>
              turn.items.map((item, itemIdx) => ({
                id: MessageId.make(`msg-hist-${turn.turnId}-${itemIdx}`),
                threadId: sessionInput.threadId,
                runId: null,
                nodeId: null,
                role: (item.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
                text: item.content ?? "",
                attachments: [],
                streaming: false,
                createdBy: item.role === "assistant" ? ("agent" as const) : ("user" as const),
                creationSource: "provider" as const,
                createdAt: now,
                updatedAt: now,
              })),
            ),
            runtimeRequests: [],
          }));

        return {
          instanceId: options.instanceId,
          driver: ABACUS_PROVIDER,
          providerSessionId: sessionInput.providerSessionId,
          providerSession,
          events: Stream.fromQueue(events),
          ensureThread,
          resumeThread: (resumeInput) => Effect.succeed(resumeInput.providerThread),
          startTurn,
          interruptTurn,
          steerTurn: () => Effect.void,
          respondToRuntimeRequest: () => Effect.void,
          readThreadSnapshot,
          rollbackThread: (rollbackInput) =>
            Effect.sync(() => ({
              providerThread: rollbackInput.providerThread,
              providerTurns: [],
              messages: [],
              runtimeRequests: [],
            })),
          forkThread: (forkInput) =>
            Effect.sync(() => {
              const threadIdStr = String(forkInput.targetThreadId);
              const providerThreadId = IdAllocator.derive.providerThread({
                driver: ABACUS_PROVIDER,
                nativeThreadId: threadIdStr,
                providerInstanceId: options.instanceId,
              });
              const threadNow = DateTime.nowUnsafe();
              const thread: OrchestrationV2ProviderThread = {
                id: providerThreadId,
                driver: ABACUS_PROVIDER,
                providerInstanceId: options.instanceId,
                providerSessionId: sessionInput.providerSessionId,
                appThreadId: forkInput.targetThreadId,
                ownerNodeId: forkInput.ownerNodeId ?? null,
                nativeThreadRef: {
                  driver: ABACUS_PROVIDER,
                  nativeId: threadIdStr,
                  strength: "weak",
                },
                nativeConversationHeadRef: null,
                status: "idle",
                firstRunOrdinal: null,
                lastRunOrdinal: null,
                handoffIds: [],
                forkedFrom: {
                  providerThreadId: forkInput.sourceProviderThread.id,
                  ...(forkInput.providerTurnId === undefined
                    ? {}
                    : { providerTurnId: forkInput.providerTurnId }),
                },
                createdAt: threadNow,
                updatedAt: threadNow,
              };
              threads.set(threadIdStr, thread);
              return thread;
            }),
        } satisfies ProviderAdapter.ProviderAdapterV2SessionRuntime;
      },
    ),
  });
});

export type AbacusAdapterV2DriverEnv = never;

export const AbacusAdapterV2Driver: ProviderAdapterDriver<
  AbacusSettings,
  AbacusAdapterV2DriverEnv
> = {
  driverKind: ABACUS_PROVIDER,
  configSchema: AbacusSettings,
  defaultConfig: (): AbacusSettings => decodeAbacusSettings({}),
  create: Effect.fn("AbacusAdapterV2Driver.create")(
    function* (input: ProviderAdapterDriverCreateInput<AbacusSettings>) {
      const host = yield* Effect.serviceOption(ProviderHost.ProviderHost);
      const apiKey =
        input.environment.find((entry) => entry.name === "ABACUS_API_KEY")?.value.trim() ?? "";
      return yield* makeAbacusAdapterV2({
        instanceId: input.instanceId,
        apiBaseUrl: input.config.apiBaseUrl || ABACUS_DEFAULT_API_BASE_URL,
        apiKey,
        defaultModel: "route-llm",
        stateDir: Option.isSome(host) ? host.value.paths.stateDir : undefined,
      });
    },
  ),
};
