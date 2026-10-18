import type { OrchestrationClientOrigin, UsageSummary } from "@t3tools/contracts";

const LEGACY_USAGE_PROVIDERS = new Set(["claude", "codex", "grok"]);
// Fork-only providers. Upstream mobile builds reject the whole RPC response on an
// unknown provider literal: ForwardCompatibleArray does not drop elements inside
// the RPC Exit wrapper.
const FORK_ONLY_USAGE_PROVIDERS = new Set(["abacus", "zed"]);

/**
 * Projects a Usage summary onto the provider schema of App Store mobile builds:
 * v5 providers for 1.2.x/1.3.x, upstream v6 providers for every newer release.
 */
export function projectUsageSummaryForClient(
  summary: UsageSummary,
  clientOrigin: OrchestrationClientOrigin,
): UsageSummary {
  if (clientOrigin.surface !== "mobile") {
    return summary;
  }

  if (/^1\.(?:2|3)\.\d+$/.test(clientOrigin.appVersion ?? "")) {
    return {
      ...summary,
      contractVersion: 5,
      buckets: summary.buckets.filter((bucket) => LEGACY_USAGE_PROVIDERS.has(bucket.provider)),
      sources: summary.sources.filter((source) =>
        LEGACY_USAGE_PROVIDERS.has(source.fingerprint.provider),
      ),
    };
  }

  return {
    ...summary,
    buckets: summary.buckets.filter((bucket) => !FORK_ONLY_USAGE_PROVIDERS.has(bucket.provider)),
    sources: summary.sources.filter(
      (source) => !FORK_ONLY_USAGE_PROVIDERS.has(source.fingerprint.provider),
    ),
  };
}
