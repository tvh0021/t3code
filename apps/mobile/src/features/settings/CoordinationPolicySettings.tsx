import {
  formatCoordinationLimits,
  parseCoordinationLimits,
} from "@t3tools/client-runtime/state/threads";
import type { EnvironmentId, ServerSettings } from "@t3tools/contracts";
import { useState } from "react";
import { Alert, TextInput, View } from "react-native";
import { AppText } from "../../components/AppText";
import { MaterialButton } from "../../components/MaterialButton";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "./components/SettingsSection";

export function CoordinationPolicySettings({
  environmentId,
  settings,
  environmentLabel,
}: {
  environmentId: EnvironmentId;
  settings: ServerSettings;
  environmentLabel: string;
}) {
  const persist = useAtomCommand(serverEnvironment.updateSettings);
  const refresh = useAtomCommand(serverEnvironment.refreshProviders);
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const save = async () => {
    try {
      const limits = parseCoordinationLimits(
        draft ?? formatCoordinationLimits(settings.coordinationModelLimits ?? {}),
      );
      setPending(true);
      const result = await persist({
        environmentId,
        input: { patch: { coordinationModelLimits: limits } },
      });
      if (result._tag === "Failure") Alert.alert("Could not save limits", "Reconnect and retry.");
      else {
        setDraft(null);
        Alert.alert(
          "Limits saved",
          "Future workflows use these limits. Active session budgets are unchanged.",
        );
      }
    } catch (error) {
      Alert.alert(
        "Invalid model limits",
        error instanceof Error ? error.message : "Use model=turns or model=unlimited.",
      );
    } finally {
      setPending(false);
    }
  };
  const maintain = async () => {
    setPending(true);
    try {
      const result = await refresh({
        environmentId,
        input: { refreshModels: true, refreshCoordinationPolicy: true },
      });
      Alert.alert(
        result._tag === "Success" ? "Model policy refreshed" : "Refresh failed",
        result._tag === "Success"
          ? "Future workflows use updated models and prices."
          : "The previous policy remains available.",
      );
    } finally {
      setPending(false);
    }
  };
  return (
    <SettingsSection title={`Thread workflow limits · ${environmentLabel}`}>
      <View className="gap-3 p-4">
        <AppText>
          Monthly maintenance refreshes models and pricing. Output prices above $10 per million
          tokens get one turn, below $1 are unlimited, and $1 through $10 get four turns. Named
          defaults and overrides take precedence.
        </AppText>
        <AppText>
          Overrides, one model=turns or model=unlimited per line. Blank restores defaults.
        </AppText>
        <TextInput
          accessibilityLabel="Model turn limit overrides"
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          editable={!pending}
          value={draft ?? formatCoordinationLimits(settings.coordinationModelLimits ?? {})}
          onChangeText={setDraft}
          className="min-h-24 rounded-lg border border-border-subtle p-3 text-foreground"
        />
        <MaterialButton label="Save limits" disabled={pending} onPress={() => void save()} />
        <MaterialButton
          label="Refresh model policy"
          disabled={pending}
          onPress={() => void maintain()}
        />
      </View>
    </SettingsSection>
  );
}
