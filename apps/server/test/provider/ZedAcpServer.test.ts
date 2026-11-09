import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { describe, expect, it } from "@effect/vitest";
import { writeFakeCli } from "@t3tools/provider-testing/fakeCli";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Result from "effect/Result";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { makeZedAcpRuntime } from "../../src/provider/acp/ZedAcpSupport.ts";

const initialize = Effect.fn("test.initializeZed")(function* (binaryPath: string, cwd: string) {
  const runtime = yield* makeZedAcpRuntime({
    cwd,
    childProcessSpawner: yield* ChildProcessSpawner.ChildProcessSpawner,
    zedSettings: { binaryPath, dataDir: cwd, model: "" },
  });
  return yield* runtime.initialize();
});

describe("Zed ACP initialization", () => {
  it.live("negotiates the bridge's capabilities without opening a model session", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped();
      const binaryPath = writeFakeCli({
        directory,
        name: "zed-acp-server",
        source: `import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method !== "initialize") process.exit(2);
  console.log(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {
    protocolVersion: 1,
    serverInfo: { name: "zed-acp-server", version: "0.2.2" },
    capabilities: { elicitation: { form: true }, tools: true }
  }}));
});`,
      });
      const response = yield* initialize(binaryPath, directory);
      expect(response.protocolVersion).toBe(1);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer), Effect.provide(NodeCrypto.layer)),
  );

  it.live.each(["missing", "exited"] as const)(
    "reports bridge startup failure (%s) instead of leaving initialization pending",
    (failure) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped();
        const binaryPath =
          failure === "missing"
            ? `${directory}/missing-zed-acp-server`
            : writeFakeCli({ directory, name: "zed-acp-server", source: "process.exit(1);" });
        const result = yield* initialize(binaryPath, directory).pipe(Effect.result);
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure._tag).toBe(
            failure === "missing" ? "AcpSpawnError" : "AcpProcessExitedError",
          );
        }
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer), Effect.provide(NodeCrypto.layer)),
  );
});
