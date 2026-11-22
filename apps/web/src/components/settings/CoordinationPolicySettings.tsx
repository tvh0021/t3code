import {
  formatCoordinationLimits,
  buildCoordinationPolicyPatch,
} from "@t3tools/client-runtime/state/threads";
import { DEFAULT_COORDINATION_LIMITS, type EnvironmentId } from "@t3tools/contracts";
import { T, useGT, Var } from "gt-react";
import { useState } from "react";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";

export function CoordinationPolicySettings({
  environmentId,
  readOnly,
}: {
  environmentId: EnvironmentId;
  readOnly: boolean;
}) {
  const gt = useGT();
  const settings = useEnvironmentSettings(environmentId);
  const persist = useAtomCommand(serverEnvironment.updateSettings);
  const refresh = useAtomCommand(serverEnvironment.refreshProviders);
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const text = draft ?? formatCoordinationLimits(settings.coordinationModelLimits ?? {});
  const save = async () => {
    try {
      const patch = buildCoordinationPolicyPatch({ limitsText: text });
      setPending(true);
      const result = await persist({
        environmentId,
        input: {
          patch,
        },
      });
      setMessage(
        result._tag === "Success"
          ? gt("Saved. New delegated tasks use these limits.")
          : gt("Could not save limits. Reconnect and retry."),
      );
      if (result._tag === "Success") setDraft(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : gt("Invalid model limits."));
    }
    setPending(false);
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
          ? gt("Models and pricing refreshed. New delegated tasks use the updated policy.")
          : gt("Could not refresh model policy. The previous policy remains available."),
      );
    } catch {
      setMessage(gt("Could not refresh model policy. The previous policy remains available."));
    }
    setPending(false);
  };
  return (
    <section className="flex flex-col gap-3 px-4 py-5" aria-labelledby="coordination-policy-title">
      <h2 id="coordination-policy-title" className="text-sm font-medium">
        <T>Delegated task limits</T>
      </h2>
      <p className="text-sm text-muted-foreground">
        <T>
          A thread may delegate the same task once to a model above $10 per million output tokens
          and four times to a model from $1 through $10, so a stuck task is not resubmitted forever.
          Different tasks have separate limits. Models below $1 are unlimited. Maintenance refreshes
          models and pricing monthly while the server is running.
        </T>
      </p>
      <p className="text-sm text-muted-foreground">
        <T>
          Named defaults:{" "}
          <Var>{Object.entries(DEFAULT_COORDINATION_LIMITS)
          .map(([model, limit]) => `${model}: ${limit ?? "unlimited"}`)
          .join(", ")}
        .</Var>
        </T>
      </p>
      <label htmlFor="coordination-model-limits" className="text-sm">
        <T>Overrides, one model=attempts or model=unlimited per line. A blank field restores the defaults.</T>
      </label>
      <Textarea
        id="coordination-model-limits"
        rows={5}
        value={text}
        disabled={readOnly || pending}
        placeholder="my-model=4"
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={readOnly || pending}
          onClick={() => void save()}
        >
          <T>Save limits</T>
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={readOnly || pending}
          onClick={() => void maintain()}
        >
          <T>Refresh model policy</T>
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
