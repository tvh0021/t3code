import { useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { getCoordinationView } from "@t3tools/client-runtime/state/threads";
import type { CoordinationControl, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useState } from "react";
import { Alert, Modal, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppText } from "../../components/AppText";
import { MaterialButton } from "../../components/MaterialButton";
import { threadEnvironment, useEnvironmentThread } from "../../state/threads";
import * as Option from "effect/Option";
import { useAtomCommand } from "../../state/use-atom-command";

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
  const navigation = useNavigation();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  if (!view) return null;
  const ended = view.state.status === "completed" || view.state.status === "cancelled";
  const act = async (action: CoordinationControl) => {
    setPending(true);
    try {
      const result = await control({ environmentId, input: { threadId: view.parentId, action } });
      if (result._tag === "Failure")
        Alert.alert(
          "Could not update T3 orchestration layer",
          "Reconnect this environment and try again.",
        );
    } finally {
      setPending(false);
    }
  };
  const visit = (id: ThreadId) => {
    setOpen(false);
    navigation.navigate("Thread", { environmentId: String(environmentId), threadId: String(id) });
  };
  return (
    <>
      <View className="px-4 py-2">
        <MaterialButton
          label={`T3 orchestration layer · ${view.state.status}${view.pendingReports ? ` · ${view.pendingReports} reports` : ""}`}
          onPress={() => setOpen(true)}
        />
      </View>
      <Modal visible={open} onRequestClose={() => setOpen(false)} animationType="none">
        <SafeAreaView className="flex-1 bg-screen">
          <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
            <AppText accessibilityRole="header" className="text-lg font-semibold text-foreground">
              T3 orchestration layer
            </AppText>
            <AppText>
              {view.state.status} · {view.active}/{view.state.maxChildren} active · {view.queued}{" "}
              queued · {view.pendingReports} reports waiting
            </AppText>
            {!view.isParent && (
              <MaterialButton
                label={`Return to ${view.parentTitle}`}
                onPress={() => visit(view.parentId)}
              />
            )}
            {ownState?.role === "child" && ownState.handoffFromThreadId && (
              <MaterialButton
                label="Open source thread for this handoff"
                onPress={() => visit(ownState.handoffFromThreadId!)}
              />
            )}
            {view.state.quotaHandoff?.destinationThreadId &&
              view.state.quotaHandoff.destinationThreadId !== view.parentId && (
                <MaterialButton
                  label="Open quota handoff thread"
                  onPress={() => visit(view.state.quotaHandoff!.destinationThreadId!)}
                />
              )}
            {view.state.quotaHandoff?.sourceThreadId &&
              view.state.quotaHandoff.sourceThreadId !== view.parentId && (
                <MaterialButton
                  label="Open source thread for this handoff"
                  onPress={() => visit(view.state.quotaHandoff!.sourceThreadId!)}
                />
              )}
            {ownState?.role === "child" && ownState.report && (
              <AppText selectable>{ownState.report.text}</AppText>
            )}
            {view.state.waiting && !ended && (
              <AppText>
                The parent resumes after a report, once its current turn finishes and budget
                permits.
              </AppText>
            )}
            {view.state.blockedReason && (
              <AppText accessibilityLiveRegion="polite">{view.state.blockedReason}</AppText>
            )}
            {view.state.quotaHandoff && (
              <AppText accessibilityLiveRegion="polite">
                Quota handoff: {view.state.quotaHandoff.status}
                {view.state.quotaHandoff.destinationModel
                  ? ` · ${view.state.quotaHandoff.destinationModel}`
                  : ""}
                {view.state.quotaHandoff.resetAt
                  ? ` · resumes after ${new Date(view.state.quotaHandoff.resetAt).toLocaleString()}`
                  : ""}
                {view.state.quotaHandoff.reason ? ` · ${view.state.quotaHandoff.reason}` : ""}
              </AppText>
            )}
            {view.isParent && !ended && (
              <View className="flex-row flex-wrap gap-2">
                <MaterialButton
                  label={
                    view.state.quotaHandoff?.enabled
                      ? "Disable quota handoff"
                      : "Enable quota handoff"
                  }
                  disabled={pending}
                  onPress={() =>
                    void act(
                      view.state.quotaHandoff?.enabled
                        ? "disable-quota-handoff"
                        : "enable-quota-handoff",
                    )
                  }
                />
                <MaterialButton
                  label={view.state.status === "paused" ? "Resume" : "Pause"}
                  disabled={pending}
                  onPress={() => void act(view.state.status === "paused" ? "resume" : "pause")}
                />
                <MaterialButton
                  label="Complete"
                  disabled={pending}
                  onPress={() => void act("complete")}
                />
                <MaterialButton
                  label="Cancel"
                  tone="danger"
                  disabled={pending}
                  onPress={() => void act("cancel")}
                />
              </View>
            )}
            <AppText accessibilityRole="header" className="font-semibold">
              Automatic turns this session
            </AppText>
            {view.state.budgets.map((budget) => (
              <AppText key={budget.model}>
                {budget.model}: {budget.used} / {budget.limit ?? "unlimited"}
              </AppText>
            ))}
            <AppText>
              Model policy captured {new Date(view.state.policyUpdatedAt).toLocaleDateString()}.
              Monthly maintenance updates future sessions.
            </AppText>
            {view.children.map((child) => (
              <View key={child.threadId} className="gap-1">
                <MaterialButton label={child.title} onPress={() => visit(child.threadId)} />
                <AppText>
                  {child.model} · {child.state.phase}
                  {child.state.report
                    ? ` · report ${child.state.report.id} ${child.state.adopted ? "delivered" : ended ? "saved" : "waiting"}`
                    : ""}
                </AppText>
              </View>
            ))}
            <MaterialButton label="Close orchestration layer" onPress={() => setOpen(false)} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}
