import type { UsageSummary } from "@t3tools/contracts";

// Fork-only providers. Upstream mobile builds reject the whole RPC response on an
// unknown provider literal: ForwardCompatibleArray does not drop elements inside
// the RPC Exit wrapper.
const FORK_ONLY_USAGE_PROVIDERS = new Set(["abacus"]);

/** Drops fork-only providers from the Usage summary sent to mobile builds. */
export function projectUsageSummaryForClient(
  summary: UsageSummary,
  client: Readonly<Record<string, unknown>>,
): UsageSummary {
  if (client.surface !== "mobile") {
    return summary;
  }

  return {
    ...summary,
    buckets: summary.buckets.filter((bucket) => !FORK_ONLY_USAGE_PROVIDERS.has(bucket.provider)),
    sources: summary.sources.filter(
      (source) => !FORK_ONLY_USAGE_PROVIDERS.has(source.fingerprint.provider),
    ),
  };
}
