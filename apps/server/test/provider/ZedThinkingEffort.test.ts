import * as NodeFS from "node:fs";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { ModelSelection, ProviderInstanceId, ThreadId, ZedSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect } from "vite-plus/test";
import { ServerConfig } from "../../src/config.ts";
import { makeZedAdapter } from "../../src/provider/Layers/ZedAdapter.ts";
import { writeFakeCli } from "../../src/testUtils/fakeCli.ts";

const decodeSelection = Schema.decodeSync(Schema.fromJsonString(ModelSelection));
const decodeSettings = Schema.decodeSync(ZedSettings);
const decodeRequests = Schema.decodeSync(
  Schema.fromJsonString(
    Schema.Array(
      Schema.Struct({
        model: Schema.String,
        effort: Schema.NullOr(Schema.String),
      }),
    ),
  ),
);

describe("Zed thinking effort", () => {
  it.effect(
    "applies changes before prompts, restores defaults, switches models and reapplies stored selections",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped();
        const logPath = `${directory}/requests.json`;
        const binaryPath = writeFakeCli({
          directory,
          name: "zed",
          source: `
        import fs from "node:fs";
        import readline from "node:readline";
        let model = process.argv[process.argv.indexOf("--model") + 1];
        let effort = "low";
        const requests = [];
        const configs = () => model === "plain" ? [] : [{
          id: "thinking_effort", name: "Thinking effort", type: "select", category: "thought_level",
          currentValue: effort, _meta: { defaultValue: "low" },
          options: (model === "low-only" ? ["low"] : ["low", "high"]).map(value => ({ value, name: value })),
        }];
        readline.createInterface({ input: process.stdin }).on("line", line => {
          const { id, method, params } = JSON.parse(line);
          const reply = result => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
          if (method === "initialize") reply({ protocolVersion: 1, agentCapabilities: {} });
          else if (method === "session/new") reply({ sessionId: "native-session", configOptions: configs() });
          else if (method === "session/set_config_option") {
            if (params.configId === "model") { model = params.value; effort = "low"; }
            else effort = params.value;
            reply({ configOptions: configs() });
          } else if (method === "session/prompt") {
            requests.push({ model, effort: model === "plain" ? null : effort });
            fs.writeFileSync(${JSON.stringify(logPath)}, JSON.stringify(requests));
            reply({ stopReason: "end_turn" });
          } else reply({});
        });
      `,
        });
        const adapter = yield* makeZedAdapter(decodeSettings({ binaryPath }));
        const threadId = ThreadId.make("zed-effort");
        const selection = (model: string, effort?: string) => ({
          instanceId: ProviderInstanceId.make("zed"),
          model,
          ...(effort ? { options: [{ id: "thinking_effort", value: effort }] } : {}),
        });
        const modelSelection = decodeSelection(JSON.stringify(selection("first", "high")));
        yield* adapter.startSession({ threadId, runtimeMode: "full-access", modelSelection });
        yield* adapter.sendTurn({ threadId, input: "initial" });
        yield* adapter.sendTurn({
          threadId,
          input: "lower",
          modelSelection: selection("first", "low"),
        });
        yield* adapter.sendTurn({
          threadId,
          input: "raise",
          modelSelection: selection("first", "high"),
        });
        yield* adapter.sendTurn({ threadId, input: "default", modelSelection: selection("first") });
        yield* adapter.sendTurn({
          threadId,
          input: "switch",
          modelSelection: selection("second", "high"),
        });
        yield* adapter.sendTurn({
          threadId,
          input: "incompatible",
          modelSelection: selection("low-only"),
        });
        yield* adapter.sendTurn({
          threadId,
          input: "no effort",
          modelSelection: selection("plain"),
        });
        expect(decodeRequests(NodeFS.readFileSync(logPath, "utf8"))).toEqual([
          { model: "first", effort: "high" },
          { model: "first", effort: "low" },
          { model: "first", effort: "high" },
          { model: "first", effort: "low" },
          { model: "second", effort: "high" },
          { model: "low-only", effort: "low" },
          { model: "plain", effort: null },
        ]);
        const unsupported = yield* adapter
          .sendTurn({
            threadId,
            input: "must not dispatch",
            modelSelection: selection("plain", "high"),
          })
          .pipe(Effect.result);
        expect(unsupported._tag).toBe("Failure");
        expect(decodeRequests(NodeFS.readFileSync(logPath, "utf8"))).toHaveLength(7);

        const session = (yield* adapter.listSessions())[0];
        yield* adapter.stopSession(threadId);
        yield* adapter.startSession({
          threadId,
          runtimeMode: "full-access",
          modelSelection,
          resumeCursor: session?.resumeCursor,
        });
        yield* adapter.sendTurn({ threadId, input: "restored" });
        expect(decodeRequests(NodeFS.readFileSync(logPath, "utf8"))).toEqual([
          { model: "first", effort: "high" },
        ]);
        yield* adapter.stopSession(threadId);
      }).pipe(
        Effect.scoped,
        Effect.provide(
          ServerConfig.layerTest(process.cwd(), { prefix: "t3-zed-effort-" }).pipe(
            Layer.provideMerge(NodeServices.layer),
          ),
        ),
      ),
  );
});
