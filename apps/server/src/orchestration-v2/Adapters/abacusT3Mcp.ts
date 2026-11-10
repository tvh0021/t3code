// @effect-diagnostics preferSchemaOverJson:off
// MCP wire bodies are untyped JSON-RPC parsed inside fetch callbacks, as in the Pi bridge.
const PROTOCOL = "2025-06-18";

/** Sent on every request; the rest load through `load_t3_tools` to keep requests small. */
export const ABACUS_DIRECT_T3_TOOLS: ReadonlySet<string> = new Set([
  "orchestrator_capabilities",
  "delegate_task",
  "task_status",
  "task_cancel",
  "t3_thread_read",
]);

export const LOAD_T3_TOOLS = "load_t3_tools";

export interface T3McpTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: Record<string, unknown>;
}

interface JsonRpcResponse {
  readonly id?: number | string;
  readonly result?: unknown;
  readonly error?: { readonly message?: string };
}

function parseSseOrJson(body: string, contentType: string): JsonRpcResponse {
  if (!contentType.includes("text/event-stream")) return JSON.parse(body) as JsonRpcResponse;
  for (const line of body.split("\n")) {
    const data = line.startsWith("data:") ? line.slice(5).trim() : "";
    if (data.length === 0) continue;
    const parsed = JSON.parse(data) as JsonRpcResponse;
    if (parsed.id !== undefined || parsed.result !== undefined || parsed.error !== undefined) {
      return parsed;
    }
  }
  throw new Error("MCP SSE response had no JSON-RPC payload.");
}

// MCP answers 404 for a session it no longer knows, even when the request already ran.
// @effect-diagnostics-next-line extendsNativeError:off -- thrown and caught inside the client's promises, never an Effect failure.
class McpSessionExpired extends Error {}

export interface T3McpClient {
  readonly listTools: (signal?: AbortSignal) => Promise<ReadonlyArray<T3McpTool>>;
  readonly callTool: (
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<unknown>;
}

export function makeT3McpClient(input: {
  readonly endpoint: string;
  readonly authorizationHeader: string;
  readonly fetch: typeof globalThis.fetch;
}): T3McpClient {
  let nextId = 1;
  let sessionId: string | undefined;
  let initialized: Promise<void> | undefined;

  const headers = (): Record<string, string> => ({
    accept: "application/json, text/event-stream",
    authorization: input.authorizationHeader,
    "content-type": "application/json",
    // Effect's HTTP MCP rejects post-initialize requests without it.
    "mcp-protocol-version": PROTOCOL,
    ...(sessionId === undefined ? {} : { "mcp-session-id": sessionId }),
  });

  const post = async (payload: Record<string, unknown>, signal?: AbortSignal) => {
    const response = await input.fetch(input.endpoint, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ jsonrpc: "2.0", ...payload }),
      ...(signal === undefined ? {} : { signal }),
    });
    sessionId = response.headers.get("mcp-session-id") ?? sessionId;
    return response;
  };

  const request = async (method: string, params: unknown, signal?: AbortSignal) => {
    const response = await post({ id: nextId++, method, params }, signal);
    const body = await response.text();
    if (response.status === 404 && sessionId !== undefined && method !== "initialize") {
      throw new McpSessionExpired(`MCP session ${sessionId} expired`);
    }
    if (!response.ok) {
      throw new Error(`MCP ${method} failed (${response.status}): ${body.slice(0, 400)}`);
    }
    if (body.length === 0) return undefined;
    const parsed = parseSseOrJson(body, response.headers.get("content-type") ?? "");
    if (parsed.error) throw new Error(parsed.error.message ?? `MCP ${method} returned an error`);
    return parsed.result;
  };

  const ensureInitialized = (signal?: AbortSignal) => {
    initialized ??= (async () => {
      await request(
        "initialize",
        {
          protocolVersion: PROTOCOL,
          capabilities: {},
          clientInfo: { name: "t3-chatllm", version: "1.0.0" },
        },
        signal,
      );
      await post({ method: "notifications/initialized", params: {} }, signal).catch(
        () => undefined,
      );
    })().catch((error: unknown) => {
      initialized = undefined;
      throw error;
    });
    return initialized;
  };

  // The next request opens a new session. Only a read-only `run` is replayed here.
  const withSession = async <A>(
    run: () => Promise<A>,
    replay: boolean,
    signal?: AbortSignal,
  ): Promise<A> => {
    await ensureInitialized(signal);
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof McpSessionExpired)) throw error;
      sessionId = undefined;
      initialized = undefined;
      if (!replay) {
        throw new Error(
          "T3 Code's MCP session ended during this call, so it may have run. Check its effect before calling it again.",
          { cause: error },
        );
      }
      await ensureInitialized(signal);
      return run();
    }
  };

  const listAll = async (signal?: AbortSignal) => {
    const tools: T3McpTool[] = [];
    let cursor: string | undefined;
    do {
      const result = (await request(
        "tools/list",
        cursor === undefined ? {} : { cursor },
        signal,
      )) as { tools?: T3McpTool[]; nextCursor?: string } | undefined;
      tools.push(...(result?.tools ?? []));
      cursor = result?.nextCursor;
    } while (cursor);
    return tools;
  };

  return {
    listTools: (signal) => withSession(() => listAll(signal), true, signal),
    callTool: (name, args, signal) =>
      withSession(() => request("tools/call", { name, arguments: args }, signal), false, signal),
  };
}

/** Chat-completions function definition for an MCP tool. */
export function t3ToolDefinition(tool: T3McpTool) {
  const schema = tool.inputSchema ?? {};
  return {
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description ?? tool.name,
      // Zero-argument MCP tools may omit "properties", which some OpenAI-compatible servers reject.
      parameters: {
        ...schema,
        type: schema.type ?? "object",
        ...(schema.properties === undefined ? { properties: {} } : {}),
      },
    },
  };
}

export const LOAD_T3_TOOLS_DEFINITION = {
  type: "function" as const,
  function: {
    name: LOAD_T3_TOOLS,
    description:
      "Load T3 Code tools by name so you can call them. Their schemas are available from your next tool call on.",
    parameters: {
      type: "object",
      properties: {
        names: {
          type: "array",
          items: { type: "string" },
          description: "T3 Code tool names, such as t3_thread_wait.",
        },
      },
      required: ["names"],
    },
  },
};

/** Model-facing text for a tools/call result. ChatLLM takes no images, so they become notes. */
export function t3ToolResultText(result: unknown): {
  readonly text: string;
  readonly isError: boolean;
} {
  const record =
    typeof result === "object" && result !== null
      ? (result as {
          readonly content?: ReadonlyArray<{ readonly type?: string; readonly text?: string }>;
          readonly structuredContent?: unknown;
          readonly isError?: boolean;
        })
      : undefined;
  const parts: string[] = [];
  for (const part of record?.content ?? []) {
    if (part?.type === "text" && typeof part.text === "string") parts.push(part.text);
    else if (part?.type === "image") parts.push("[image omitted: ChatLLM cannot view images]");
  }
  if (parts.length === 0) parts.push(JSON.stringify(record?.structuredContent ?? result ?? null));
  return { text: parts.join("\n"), isError: record?.isError === true };
}
