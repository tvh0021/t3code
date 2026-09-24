import type { OrchestrationClientOrigin, UsageSummary } from "@t3tools/contracts";

const LEGACY_USAGE_PROVIDERS = new Set(["claude", "codex", "grok"]);

/** App Store mobile releases through 1.3.x use the v5 Usage provider schema. */
export function projectUsageSummaryForClient(
  summary: UsageSummary,
  clientOrigin: OrchestrationClientOrigin,
): UsageSummary {
  if (
    clientOrigin.surface !== "mobile" ||
    !/^1\.(?:2|3)\.\d+$/.test(clientOrigin.appVersion ?? "")
  ) {
    return summary;
  }

  return {
    ...summary,
    contractVersion: 5,
    buckets: summary.buckets.filter((bucket) => LEGACY_USAGE_PROVIDERS.has(bucket.provider)),
    sources: summary.sources.filter((source) =>
      LEGACY_USAGE_PROVIDERS.has(source.fingerprint.provider),
    ),
  };
}
