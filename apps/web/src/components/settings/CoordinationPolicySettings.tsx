import {
  formatCoordinationLimits,
  formatCoordinationQuotaHandoffs,
  parseCoordinationLimits,
  parseCoordinationQuotaHandoffs,
} from "@t3tools/client-runtime/state/threads";
import { DEFAULT_COORDINATION_LIMITS, type EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Input } from "../ui/input";

export function CoordinationPolicySettings({
  environmentId,
  readOnly,
}: {
  environmentId: EnvironmentId;
  readOnly: boolean;
}) {
  const settings = useEnvironmentSettings(environmentId);
  const persist = useAtomCommand(serverEnvironment.updateSettings);
  const refresh = useAtomCommand(serverEnvironment.refreshProviders);
  const [draft, setDraft] = useState<string | null>(null);
  const [fallbackDraft, setFallbackDraft] = useState<string | null>(null);
  const [thresholdDraft, setThresholdDraft] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const text = draft ?? formatCoordinationLimits(settings.coordinationModelLimits ?? {});
  const save = async () => {
    try {
      const limits = parseCoordinationLimits(text);
      const fallbacks = parseCoordinationQuotaHandoffs(
        fallbackDraft ??
          formatCoordinationQuotaHandoffs(settings.coordinationQuotaHandoffFallbacks),
      );
      const threshold = thresholdDraft ?? settings.coordinationQuotaHandoffThresholdPercent;
      if (!Number.isInteger(threshold) || threshold < 1 || threshold > 100)
        throw new Error("Choose a quota threshold from 1 to 100.");
      setPending(true);
      const result = await persist({
        environmentId,
        input: {
          patch: {
            coordinationModelLimits: limits,
            coordinationQuotaHandoffFallbacks: fallbacks,
            coordinationQuotaHandoffThresholdPercent: threshold,
          },
        },
      });
      setMessage(
        result._tag === "Success"
          ? "Saved for future T3 orchestration layers. Active session budgets are unchanged."
          : "Could not save limits. Reconnect and retry.",
      );
      if (result._tag === "Success") {
        setDraft(null);
        setFallbackDraft(null);
        setThresholdDraft(null);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Invalid model limits.");
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
      setMessage(
        result._tag === "Success"
          ? "Models and pricing refreshed. Future T3 orchestration layers use the updated policy."
          : "Could not refresh model policy. The previous policy remains available.",
      );
    } finally {
      setPending(false);
    }
  };
  return (
    <section className="flex flex-col gap-3 px-4 py-5" aria-labelledby="coordination-policy-title">
      <h2 id="coordination-policy-title" className="text-sm font-medium">
        T3 orchestration layer limits
      </h2>
      <p className="text-sm text-muted-foreground">
        Models above $10 per million output tokens get one automatic turn. Models below $1 are
        unlimited. Prices from $1 through $10 get four turns. Maintenance refreshes models and
        pricing monthly while the server is running.
      </p>
      <p className="text-sm text-muted-foreground">
        Named defaults:{" "}
        {Object.entries(DEFAULT_COORDINATION_LIMITS)
          .map(([model, limit]) => `${model}: ${limit ?? "unlimited"}`)
          .join(", ")}
        .
      </p>
      <label htmlFor="coordination-model-limits" className="text-sm">
        Overrides, one model=turns or model=unlimited per line. A blank field restores the defaults.
      </label>
      <Textarea
        id="coordination-model-limits"
        rows={5}
        value={text}
        disabled={readOnly || pending}
        placeholder="my-model=4"
        onChange={(event) => setDraft(event.target.value)}
      />
      <label htmlFor="coordination-quota-threshold" className="text-sm">
        Interrupt opted-in layer work when any reported quota window reaches this percentage.
      </label>
      <Input
        id="coordination-quota-threshold"
        type="number"
        min={1}
        max={100}
        value={thresholdDraft ?? settings.coordinationQuotaHandoffThresholdPercent}
        disabled={readOnly || pending}
        onChange={(event) => setThresholdDraft(Number(event.target.value))}
      />
      <label htmlFor="coordination-quota-fallbacks" className="text-sm">
        Ordered provider fallbacks, one source-model=target-model,target-model per line. Leave blank
        to wait for quota resets without switching. Defaults map Sol to Opus, Astra to Fable, and
        Luna to Gemini Flash High.
      </label>
      <Textarea
        id="coordination-quota-fallbacks"
        rows={4}
        value={
          fallbackDraft ??
          formatCoordinationQuotaHandoffs(settings.coordinationQuotaHandoffFallbacks)
        }
        disabled={readOnly || pending}
        placeholder="gpt-6-sol=claude-opus-5"
        onChange={(event) => setFallbackDraft(event.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={readOnly || pending}
          onClick={() => void save()}
        >
          Save limits
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={readOnly || pending}
          onClick={() => void maintain()}
        >
          Refresh model policy
        </Button>
      </div>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
