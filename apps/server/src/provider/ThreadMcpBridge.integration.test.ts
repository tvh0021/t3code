import { NodeHttpServer } from "@effect/platform-node";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/unstable/ai";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { makeThreadMcpBridge } from "./ThreadMcpBridge.ts";

it.effect("discovers and calls thread tools through the real MCP HTTP protocol", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const toolkit = Toolkit.make(
        Tool.make("read_thread", {
          description: "Read thread",
          parameters: Schema.Struct({ threadId: Schema.optional(Schema.String) }),
          success: Schema.Struct({ threadId: Schema.String }),
          failure: Schema.Never,
        }),
      );
      const registration = McpServer.toolkit(toolkit).pipe(
        Layer.provide(
          toolkit.toLayer({ read_thread: () => Effect.succeed({ threadId: "fixture" }) }),
        ),
        Layer.provideMerge(
          McpServer.layerHttp({
            name: "T3 transport verification",
            version: "1",
            path: "/mcp",
            protocols: [McpProtocol.v2025_06_18],
          }),
        ),
      );
      yield* HttpRouter.serve(registration, { disableListenLog: true, disableLogger: true }).pipe(
        Layer.build,
      );
      const server = yield* HttpServer.HttpServer;
      if (server.address._tag === "UnixPathAddress") throw new Error("Expected TCP fixture");
      const bridge = makeThreadMcpBridge(
        {
          environmentId: EnvironmentId.make("environment"),
          providerInstanceId: ProviderInstanceId.make("abacus"),
          threadId: ThreadId.make("thread"),
          providerSessionId: "session",
          endpoint: `http://127.0.0.1:${server.address.port}/mcp`,
          authorizationHeader: "Bearer fixture-only",
          capabilities: new Set(["threads"]),
        },
        globalThis.fetch,
      );
      const signal = AbortSignal.timeout(10_000);
      const tools = yield* Effect.promise(() => bridge.initialize(signal));
      expect(tools.map((tool) => tool.function.name)).toEqual(["t3_read_thread"]);
      const output = yield* Effect.promise(() => bridge.call("t3_read_thread", {}, signal));
      expect(output).toContain("fixture");
    }),
  ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);
