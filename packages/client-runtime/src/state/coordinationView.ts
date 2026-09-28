import type { OrchestrationThreadShell, ThreadId } from "@t3tools/contracts";

export function getCoordinationView(
  threads: ReadonlyArray<OrchestrationThreadShell>,
  threadId: ThreadId,
) {
  const current = threads.find((thread) => thread.id === threadId);
  const parentId =
    current?.coordination?.role === "child" ? current.coordination.parentId : threadId;
  const parent = threads.find((thread) => thread.id === parentId);
  if (parent?.coordination?.role !== "parent") return null;
  const ended =
    parent.coordination.status === "completed" || parent.coordination.status === "cancelled";
  const children = threads.flatMap((thread) =>
    thread.coordination?.role === "child" && thread.coordination.parentId === parentId
      ? [
          {
            threadId: thread.id,
            title: thread.title,
            model: thread.modelSelection.model,
            state: thread.coordination,
          },
        ]
      : [],
  );
  return {
    parentId,
    parentTitle: parent.title,
    isParent: parentId === threadId,
    state: parent.coordination,
    children,
    pendingReports: ended
      ? 0
      : children.filter((child) => child.state.report && !child.state.adopted).length,
    active: children.filter((child) => child.state.phase === "running").length,
    queued: children.filter((child) => child.state.phase === "queued").length,
  };
}
