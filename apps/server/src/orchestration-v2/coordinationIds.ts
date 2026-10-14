import {
  CommandId,
  MessageId,
  type OrchestrationCommand,
  type OrchestrationThread,
  type ThreadCoordination,
  type ThreadId,
  type TurnId,
} from "@t3tools/contracts";
import type * as Path from "effect/Path";
import type { ServerDerivedPaths } from "../config.ts";

type Worker = Extract<ThreadCoordination, { role: "child" }>;

export const coordinationMessageId = (assignmentId: string) =>
  MessageId.make(`coordination:${assignmentId}`);

export function workerCompletionCommand(
  threadId: ThreadId,
  worker: Pick<Worker, "assignmentId" | "handoffStage">,
  text: string,
  createdAt: string,
): Extract<OrchestrationCommand, { type: "thread.coordination" }> {
  const isQuotaHandoffSummary = worker.handoffStage === "summarize";
  return {
    type: "thread.coordination",
    threadId,
    commandId: CommandId.make(
      `coordination:${isQuotaHandoffSummary ? "summary" : "finish"}:${worker.assignmentId}`,
    ),
    action: isQuotaHandoffSummary
      ? { type: "handoff-summary-complete", text }
      : { type: "finish", assignmentId: worker.assignmentId, text },
    createdAt,
  };
}

export function assistantTextForTurn(
  messages: ReadonlyArray<
    Pick<OrchestrationThread["messages"][number], "role" | "turnId" | "text">
  >,
  turnId: TurnId,
): string {
  return messages
    .filter((message) => message.role === "assistant" && message.turnId === turnId)
    .map((message) => message.text)
    .join("\n\n")
    .trim()
    .slice(0, 8_000);
}

export function coordinationReviewDir(
  config: Pick<ServerDerivedPaths, "worktreesDir">,
  id: ThreadId,
  path: Pick<Path.Path, "join">,
): string {
  return path.join(config.worktreesDir, "coordination-reviews", id);
}
