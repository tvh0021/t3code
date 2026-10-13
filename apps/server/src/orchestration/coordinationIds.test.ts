import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import { ThreadId, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import {
  assistantTextForTurn,
  coordinationMessageId,
  coordinationReviewDir,
  workerCompletionCommand,
} from "./coordinationIds.ts";

describe("coordination ids", () => {
  it.effect("preserves assignment ids, completion commands, and review snapshot paths", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const threadId = ThreadId.make("36a938fd-f687-4c26-9f30-8ed92c778425");
      const assignmentId = "mcp:6f0cce68-d588-40e4-8998-1429e91e376e";
      const createdAt = "2026-10-13T12:00:00.000Z";
      expect(coordinationMessageId(assignmentId)).toBe(
        "coordination:mcp:6f0cce68-d588-40e4-8998-1429e91e376e",
      );
      expect(workerCompletionCommand(threadId, { assignmentId }, "report", createdAt)).toEqual({
        type: "thread.coordination",
        threadId,
        commandId: "coordination:finish:mcp:6f0cce68-d588-40e4-8998-1429e91e376e",
        action: { type: "finish", assignmentId, text: "report" },
        createdAt,
      });
      expect(
        workerCompletionCommand(
          threadId,
          { assignmentId, handoffStage: "summarize" },
          "summary",
          createdAt,
        ),
      ).toEqual({
        type: "thread.coordination",
        threadId,
        commandId: "coordination:summary:mcp:6f0cce68-d588-40e4-8998-1429e91e376e",
        action: { type: "handoff-summary-complete", text: "summary" },
        createdAt,
      });
      expect(coordinationReviewDir({ worktreesDir: "/tmp/t3/worktrees" }, threadId, path)).toBe(
        "/tmp/t3/worktrees/coordination-reviews/36a938fd-f687-4c26-9f30-8ed92c778425",
      );
    }).pipe(Effect.provide(Path.layer)),
  );

  it("joins only the requested turn's assistant text before trimming and truncating", () => {
    const turnId = TurnId.make("turn-1");
    const messages = [
      { role: "user" as const, turnId, text: "ignored user" },
      { role: "assistant" as const, turnId: TurnId.make("turn-2"), text: "ignored turn" },
      { role: "assistant" as const, turnId, text: "  first" },
      { role: "assistant" as const, turnId, text: "second  " },
    ];
    expect(assistantTextForTurn(messages, turnId)).toBe("first\n\nsecond");
    expect(
      assistantTextForTurn(
        [{ role: "assistant", turnId, text: `  ${"a".repeat(8_001)}  ` }],
        turnId,
      ),
    ).toBe("a".repeat(8_000));
    expect(assistantTextForTurn([], turnId)).toBe("");
  });
});
