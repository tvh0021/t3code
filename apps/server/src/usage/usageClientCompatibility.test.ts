import { describe, expect, it } from "@effect/vitest";
import { UsageDay, type UsageSummary } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { projectUsageSummaryForClient } from "./usageClientCompatibility.ts";

const providers = ["claude", "codex", "grok", "antigravity", "abacus"] as const;
const day = Schema.decodeSync(UsageDay)("2026-09-23");
const summary: UsageSummary = {
  contractVersion: 6,
  readAt: "2026-09-24T00:00:00Z",
  timeZone: "UTC",
  sinceDay: day,
  untilDay: Schema.decodeSync(UsageDay)("2026-09-24"),
  buckets: providers.map((provider) => ({
    day,
    provider,
    model: "example-model",
    totals: {
      uncachedInputTokens: 1,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 1,
      reasoningTokens: 0,
    },
    costUsd: 0,
    cacheSavingsUsd: 0,
    costSource: "unpriced",
    records: 1,
    unpricedRecords: 1,
    sessions: 1,
  })),
  sources: providers.map((provider) => ({
    fingerprint: {
      hostId: "host",
      provider,
      resolvedHomePath: "/example",
      volumeId: "",
    },
    status: "ok",
    scannedFiles: 1,
    skippedFiles: 0,
    malformedRecords: 0,
    distinctSessions: 1,
    message: null,
  })),
  pricing: { status: "unavailable", source: "example", fetchedAt: null, knownModels: 0 },
  scanDurationMs: 1,
};

describe("projectUsageSummaryForClient", () => {
  it.each(["1.2.0", "1.3.0", "1.3.2"])("sends only v5 providers to mobile %s", (appVersion) => {
    const projected = projectUsageSummaryForClient(summary, { surface: "mobile", appVersion });
    expect(projected.contractVersion).toBe(5);
    expect(projected.buckets.map((bucket) => bucket.provider)).toEqual(["claude", "codex", "grok"]);
    expect(projected.sources.map((source) => source.fingerprint.provider)).toEqual([
      "claude",
      "codex",
      "grok",
    ]);
  });

  it("keeps the full response for newer mobile and desktop clients", () => {
    expect(projectUsageSummaryForClient(summary, { surface: "mobile", appVersion: "1.4.0" })).toBe(
      summary,
    );
    expect(projectUsageSummaryForClient(summary, { surface: "desktop", appVersion: "1.3.0" })).toBe(
      summary,
    );
  });
});
