import {
  formatCoordinationLimits,
  formatCoordinationQuotaHandoffs,
  buildCoordinationPolicyPatch,
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
      const patch = buildCoordinationPolicyPatch({
        limitsText: text,
        fallbacksText:
          fallbackDraft ??
          formatCoordinationQuotaHandoffs(settings.coordinationQuotaHandoffFallbacks),
        threshold: thresholdDraft ?? settings.coordinationQuotaHandoffThresholdPercent,
        thresholdError: "Choose a quota threshold from 1 to 100.",
      });
      setPending(true);
      const result = await persist({
        environmentId,
        input: {
          patch,
        },
      });
      setMessage(
        result._tag === "Success"
          ? "Saved. New delegated tasks use these limits."
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
          ? "Models and pricing refreshed. New delegated tasks use the updated policy."
          : "Could not refresh model policy. The previous policy remains available.",
      );
    } finally {
      setPending(false);
    }
  };
  return (
    <section className="flex flex-col gap-3 px-4 py-5" aria-labelledby="coordination-policy-title">
      <h2 id="coordination-policy-title" className="text-sm font-medium">
        Delegated task limits
      </h2>
      <p className="text-sm text-muted-foreground">
        A thread may delegate the same task once to a model above $10 per million output tokens and
        four times to a model from $1 through $10, so a stuck task is not resubmitted forever.
        Different tasks have separate limits. Models below $1 are unlimited. Maintenance refreshes
        models and pricing monthly while the server is running.
      </p>
      <p className="text-sm text-muted-foreground">
        Named defaults:{" "}
        {Object.entries(DEFAULT_COORDINATION_LIMITS)
          .map(([model, limit]) => `${model}: ${limit ?? "unlimited"}`)
          .join(", ")}
        .
      </p>
      <label htmlFor="coordination-model-limits" className="text-sm">
        Overrides, one model=attempts or model=unlimited per line. A blank field restores the
        defaults.
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
        When a thread hits a usage limit and auto-resume is on, switch to a fallback only if its
        quota windows are below this percentage.
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
