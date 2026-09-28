// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import { expect, it } from "@effect/vitest";
import { cleanOrphanReviewSnapshots } from "./storageCleanup.ts";

it.effect(
  "recovers orphan snapshots after a missed deletion while retaining referenced and in-flight snapshots",
  () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(async () =>
        NodeFSP.realpath(
          await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-review-cleanup-")),
        ),
      );
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => NodeFSP.rm(root, { recursive: true, force: true })),
      );
      const ids = [
        "00000000-0000-0000-0000-000000000001",
        "00000000-0000-0000-0000-000000000002",
        "00000000-0000-0000-0000-000000000003",
      ];
      const paths = ids.map((id) => NodePath.join(root, id));
      const now = 1_800_000_000_000;
      const old = (now - 2 * 60 * 60 * 1000) / 1000;
      for (const target of paths) {
        yield* Effect.promise(() => NodeFSP.mkdir(target));
        yield* Effect.promise(() =>
          NodeFSP.writeFile(NodePath.join(target, "review.txt"), "retained review"),
        );
        yield* Effect.promise(() => NodeFSP.utimes(target, old, old));
      }
      const inFlight = paths[2]!;
      yield* Effect.promise(() => NodeFSP.utimes(inFlight, now / 1000, now / 1000));
      const unrelated = NodePath.join(root, "unrelated");
      yield* Effect.promise(() => NodeFSP.mkdir(unrelated));
      yield* Effect.promise(() => NodeFSP.utimes(unrelated, old, old));
      yield* cleanOrphanReviewSnapshots(root, new Set([paths[0]!]), now).pipe(
        Effect.provide(NodeServices.layer),
      );
      expect(yield* Effect.promise(() => NodeFSP.readdir(root))).toEqual(
        expect.arrayContaining([ids[0], ids[2], "unrelated"]),
      );
      expect(
        yield* Effect.promise(() =>
          NodeFSP.stat(paths[1]!).then(
            () => true,
            () => false,
          ),
        ),
      ).toBe(false);
      expect(
        yield* Effect.promise(() =>
          NodeFSP.readFile(NodePath.join(paths[0]!, "review.txt"), "utf8"),
        ),
      ).toBe("retained review");
    }),
);
