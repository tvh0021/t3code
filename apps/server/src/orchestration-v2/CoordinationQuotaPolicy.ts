import {
  coordinationModelKey,
  type ServerProvider,
  type ServerProviderUsageLimits,
} from "@t3tools/contracts";

type QuotaWindowVerdict =
  | { readonly status: "unknown"; readonly reason: string }
  | { readonly status: "below-threshold" }
  | { readonly status: "threshold-reached"; readonly resetAt?: string };

const MAX_USAGE_AGE_MS = 5 * 60_000;

/** A quota reading must be recent and usable before it can route automatic work. */
export function quotaWindowVerdict(input: {
  readonly usageLimits: ServerProviderUsageLimits | undefined;
  readonly thresholdPercent: number;
  readonly now: string;
}): QuotaWindowVerdict {
  const limits = input.usageLimits;
  if (!limits || limits.unavailable || limits.windows.length === 0)
    return { status: "unknown", reason: limits?.unavailable?.message ?? "Quota is unavailable." };
  const checkedAt = Date.parse(limits.checkedAt);
  const now = Date.parse(input.now);
  if (!Number.isFinite(checkedAt) || !Number.isFinite(now) || now - checkedAt > MAX_USAGE_AGE_MS)
    return { status: "unknown", reason: "Quota reading is stale." };
  const exhausted = limits.windows.filter((window) => window.usedPercent >= input.thresholdPercent);
  if (exhausted.length === 0) return { status: "below-threshold" };
  const resetAt = exhausted
    .map((window) => window.resetsAt)
    .filter((value): value is string => value !== undefined && Date.parse(value) > now)
    .toSorted()[0];
  return { status: "threshold-reached", ...(resetAt ? { resetAt } : {}) };
}

export const isProviderReadyForHandoff = (provider: ServerProvider | undefined): boolean =>
  Boolean(
    provider?.enabled &&
    provider.installed &&
    provider.status === "ready" &&
    provider.availability !== "unavailable" &&
    provider.auth.status === "authenticated",
  );

/** Resolve the first mapped model whose provider is ready and whose quota is known to be usable. */
export function firstEligibleQuotaFallback(input: {
  readonly sourceModel: string;
  readonly sourceInstanceId?: string;
  readonly fallbackModels: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly thresholdPercent: number;
  readonly now: string;
  readonly canRunModel?: (model: string) => boolean;
  readonly canRunProviderModel?: (provider: ServerProvider, model: string) => boolean;
}): { readonly provider: ServerProvider; readonly model: string } | undefined {
  const modelKey = coordinationModelKey(input.sourceModel);
  const fallbacks =
    input.fallbackModels[input.sourceModel] ??
    input.fallbackModels[modelKey] ??
    (input.sourceInstanceId ? input.fallbackModels[input.sourceInstanceId] : undefined) ??
    [];
  for (const model of fallbacks) {
    if (input.canRunModel && !input.canRunModel(model)) continue;
    const candidates = input.providers.filter(
      (candidate) =>
        isProviderReadyForHandoff(candidate) &&
        (!input.sourceInstanceId || candidate.instanceId !== input.sourceInstanceId) &&
        (!input.canRunProviderModel || input.canRunProviderModel(candidate, model)) &&
        candidate.models.some((entry) => entry.slug === model && entry.isLegacy !== true),
    );
    const provider = candidates.find(
      (candidate) =>
        quotaWindowVerdict({
          usageLimits: candidate.usageLimits,
          thresholdPercent: input.thresholdPercent,
          now: input.now,
        }).status === "below-threshold",
    );
    if (provider) return { provider, model };
  }
  return undefined;
}
