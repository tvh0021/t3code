import type { McpProviderSessionConfig } from "../mcp/McpProviderSession.ts";
import * as Schema from "effect/Schema";

const ToolList = Schema.Struct({
  tools: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      description: Schema.optional(Schema.String),
      inputSchema: Schema.Record(Schema.String, Schema.Unknown),
    }),
  ),
});
const RpcResponse = Schema.Struct({
  id: Schema.optional(Schema.Union([Schema.String, Schema.Number, Schema.Null])),
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.Struct({ message: Schema.String })),
});
const decodeToolList = Schema.decodeUnknownSync(ToolList);
const decodeRpcResponse = Schema.decodeUnknownSync(RpcResponse);
const threadTools = new Set([
  "start_thread_workflow",
  "spawn_child",
  "assign_child",
  "report_to_parent",
  "wait_for_children",
  "read_thread_workflow",
  "control_thread_workflow",
  "refresh_coordination_policy",
  "list_thread_models",
  "create_thread",
  "read_thread",
  "send_message_to_thread",
  "interrupt_thread",
]);

/** Session-scoped MCP transport for providers whose tool loop is owned by T3. */
export function makeThreadMcpBridge(
  config: McpProviderSessionConfig,
  fetch: typeof globalThis.fetch,
  role?: "parent" | "review" | "edit",
) {
  const allowed =
    role === "review" || role === "edit"
      ? new Set(["report_to_parent", "read_thread_workflow", "read_thread"])
      : threadTools;
  let nextId = 0;
  let sessionId: string | undefined;
  const request = async (
    method: string,
    params: unknown,
    signal: AbortSignal,
    notification = false,
  ) => {
    const id = notification ? undefined : ++nextId;
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        Authorization: config.authorizationHeader,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-06-18",
        ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", ...(id === undefined ? {} : { id }), method, params }),
      signal,
    });
    if (!response.ok) throw new Error(`T3 thread tools returned HTTP ${response.status}.`);
    sessionId = response.headers.get("mcp-session-id") ?? sessionId;
    if (notification) return;
    const settle = (value: unknown) => {
      const message = decodeRpcResponse(value);
      if (message.id !== id) return undefined;
      if (message.error) throw new Error(message.error.message);
      return { value: message.result };
    };
    if (response.headers.get("content-type")?.includes("application/json")) {
      const result = settle(await response.json());
      if (result) return result.value;
    } else if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer = (buffer + decoder.decode(chunk.value, { stream: true })).replace(/\r\n/g, "\n");
          let boundary: number;
          while ((boundary = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = frame
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart())
              .join("\n");
            if (!data) continue;
            const result = settle(JSON.parse(data));
            if (result) return result.value;
          }
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
    }
    throw new Error("T3 thread tools returned no matching MCP response.");
  };
  return {
    initialize: async (signal: AbortSignal) => {
      await request(
        "initialize",
        {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "t3-provider-tools", version: "1" },
        },
        signal,
      );
      await request("notifications/initialized", {}, signal, true);
      const list = decodeToolList(await request("tools/list", {}, signal));
      return list.tools
        .filter((tool) => allowed.has(tool.name))
        .map((tool) => ({
          type: "function" as const,
          function: {
            name: `t3_${tool.name}`,
            description: tool.description ?? tool.name,
            parameters: tool.inputSchema,
          },
        }));
    },
    call: async (name: string, args: Record<string, unknown>, signal: AbortSignal) => {
      const tool = name.startsWith("t3_") ? name.slice(3) : "";
      if (!allowed.has(tool)) throw new Error("Unknown T3 thread tool.");
      return JSON.stringify(await request("tools/call", { name: tool, arguments: args }, signal));
    },
  };
}
