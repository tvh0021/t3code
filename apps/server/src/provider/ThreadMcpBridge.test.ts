import { expect, it } from "vite-plus/test";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { makeThreadMcpBridge } from "./ThreadMcpBridge.ts";

it("initializes a scoped MCP session, filters tools, and forwards calls with the session header", async () => {
  const methods: string[] = [];
  const fetch: typeof globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    methods.push(body.method);
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer test-only");
    if (body.method !== "initialize") expect(headers.get("mcp-session-id")).toBe("session");
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    const result =
      body.method === "initialize"
        ? { protocolVersion: "2025-06-18" }
        : body.method === "tools/list"
          ? {
              tools: [
                {
                  name: "start_orchestration_layer",
                  description: "Start orchestration",
                  inputSchema: { type: "object" },
                },
                {
                  name: "spawn_child",
                  description: "Queue child",
                  inputSchema: { type: "object" },
                },
                { name: "preview_click", inputSchema: { type: "object" } },
              ],
            }
          : { structuredContent: { threadId: "child" }, content: [] };
    if (body.method === "tools/call")
      expect(body.params).toEqual({ name: "spawn_child", arguments: { title: "Review" } });
    const data = `data: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result })}\n\n`;
    return new Response(data, {
      headers: { "content-type": "text/event-stream", "mcp-session-id": "session" },
    });
  };
  const bridge = makeThreadMcpBridge(
    {
      environmentId: EnvironmentId.make("environment"),
      threadId: ThreadId.make("parent"),
      providerInstanceId: ProviderInstanceId.make("abacus"),
      providerSessionId: "provider",
      endpoint: "http://localhost/mcp",
      authorizationHeader: "Bearer test-only",
      capabilities: new Set(["threads"]),
    },
    fetch,
  );
  const signal = new AbortController().signal;
  expect(await bridge.initialize(signal)).toEqual([
    {
      type: "function",
      function: {
        name: "t3_start_orchestration_layer",
        description: "Start orchestration",
        parameters: { type: "object" },
      },
    },
    {
      type: "function",
      function: {
        name: "t3_spawn_child",
        description: "Queue child",
        parameters: { type: "object" },
      },
    },
  ]);
  expect(
    JSON.parse(await bridge.call("t3_spawn_child", { title: "Review" }, signal)),
  ).toMatchObject({ structuredContent: { threadId: "child" } });
  await expect(bridge.call("t3_preview_click", {}, signal)).rejects.toThrow(
    "Unknown T3 thread tool",
  );
  expect(methods).toEqual(["initialize", "notifications/initialized", "tools/list", "tools/call"]);
});
