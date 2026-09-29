import * as Schema from "effect/Schema";
import {
  IsoDateTime,
  NonNegativeInt,
  ThreadId,
  TurnId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

export const CoordinationBudget = Schema.Struct({
  model: TrimmedNonEmptyString,
  limit: Schema.NullOr(NonNegativeInt),
  used: NonNegativeInt,
});
export type CoordinationBudget = typeof CoordinationBudget.Type;

export const CoordinationQuotaHandoff = Schema.Struct({
  enabled: Schema.Boolean,
  switchCount: NonNegativeInt,
  status: Schema.Literals([
    "watching",
    "waiting-reset",
    "handing-off",
    "summarizing",
    "paused",
    "handed-off",
  ]),
  affectedThreadId: Schema.optional(ThreadId),
  sourceThreadId: Schema.optional(ThreadId),
  destinationThreadId: Schema.optional(ThreadId),
  sourceModel: Schema.optional(TrimmedNonEmptyString),
  destinationInstanceId: Schema.optional(TrimmedNonEmptyString),
  destinationModel: Schema.optional(TrimmedNonEmptyString),
  resetAt: Schema.optional(IsoDateTime),
  reason: Schema.optional(Schema.String),
});
export type CoordinationQuotaHandoff = typeof CoordinationQuotaHandoff.Type;

export const ThreadCoordination = Schema.Union([
  Schema.Struct({
    role: Schema.Literal("parent"),
    status: Schema.Literals(["active", "paused", "completed", "cancelled"]),
    waiting: Schema.Boolean,
    waitTurnId: Schema.optional(TurnId),
    activating: Schema.optional(Schema.Boolean),
    maxChildren: NonNegativeInt,
    budgets: Schema.Array(CoordinationBudget),
    quotaHandoff: Schema.optional(CoordinationQuotaHandoff),
    policyUpdatedAt: IsoDateTime,
    blockedReason: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    role: Schema.Literal("child"),
    parentId: ThreadId,
    assignmentId: TrimmedNonEmptyString,
    turnId: Schema.optional(Schema.NullOr(TurnId)),
    phase: Schema.Literals(["queued", "running", "reported", "cancelled"]),
    prompt: Schema.String,
    report: Schema.NullOr(Schema.Struct({ id: TrimmedNonEmptyString, text: Schema.String })),
    adopted: Schema.Boolean,
    mode: Schema.Literals(["review", "edit"]),
    reviewRef: Schema.NullOr(TrimmedNonEmptyString),
    handoffFromThreadId: Schema.optional(ThreadId),
    handoffContext: Schema.optional(Schema.String.check(Schema.isMaxLength(40_000))),
    handoffStage: Schema.optional(Schema.Literals(["summarize", "continue"])),
  }),
]);
export type ThreadCoordination = typeof ThreadCoordination.Type;

// Shells carry counters and report identities, never assignment prompts or report bodies.
export const ThreadCoordinationSummary = Schema.Union([
  ThreadCoordination.members[0],
  Schema.Struct({
    role: Schema.Literal("child"),
    parentId: ThreadId,
    assignmentId: TrimmedNonEmptyString,
    phase: Schema.Literals(["queued", "running", "reported", "cancelled"]),
    report: Schema.NullOr(Schema.Struct({ id: TrimmedNonEmptyString })),
    adopted: Schema.Boolean,
    mode: Schema.Literals(["review", "edit"]),
    reviewRef: Schema.NullOr(TrimmedNonEmptyString),
    handoffFromThreadId: Schema.optional(ThreadId),
  }),
]);
export type ThreadCoordinationSummary = typeof ThreadCoordinationSummary.Type;

export function summarizeCoordination(
  state: ThreadCoordination | null | undefined,
): ThreadCoordinationSummary | null {
  if (!state) return null;
  if (state.role === "parent") return state;
  return {
    role: state.role,
    parentId: state.parentId,
    assignmentId: state.assignmentId,
    phase: state.phase,
    report: state.report ? { id: state.report.id } : null,
    adopted: state.adopted,
    mode: state.mode,
    reviewRef: state.reviewRef,
    ...(state.handoffFromThreadId ? { handoffFromThreadId: state.handoffFromThreadId } : {}),
  };
}

export const CoordinationControl = Schema.Literals([
  "pause",
  "resume",
  "cancel",
  "complete",
  "enable-quota-handoff",
  "disable-quota-handoff",
]);

export type CoordinationControl = typeof CoordinationControl.Type;

/** Terminal parents regain normal provider capabilities on their next turn. */
export function coordinationRole(
  state: ThreadCoordinationSummary | null | undefined,
): "parent" | "review" | "edit" | undefined {
  if (state?.role === "child") return state.mode;
  if (state?.role === "parent" && (state.status === "active" || state.status === "paused"))
    return "parent";
  return undefined;
}
