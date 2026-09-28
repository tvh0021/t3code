import {
  formatCoordinationLimits,
  parseCoordinationLimits,
} from "@t3tools/client-runtime/state/threads";
import { DEFAULT_COORDINATION_LIMITS, type EnvironmentId } from "@t3tools/contracts";
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
  const settings = useEnvironmentSettings(environmentId);
  const persist = useAtomCommand(serverEnvironment.updateSettings);
  const refresh = useAtomCommand(serverEnvironment.refreshProviders);
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const text = draft ?? formatCoordinationLimits(settings.coordinationModelLimits ?? {});
  const save = async () => {
    try {
      const limits = parseCoordinationLimits(text);
      setPending(true);
      const result = await persist({
        environmentId,
        input: { patch: { coordinationModelLimits: limits } },
      });
      setMessage(
        result._tag === "Success"
          ? "Saved for future workflows. Active session budgets are unchanged."
          : "Could not save limits. Reconnect and retry.",
      );
      if (result._tag === "Success") setDraft(null);
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
          ? "Models and pricing refreshed. Future workflows use the updated policy."
          : "Could not refresh model policy. The previous policy remains available.",
      );
    } finally {
      setPending(false);
    }
  };
  return (
    <section className="flex flex-col gap-3 px-4 py-5" aria-labelledby="coordination-policy-title">
      <h2 id="coordination-policy-title" className="text-sm font-medium">
        Thread workflow limits
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
