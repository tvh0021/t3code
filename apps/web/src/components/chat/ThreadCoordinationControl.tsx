import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import { getCoordinationView } from "@t3tools/client-runtime/state/threads";
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
  const ended = view.state.status === "completed" || view.state.status === "cancelled";
  const act = async (action: CoordinationControl) => {
    setPending(true);
    try {
      const result = await control({ environmentId, input: { threadId: view.parentId, action } });
      if (result._tag === "Failure")
        toastManager.add({
          type: "error",
          title: "Could not update workflow",
          description: String(squashAtomCommandFailure(result)),
        });
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>
        Workflow{view.pendingReports > 0 ? ` (${view.pendingReports})` : ""}
      </DialogTrigger>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Thread workflow</DialogTitle>
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
          {view.isParent && !ended && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => void act(view.state.status === "paused" ? "resume" : "pause")}
              >
                {view.state.status === "paused" ? "Resume" : "Pause"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => void act("complete")}
              >
                Complete
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={pending}
                onClick={() => void act("cancel")}
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
                    ? ` · report ${child.state.report.id} ${child.state.adopted ? "delivered" : ended ? "saved" : "waiting"}`
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
