import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import { coordinationReviewDir } from "./coordinationIds.ts";

describe("coordination ids", () => {
  it.effect("resolves review snapshot paths", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const threadId = ThreadId.make("36a938fd-f687-4c26-9f30-8ed92c778425");
      expect(coordinationReviewDir({ worktreesDir: "/tmp/t3/worktrees" }, threadId, path)).toBe(
        "/tmp/t3/worktrees/coordination-reviews/36a938fd-f687-4c26-9f30-8ed92c778425",
      );
    }).pipe(Effect.provide(Path.layer)),
  );
});
