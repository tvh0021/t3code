import { expect, it } from "vite-plus/test";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { makeThreadMcpBridge, threadTools } from "./ThreadMcpBridge.ts";

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
                  description: "Spawn child",
                  inputSchema: { type: "object" },
                },
                {
                  name: "t3_preview_click",
                  description: "Click preview",
                  inputSchema: { type: "object" },
                },
              ],
            }
          : { structuredContent: { threadId: "child" } };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const signal = new AbortController().signal;
  const bridge = makeThreadMcpBridge(
    {
      environmentId: EnvironmentId.make("env"),
      threadId: ThreadId.make("thread"),
      instanceId: ProviderInstanceId.make("zed"),
      endpointUrl: "http://127.0.0.1:4000/mcp",
      token: "test-only",
      sessionId: "session",
    },
    fetch,
    "parent",
  );
  await expect(bridge.initialize(signal)).resolves.toEqual([
    {
      name: "t3_start_orchestration_layer",
      description: "Start orchestration",
      parameters: { type: "object" },
    },
    {
      name: "t3_spawn_child",
      description: "Spawn child",
      parameters: {
        type: "object",
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

it("keeps the bridge thread-tool set populated", () => {
  expect(threadTools.size).toBeGreaterThan(0);
});
