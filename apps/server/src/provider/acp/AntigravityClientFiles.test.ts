import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { writeAntigravityClientTextFile } from "./AntigravityClientFiles.ts";

/** A workspace reached through a symlink, like macOS temp dirs under `/var`. */
const linkedWorkspace = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const base = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-ag-client-files-" });
  const target = path.join(base, "real");
  yield* fileSystem.makeDirectory(target);
  const workspace = path.join(base, "linked");
  yield* fileSystem.symlink(target, workspace);
  return { fileSystem, path, base, target, workspace };
});

describe("AntigravityClientFiles", () => {
  it.effect("writes a new file in new directories under a symlinked workspace", () =>
    Effect.gen(function* () {
      const { fileSystem, path, target, workspace } = yield* linkedWorkspace;
      yield* writeAntigravityClientTextFile({
        fileSystem,
        path,
        allowedRoots: [workspace],
        request: {
          sessionId: "session",
          path: path.join(workspace, "src", "nested", "new.ts"),
          content: "created",
        },
      });
      assert.strictEqual(
        yield* fileSystem.readFileString(path.join(target, "src", "nested", "new.ts")),
        "created",
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("refuses new paths outside the workspace and through dangling links", () =>
    Effect.gen(function* () {
      const { fileSystem, path, base, workspace } = yield* linkedWorkspace;
      yield* fileSystem.symlink(path.join(base, "missing"), path.join(workspace, "dangling"));
      for (const requestPath of [
        path.join(base, "outside", "new.ts"),
        path.join(workspace, "..", "escape", "new.ts"),
        path.join(workspace, "dangling", "new.ts"),
      ]) {
        const result = yield* writeAntigravityClientTextFile({
          fileSystem,
          path,
          allowedRoots: [workspace],
          request: { sessionId: "session", path: requestPath, content: "nope" },
        }).pipe(Effect.result);
        assert.strictEqual(result._tag, "Failure", requestPath);
      }
      assert.isFalse(yield* fileSystem.exists(path.join(base, "missing")));
      assert.isFalse(yield* fileSystem.exists(path.join(base, "outside")));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
