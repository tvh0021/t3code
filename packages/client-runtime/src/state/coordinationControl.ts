import type {
  CoordinationQuotaHandoff,
  ThreadCoordinationSummary,
  ThreadId,
} from "@t3tools/contracts";

export function getCoordinationActions(state: ThreadCoordinationSummary | null | undefined) {
  if (state?.role !== "parent" || (state.status !== "active" && state.status !== "paused"))
    return null;
  return {
    session:
      state.status === "paused"
        ? (["resume", "complete", "cancel"] as const)
        : (["pause", "complete", "cancel"] as const),
    quotaHandoff: state.quotaHandoff?.enabled
      ? ("disable-quota-handoff" as const)
      : ("enable-quota-handoff" as const),
  };
}

/** Handoff links omit the parent, which is already open or has its own return link. */
export function getCoordinationQuotaHandoff(
  handoff: CoordinationQuotaHandoff | undefined,
  parentId: ThreadId,
) {
  return {
    handoff,
    enabled: handoff?.enabled ?? false,
    destinationThreadId:
      handoff?.destinationThreadId !== parentId ? handoff?.destinationThreadId : undefined,
    sourceThreadId: handoff?.sourceThreadId !== parentId ? handoff?.sourceThreadId : undefined,
  };
}

export function getCoordinationChildReportStatus(
  child: Pick<Extract<ThreadCoordinationSummary, { role: "child" }>, "report" | "adopted">,
  ended: boolean,
) {
  if (!child.report) return undefined;
  return child.adopted ? "delivered" : ended ? "saved" : "waiting";
}
