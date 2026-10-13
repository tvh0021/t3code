import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import {
  getCoordinationView,
  getCoordinationActions,
  getCoordinationQuotaHandoff,
  getCoordinationChildReportStatus,
} from "@t3tools/client-runtime/state/threads";
import type { CoordinationControl, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useState } from "react";
import { threadEnvironment, useEnvironmentThread } from "../../state/threads";
import * as Option from "effect/Option";
import { useAtomCommand } from "../../state/use-atom-command";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogTrigger,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";
import { toastManager } from "../ui/toast";

export function ThreadCoordinationControl({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const snapshot = useAtomValue(threadEnvironment.snapshotAtom(environmentId));
  const view = getCoordinationView(snapshot?.threads ?? [], threadId);
  const detail = useEnvironmentThread(environmentId, threadId);
  const ownState = Option.getOrUndefined(detail.data)?.coordination;
  const control = useAtomCommand(threadEnvironment.controlCoordination);
  const [pending, setPending] = useState(false);
  if (!view) return null;
  const { ended } = view;
  const actions = view.isParent ? getCoordinationActions(view.state) : null;
  const {
    handoff,
    enabled: handoffEnabled,
    destinationThreadId,
    sourceThreadId,
  } = getCoordinationQuotaHandoff(view.state.quotaHandoff, view.parentId);
  const handoffFromThreadId = ownState?.role === "child" ? ownState.handoffFromThreadId : undefined;
  const act = async (action: CoordinationControl) => {
    setPending(true);
    try {
      const result = await control({ environmentId, input: { threadId: view.parentId, action } });
      if (result._tag === "Failure")
        toastManager.add({
          type: "error",
          title: "Could not update T3 orchestration layer",
          description: String(squashAtomCommandFailure(result)),
        });
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>
        T3 orchestration layer{view.pendingReports > 0 ? ` (${view.pendingReports})` : ""}
      </DialogTrigger>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>T3 orchestration layer</DialogTitle>
          <DialogDescription>
            {view.state.status} · {view.active}/{view.state.maxChildren} active · {view.queued}{" "}
            queued · {view.pendingReports} reports waiting
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 px-6 pb-6">
          {!view.isParent && (
            <Link
              to="/$environmentId/$threadId"
              params={{ environmentId, threadId: view.parentId }}
            >
              Return to {view.parentTitle}
            </Link>
          )}
          {handoffFromThreadId && (
            <Link
              to="/$environmentId/$threadId"
              params={{ environmentId, threadId: handoffFromThreadId }}
            >
              Open source thread for this handoff
            </Link>
          )}
          {destinationThreadId && (
            <Link
              to="/$environmentId/$threadId"
              params={{
                environmentId,
                threadId: destinationThreadId,
              }}
            >
              Open quota handoff thread
            </Link>
          )}
          {sourceThreadId && (
            <Link
              to="/$environmentId/$threadId"
              params={{ environmentId, threadId: sourceThreadId }}
            >
              Open source thread for this handoff
            </Link>
          )}
          {ownState?.role === "child" && ownState.report && (
            <div>
              <p className="text-sm font-medium">Assignment report</p>
              <p className="whitespace-pre-wrap text-sm">{ownState.report.text}</p>
            </div>
          )}
          {view.state.waiting && !ended && (
            <p className="text-sm text-muted-foreground">
              The parent will resume after a report, once its current turn finishes and budget
              permits.
            </p>
          )}
          {view.state.blockedReason && (
            <p role="status" className="text-sm">
              {view.state.blockedReason}
            </p>
          )}
          {handoff && (
            <div role="status" className="text-sm text-muted-foreground">
              Quota handoff: {handoff.status}
              {handoff.destinationModel ? ` · ${handoff.destinationModel}` : ""}
              {handoff.resetAt
                ? ` · resumes after ${new Date(handoff.resetAt).toLocaleString()}`
                : ""}
              {handoff.reason ? ` · ${handoff.reason}` : ""}
            </div>
          )}
          {actions && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => void act(actions.quotaHandoff)}
              >
                {handoffEnabled ? "Disable quota handoff" : "Enable quota handoff"}
              </Button>
              <p className="basis-full text-xs text-muted-foreground">
                A layer can switch providers once. Each destination needs fresh quota below the
                environment threshold and an orchestration turn available. The summary uses an
                additional provider-billed turn.
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => void act(actions.session[0])}
              >
                {actions.session[0] === "resume" ? "Resume" : "Pause"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => void act(actions.session[1])}
              >
                Complete
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={pending}
                onClick={() => void act(actions.session[2])}
              >
                Cancel
              </Button>
            </div>
          )}
          <table className="w-full text-left text-sm">
            <caption className="text-left font-medium">Automatic turns this session</caption>
            <thead>
              <tr>
                <th scope="col">Model</th>
                <th scope="col">Used / limit</th>
              </tr>
            </thead>
            <tbody>
              {view.state.budgets.map((budget) => (
                <tr key={budget.model}>
                  <td>{budget.model}</td>
                  <td>
                    {budget.used} / {budget.limit ?? "unlimited"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground">
            Model policy captured {new Date(view.state.policyUpdatedAt).toLocaleDateString()}.
            Monthly maintenance updates future sessions.
          </p>
          <ul className="flex flex-col gap-3">
            {view.children.map((child) => (
              <li key={child.threadId}>
                <Link
                  to="/$environmentId/$threadId"
                  params={{ environmentId, threadId: child.threadId }}
                >
                  {child.title}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {child.model} · {child.state.phase}
                  {child.state.report
                    ? ` · report ${child.state.report.id} ${getCoordinationChildReportStatus(child.state, ended)}`
                    : ""}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
