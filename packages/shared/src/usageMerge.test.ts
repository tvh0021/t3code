import {
  USAGE_CONTRACT_VERSION,
  USAGE_MERGE_COMPATIBLE_SINCE,
  type EnvironmentId,
  type UsageBucket,
  type UsageDay,
  type UsageProviderKind,
  UsageSummary,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { isModelCostUnknown, mergeUsage, type EnvironmentUsage } from "./usageMerge.ts";

const decodeSummary = Schema.decodeUnknownSync(UsageSummary);
const encodeSummary = Schema.encodeSync(UsageSummary);

function bucket(overrides: Partial<UsageBucket> = {}): UsageBucket {
  return {
    day: "2026-08-07" as UsageDay,
    provider: "claude",
    model: "claude-fable-5",
    totals: {
      uncachedInputTokens: 100,
      cachedInputTokens: 1000,
      cacheCreationTokens: 10,
      outputTokens: 50,
      reasoningTokens: 0,
    },
    costUsd: 10,
    cacheSavingsUsd: 2,
    costSource: "modelPriced",
    records: 5,
    unpricedRecords: 0,
    sessions: 1,
    ...overrides,
  };
}

function summary(
  buckets: readonly UsageBucket[],
  sources: readonly {
    provider: UsageProviderKind;
    hostId: string;
    homePath: string;
    volumeId?: string;
    distinctSessions?: number;
  }[],
  contractVersion: number = USAGE_CONTRACT_VERSION,
): UsageSummary {
  return {
    contractVersion,
    readAt: "2026-08-07T00:00:00.000Z",
    timeZone: "UTC",
    sinceDay: "2026-08-01" as UsageDay,
    untilDay: "2026-08-31" as UsageDay,
    buckets,
    sources: sources.map((source) => ({
      fingerprint: {
        hostId: source.hostId,
        provider: source.provider,
        resolvedHomePath: source.homePath,
        volumeId: source.volumeId ?? `vol-${source.hostId}`,
      },
      status: "ok" as const,
      scannedFiles: 1,
      skippedFiles: 0,
      malformedRecords: 0,
      distinctSessions: source.distinctSessions ?? 1,
      message: null,
    })),
    pricing: { status: "fresh", source: "litellm", fetchedAt: null, knownModels: 10 },
    scanDurationMs: 1,
  };
}

function environment(id: string, usageSummary: UsageSummary): EnvironmentUsage {
  return { environmentId: id as EnvironmentId, label: id, summary: usageSummary };
}

describe("mergeUsage", () => {
  it("merges a large mixed-provider report within the regression budget", () => {
    const providers = ["claude", "codex", "antigravity", "abacus"] as const;
    const buckets = Array.from({ length: 20_000 }, (_, index) => {
      const provider = providers[index % providers.length]!;
      return bucket({
        provider,
        model: `${provider}-model-${index % 20}`,
        ...(provider === "abacus" || (provider === "codex" && index % 8 === 1)
          ? { credits: 0.25 }
          : {}),
      });
    });
    const sources = providers.map((provider) => ({
      provider,
      hostId: "benchmark-host",
      homePath: `/benchmark/${provider}`,
    }));

    const started = performance.now();
    const merged = mergeUsage(
      [environment("benchmark", summary(buckets, sources))],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.records).toBe(100_000);
    expect(merged.models).toHaveLength(25);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("counts a Cursor account once across servers while retaining each server's other providers", () => {
    const account = {
      provider: "cursor" as const,
      hostId: "cursor.com",
      homePath: "cursor-account:account-hash",
      volumeId: "account-hash",
    };
    const merged = mergeUsage(
      [
        environment(
          "mac",
          summary([bucket({ provider: "cursor", sourcePath: account.homePath })], [account]),
        ),
        environment(
          "linux",
          summary(
            [
              bucket({ provider: "cursor", sourcePath: account.homePath }),
              bucket({ provider: "opencode", sourcePath: "/opencode" }),
            ],
            [account, { provider: "opencode", hostId: "linux", homePath: "/opencode" }],
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );
    expect(
      merged.providers.map((provider) => [provider.provider, provider.costUsd]).sort(),
    ).toEqual([
      ["cursor", 10],
      ["opencode", 10],
    ]);
    expect(merged.duplicateSources).toHaveLength(1);
  });

  it("sums environments that read different transcript directories", () => {
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary([bucket()], [{ provider: "claude", hostId: "mac", homePath: "/a/.claude" }]),
        ),
        environment(
          "env-b",
          summary([bucket()], [{ provider: "claude", hostId: "linux", homePath: "/b/.claude" }]),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.costUsd).toBe(20);
    expect(merged.records).toBe(10);
    expect(merged.duplicateSources).toHaveLength(0);
  });

  it("counts a shared transcript directory once", () => {
    const shared = { provider: "claude" as const, hostId: "mac", homePath: "/home/theo/.claude" };
    const merged = mergeUsage(
      [
        environment("env-a", summary([bucket()], [shared])),
        environment("env-b", summary([bucket()], [shared])),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.costUsd).toBe(10);
    expect(merged.records).toBe(5);
    expect(merged.sessions).toBe(1);
    expect(merged.duplicateSources).toHaveLength(1);
    expect(merged.contributingEnvironments).toEqual(["env-a"]);
  });

  it("drops only the duplicated provider, keeping the environment's other one", () => {
    const sharedClaude = {
      provider: "claude" as const,
      hostId: "mac",
      homePath: "/home/theo/.claude",
    };
    const merged = mergeUsage(
      [
        environment("env-a", summary([bucket()], [sharedClaude])),
        environment(
          "env-b",
          summary(
            [bucket(), bucket({ provider: "codex", model: "gpt-5.6-sol", costUsd: 4 })],
            [sharedClaude, { provider: "codex", hostId: "mac", homePath: "/home/theo/.codex" }],
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.costUsd).toBe(14);
    expect(merged.providers.map((provider) => provider.provider).sort()).toEqual([
      "claude",
      "codex",
    ]);
    expect(merged.sessions).toBe(2);
    expect(
      Object.fromEntries(
        merged.providers.map((provider) => [provider.provider, provider.sessions]),
      ),
    ).toEqual({ claude: 1, codex: 1 });
  });

  it("counts overlapping provider roots once while keeping each environment's unique root", () => {
    const source = (homePath: string) => ({
      provider: "opencode" as const,
      hostId: "host",
      homePath,
    });
    const usage = (sourcePath: string, costUsd: number) =>
      bucket({ provider: "opencode", sourcePath, costUsd });
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary([usage("/shared", 10), usage("/a", 2)], [source("/shared"), source("/a")]),
        ),
        environment(
          "env-b",
          summary([usage("/shared", 10), usage("/b", 3)], [source("/shared"), source("/b")]),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );
    expect(merged.costUsd).toBe(15);
    expect(merged.sessions).toBe(3);
  });

  it("uses the newest scan when environments share the same transcript directory", () => {
    const source = { provider: "claude" as const, hostId: "mac", homePath: "/home/theo/.claude" };
    const environments = [
      environment("env-a", summary([bucket({ costUsd: 4, records: 2 })], [source])),
      environment("env-b", {
        ...summary([bucket()], [source]),
        readAt: "2026-08-07T01:00:00.000Z",
      }),
    ];

    for (const ordered of [environments, environments.toReversed()]) {
      const merged = mergeUsage(ordered, USAGE_CONTRACT_VERSION);
      expect(merged.costUsd).toBe(10);
      expect(merged.records).toBe(5);
      expect(merged.sessions).toBe(1);
      expect(merged.contributingEnvironments).toEqual(["env-b"]);
      expect(merged.duplicateSources).toEqual(["env-a: /home/theo/.claude"]);
    }
  });

  it("prefers a complete scan over a newer partial scan of the same directory", () => {
    const source = { provider: "claude" as const, hostId: "mac", homePath: "/home/theo/.claude" };
    const incomplete = summary([bucket({ costUsd: 4, records: 2 })], [source]);
    const partial = environment("new", {
      ...incomplete,
      readAt: "2026-08-07T01:00:00.000Z",
      sources: incomplete.sources.map((entry) => ({ ...entry, status: "partial" as const })),
    });
    const complete = environment("old", summary([bucket()], [source]));

    for (const ordered of [
      [partial, complete],
      [complete, partial],
    ]) {
      const merged = mergeUsage(ordered, USAGE_CONTRACT_VERSION);
      expect(merged.costUsd).toBe(10);
      expect(merged.contributingEnvironments).toEqual(["old"]);
      expect(merged.duplicateSources).toEqual(["new: /home/theo/.claude"]);
    }
    expect(mergeUsage([partial], USAGE_CONTRACT_VERSION).costUsd).toBe(4);
  });

  it("keeps new cells from a later partial scan without recounting older cells", () => {
    const source = { provider: "claude" as const, hostId: "mac", homePath: "/home/theo/.claude" };
    const complete = environment(
      "old",
      summary([bucket()], [source], USAGE_MERGE_COMPATIBLE_SINCE),
    );
    const partialSummary = summary(
      [
        bucket({ sourcePath: source.homePath, costUsd: 4, records: 2 }),
        bucket({
          day: "2026-08-08" as UsageDay,
          sourcePath: source.homePath,
          costUsd: 3,
          records: 1,
        }),
      ],
      [{ ...source, distinctSessions: 2 }],
    );
    const partial = environment("new", {
      ...partialSummary,
      readAt: "2026-08-08T01:00:00.000Z",
      sources: partialSummary.sources.map((entry) => ({ ...entry, status: "partial" as const })),
    });

    for (const ordered of [
      [complete, partial],
      [partial, complete],
    ]) {
      const merged = mergeUsage(ordered, USAGE_CONTRACT_VERSION);
      expect(merged.costUsd).toBe(13);
      expect(merged.records).toBe(6);
      expect(merged.sessions).toBe(2);
      expect(merged.daily.map(({ day, costUsd }) => [day, costUsd])).toEqual([
        ["2026-08-07", 10],
        ["2026-08-08", 3],
      ]);
      expect(merged.contributingEnvironments).toEqual(
        ordered.map(({ environmentId }) => environmentId),
      );
      expect(merged.duplicateSources).toEqual(["new: /home/theo/.claude"]);
    }
  });

  it("retains a complete cell when a larger partial cell may have skipped old records", () => {
    const source = { provider: "claude" as const, hostId: "mac", homePath: "/home/theo/.claude" };
    const complete = environment("old", summary([bucket()], [source]));
    const partialSummary = summary(
      [
        bucket({
          costUsd: 4,
          records: 6,
          totals: {
            uncachedInputTokens: 80,
            cachedInputTokens: 500,
            cacheCreationTokens: 10,
            outputTokens: 30,
            reasoningTokens: 0,
          },
        }),
      ],
      [{ ...source, distinctSessions: 2 }],
    );
    const partial = environment("new", {
      ...partialSummary,
      readAt: "2026-08-07T01:00:00.000Z",
      sources: partialSummary.sources.map((entry) => ({ ...entry, status: "partial" as const })),
    });

    const merged = mergeUsage([complete, partial], USAGE_CONTRACT_VERSION);
    expect(merged.costUsd).toBe(10);
    expect(merged.totalTokens).toBe(1160);
    expect(merged.records).toBe(5);
    expect(merged.sessions).toBe(1);
    expect(merged.contributingEnvironments).toEqual(["old"]);
  });

  it("identifies an environment reporting an older contract version", () => {
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary([bucket()], [{ provider: "claude", hostId: "mac", homePath: "/a" }]),
        ),
        environment(
          "env-b",
          summary(
            [bucket()],
            [{ provider: "claude", hostId: "linux", homePath: "/b" }],
            USAGE_MERGE_COMPATIBLE_SINCE - 1,
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.costUsd).toBe(10);
    expect(merged.contractMismatches).toEqual([
      {
        environmentId: "env-b",
        direction: "serverBehind",
        contractVersion: USAGE_MERGE_COMPATIBLE_SINCE - 1,
      },
    ]);
  });

  it("identifies an environment reporting a newer contract version", () => {
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary(
            [bucket()],
            [{ provider: "claude", hostId: "mac", homePath: "/a" }],
            USAGE_CONTRACT_VERSION + 1,
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.costUsd).toBe(0);
    expect(merged.contractMismatches).toEqual([
      {
        environmentId: "env-a",
        direction: "clientBehind",
        contractVersion: USAGE_CONTRACT_VERSION + 1,
      },
    ]);
  });

  it("keeps the previous compatible contract version so additive provider expansions still merge", () => {
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary(
            [bucket({ costUsd: 10 })],
            [{ provider: "claude", hostId: "mac", homePath: "/a" }],
          ),
        ),
        environment(
          "env-b",
          summary(
            [bucket({ costUsd: 4, provider: "codex", model: "gpt-5.6-sol" })],
            [{ provider: "codex", hostId: "linux", homePath: "/b" }],
            USAGE_CONTRACT_VERSION - 1,
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.costUsd).toBe(14);
    expect(merged.contractMismatches).toEqual([]);
  });

  it("keeps known usage when newer providers and bucket variants cannot be decoded", () => {
    const known = summary([bucket()], [{ provider: "claude", hostId: "mac", homePath: "/a" }]);
    const decoded = decodeSummary({
      ...known,
      buckets: [
        ...known.buckets,
        { ...bucket(), provider: "future-provider", costUsd: 100 },
        { ...bucket(), costSource: "future-pricing", costUsd: 200 },
      ],
      sources: [
        ...known.sources,
        {
          ...known.sources[0],
          fingerprint: {
            ...known.sources[0]?.fingerprint,
            provider: "future-provider",
          },
        },
      ],
    });
    expect(decoded).toEqual(known);
    const merged = mergeUsage([environment("env-a", decoded)], USAGE_CONTRACT_VERSION);
    expect(merged.costUsd).toBe(10);
    expect(merged.totalTokens).toBe(1160);
    expect(merged.contractMismatches).toEqual([]);
  });

  it("normalizes model names during decoding before grouping usage", () => {
    const decoded = decodeSummary(
      summary(
        [
          bucket({ provider: "codex", model: " gpt-5 " }),
          bucket({ provider: "codex", model: "gpt-5" }),
        ],
        [{ provider: "codex", hostId: "mac", homePath: "/a" }],
      ),
    );

    expect(decoded.buckets.map((entry) => entry.model)).toEqual(["gpt-5", "gpt-5"]);
    const merged = mergeUsage([environment("env-a", decoded)], USAGE_CONTRACT_VERSION);
    expect(merged.models).toHaveLength(1);
    expect(merged.models[0]).toMatchObject({ model: "gpt-5", costUsd: 20, totalTokens: 2320 });
  });

  it("keeps all supported providers when encoding a response", () => {
    const current = summary(
      [bucket(), bucket({ provider: "grok" })],
      [
        { provider: "claude", hostId: "mac", homePath: "/a" },
        { provider: "grok", hostId: "mac", homePath: "/b" },
      ],
    );
    expect(encodeSummary(current)).toEqual(current);
    expect(decodeSummary(encodeSummary(current))).toEqual(current);
  });

  it("still rejects a malformed summary envelope", () => {
    expect(() => decodeSummary({ ...summary([], []), buckets: null })).toThrow();
  });

  it("excludes a future incompatible contract even when its buckets still decode", () => {
    const decoded = decodeSummary(
      summary(
        [bucket()],
        [{ provider: "claude", hostId: "mac", homePath: "/a" }],
        USAGE_CONTRACT_VERSION + 1,
      ),
    );
    const merged = mergeUsage([environment("env-a", decoded)], USAGE_CONTRACT_VERSION);
    expect(merged.costUsd).toBe(0);
    expect(merged.contractMismatches).toEqual([
      {
        environmentId: "env-a",
        direction: "clientBehind",
        contractVersion: USAGE_CONTRACT_VERSION + 1,
      },
    ]);
  });

  it("derives provider shares and cost quality", () => {
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary(
            [
              bucket({ costUsd: 75 }),
              bucket({ provider: "codex", model: "gpt-5.6-sol", costUsd: 25, unpricedRecords: 5 }),
            ],
            [
              { provider: "claude", hostId: "mac", homePath: "/a/.claude" },
              { provider: "codex", hostId: "mac", homePath: "/a/.codex" },
            ],
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.providers[0]?.provider).toBe("claude");
    expect(merged.providers[0]?.costShare).toBeCloseTo(0.75, 5);
    expect(merged.costQuality.unpricedShare).toBeCloseTo(0.5, 5);
    expect(merged.costQuality.cacheSavingsUsd).toBe(4);
  });

  it("derives model token shares independently of their cost shares", () => {
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary(
            [
              bucket({ costUsd: 90 }),
              bucket({
                provider: "codex",
                model: "gpt-5.6-sol",
                costUsd: 10,
                totals: {
                  uncachedInputTokens: 3 * 1160,
                  cachedInputTokens: 0,
                  cacheCreationTokens: 0,
                  outputTokens: 0,
                  reasoningTokens: 0,
                },
              }),
            ],
            [
              { provider: "claude", hostId: "mac", homePath: "/a/.claude" },
              { provider: "codex", hostId: "mac", homePath: "/a/.codex" },
            ],
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    const byModel = Object.fromEntries(merged.models.map((model) => [model.model, model]));
    expect(byModel["claude-fable-5"]?.costShare).toBeCloseTo(0.9, 5);
    expect(byModel["claude-fable-5"]?.tokenShare).toBeCloseTo(0.25, 5);
    expect(byModel["gpt-5.6-sol"]?.costShare).toBeCloseTo(0.1, 5);
    expect(byModel["gpt-5.6-sol"]?.tokenShare).toBeCloseTo(0.75, 5);
  });

  it("marks a model with no known rates as unpriced rather than free", () => {
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary(
            [
              bucket({ costUsd: 75 }),
              bucket({
                provider: "codex",
                model: "unknown-model",
                costUsd: 0,
                costSource: "unpriced",
                unpricedRecords: 5,
              }),
            ],
            [
              { provider: "claude", hostId: "mac", homePath: "/a/.claude" },
              { provider: "codex", hostId: "mac", homePath: "/a/.codex" },
            ],
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.models.find((model) => model.model === "unknown-model")?.unpricedRecords).toBe(5);
    expect(merged.models.filter(isModelCostUnknown).map((model) => model.model)).toEqual([
      "unknown-model",
    ]);
  });

  it("splits cost by category and speed, counting older servers as unsplit standard cost", () => {
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary(
            [
              bucket({
                costUsd: 10,
                categoryCostUsd: { input: 1, cacheRead: 2, cacheWrite: 3, output: 4 },
                fastCostUsd: 6,
                speedPremiumUsd: 3,
              }),
              bucket({
                provider: "codex",
                model: "unknown-model",
                costUsd: 0,
                costSource: "unpriced",
                unpricedRecords: 5,
              }),
              bucket({
                provider: "codex",
                model: "partly-reported",
                costUsd: 0,
                unpricedRecords: 4,
              }),
            ],
            [
              { provider: "claude", hostId: "mac", homePath: "/a/.claude" },
              { provider: "codex", hostId: "mac", homePath: "/a/.codex" },
            ],
          ),
        ),
        environment(
          "env-b",
          summary(
            [bucket({ costUsd: 5 })],
            [{ provider: "claude", hostId: "linux", homePath: "/b/.claude" }],
            USAGE_MERGE_COMPATIBLE_SINCE,
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.categoryCost).toEqual({
      input: 1,
      cacheRead: 2,
      cacheWrite: 3,
      output: 4,
      unsplit: 5,
    });
    expect(merged.speedCost).toEqual({ standard: 9, fast: 6, ultrafast: 0, premium: 3 });
    expect(merged.models.map(({ model, unpricedTokens }) => [model, unpricedTokens])).toEqual([
      ["claude-fable-5", 0],
      ["unknown-model", 1160],
      ["partly-reported", 928],
    ]);
  });

  it("orders models by cost descending", () => {
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary(
            [
              bucket({ provider: "claude", model: "lower-cost", costUsd: 4 }),
              bucket({ provider: "codex", model: "higher-cost", costUsd: 9 }),
            ],
            [
              { provider: "claude", hostId: "mac", homePath: "/a/.claude" },
              { provider: "codex", hostId: "mac", homePath: "/a/.codex" },
            ],
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.models.map((model) => model.model)).toEqual(["higher-cost", "lower-cost"]);
  });

  it("keeps two machines apart when hostname and home path collide", () => {
    const shape = { provider: "claude" as const, hostId: "mac", homePath: "/Users/theo/.claude" };
    const merged = mergeUsage(
      [
        environment("env-a", summary([bucket()], [{ ...shape, volumeId: "16777220:1234" }])),
        environment("env-b", summary([bucket()], [{ ...shape, volumeId: "16777221:9999" }])),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.costUsd).toBe(20);
    expect(merged.duplicateSources).toHaveLength(0);
  });

  it("still collapses two servers reading the same directory", () => {
    const same = {
      provider: "claude" as const,
      hostId: "mac",
      homePath: "/Users/theo/.claude",
      volumeId: "16777220:1234",
    };
    const merged = mergeUsage(
      [
        environment("env-a", summary([bucket()], [same])),
        environment("env-b", summary([bucket()], [same])),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.costUsd).toBe(10);
    expect(merged.duplicateSources).toHaveLength(1);
  });

  it("totals sessions from per-directory distinct counts, not per-bucket sums", () => {
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary(
            [bucket({ day: "2026-08-06" as UsageDay }), bucket({ day: "2026-08-07" as UsageDay })],
            [
              {
                provider: "claude",
                hostId: "mac",
                homePath: "/a/.claude",
                distinctSessions: 1,
              },
            ],
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.sessions).toBe(1);
    expect(merged.providers[0]?.sessions).toBe(1);
  });

  it("returns empty totals with no environments", () => {
    const merged = mergeUsage([], USAGE_CONTRACT_VERSION);
    expect(merged.costUsd).toBe(0);
    expect(merged.daily).toHaveLength(0);
    expect(merged.hourly).toHaveLength(0);
  });

  it("omits providers with no sessions or usage", () => {
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary(
            [],
            [
              {
                provider: "claude",
                hostId: "mac",
                homePath: "/a/.claude",
                distinctSessions: 0,
              },
            ],
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.providers).toEqual([]);
  });

  it("derives hourly totals without losing the daily rollup", () => {
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary(
            [
              bucket({ hourStart: "2026-08-07T09:37:00.000Z", costUsd: 3 }),
              bucket({ hourStart: "2026-08-07T10:37:00.000Z", costUsd: 7 }),
            ],
            [{ provider: "claude", hostId: "mac", homePath: "/a/.claude" }],
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.hourly.map((hour) => [hour.hourStart, hour.costUsd])).toEqual([
      ["2026-08-07T09:37:00.000Z", 3],
      ["2026-08-07T10:37:00.000Z", 7],
    ]);
    expect(merged.daily).toHaveLength(1);
    expect(merged.daily[0]?.costUsd).toBe(10);
  });

  it("merges gemini-3.8-flash tiers across buckets into one unified model total", () => {
    const source = { provider: "antigravity" as const, hostId: "mac", homePath: "/a" };
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary(
            [
              bucket({
                provider: "antigravity",
                model: "gemini-3.8-flash-high",
                costUsd: 1,
                totals: {
                  uncachedInputTokens: 100,
                  cachedInputTokens: 0,
                  cacheCreationTokens: 0,
                  outputTokens: 50,
                  reasoningTokens: 0,
                },
              }),
              bucket({
                provider: "antigravity",
                model: "gemini-3.8-flash-medium",
                costUsd: 2,
                totals: {
                  uncachedInputTokens: 200,
                  cachedInputTokens: 0,
                  cacheCreationTokens: 0,
                  outputTokens: 100,
                  reasoningTokens: 0,
                },
              }),
              bucket({
                provider: "antigravity",
                model: "gemini-3.8-flash-tiered",
                costUsd: 3,
                totals: {
                  uncachedInputTokens: 300,
                  cachedInputTokens: 0,
                  cacheCreationTokens: 0,
                  outputTokens: 150,
                  reasoningTokens: 0,
                },
              }),
              bucket({
                provider: "antigravity",
                model: "gemini-3.8-flash-low",
                costUsd: 4,
                totals: {
                  uncachedInputTokens: 400,
                  cachedInputTokens: 0,
                  cacheCreationTokens: 0,
                  outputTokens: 200,
                  reasoningTokens: 0,
                },
              }),
            ],
            [source],
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    const antigravityModels = merged.models.filter((m) => m.provider === "antigravity");
    expect(antigravityModels).toHaveLength(1);
    expect(antigravityModels[0]?.model).toBe("gemini-3.8-flash");
    expect(antigravityModels[0]?.costUsd).toBe(10);
    expect(antigravityModels[0]?.totalTokens).toBe(1500);
  });

  it.each([
    ["claude-sonnet-5-5", "claude-sonnet-5-5-low", "claude-sonnet-5-5-medium"],
    ["claude-opus-5-5", "claude-opus-5-5-medium", "claude-opus-5-5-high"],
    ["gpt-6.1-sol", "gpt-6.1-sol-high", "gpt-6.1-sol-ultra"],
    ["gemini-3.1-pro", "gemini-pro-agent", "gemini-3.1-pro-low"],
  ])("combines %s efforts from different environments", (base, first, second) => {
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary(
            [
              bucket({ provider: "antigravity", model: first, costUsd: 2 }),
              bucket({ provider: "antigravity", model: base, costUsd: 3 }),
            ],
            [{ provider: "antigravity", hostId: "mac-a", homePath: "/a" }],
          ),
        ),
        environment(
          "env-b",
          summary(
            [bucket({ provider: "antigravity", model: second, costUsd: 5 })],
            [{ provider: "antigravity", hostId: "mac-b", homePath: "/b" }],
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );
    expect(merged.models).toHaveLength(1);
    expect(merged.models[0]).toMatchObject({
      model: base,
      costUsd: 10,
      costShare: 1,
      records: 15,
      totalTokens: 3480,
    });
    expect(merged.subscriptionCostUsd).toBe(10);
  });

  it("normalizes displayed model names for opus-thinking, deepseek-v4.1, and glm-5.3", () => {
    const abacusSource = { provider: "abacus" as const, hostId: "mac", homePath: "/a" };
    const antigravitySource = { provider: "antigravity" as const, hostId: "mac", homePath: "/b" };
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary(
            [
              bucket({
                provider: "antigravity",
                model: "claude-opus-4-6-thinking",
                costUsd: 5,
              }),
              bucket({
                provider: "abacus",
                model: "deepseek-ai/DeepSeek-V4.1-Flash",
                costUsd: 2,
              }),
              bucket({
                provider: "abacus",
                model: "zai-org/GLM-5.3-Flash",
                costUsd: 1,
              }),
            ],
            [abacusSource, antigravitySource],
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    const modelNames = merged.models.map((m) => m.model);
    expect(modelNames).toContain("claude-opus-4.6");
    expect(modelNames).toContain("deepseek-v4.1-flash");
    expect(modelNames).toContain("glm-5.3-flash");
  });

  it("tracks credits for abacus and computes subscriptionTotals excluding abacus", () => {
    const codexSource = { provider: "codex" as const, hostId: "mac", homePath: "/a" };
    const abacusSource = { provider: "abacus" as const, hostId: "mac", homePath: "/b" };
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary(
            [
              bucket({
                provider: "codex",
                model: "gpt-5-codex",
                costUsd: 1.5,
                totals: {
                  uncachedInputTokens: 1000,
                  cachedInputTokens: 200,
                  cacheCreationTokens: 0,
                  outputTokens: 300,
                  reasoningTokens: 50,
                },
              }),
              bucket({
                provider: "abacus",
                model: "deepseek-v4.1-flash",
                costUsd: 0.25,
                credits: 500,
                totals: {
                  uncachedInputTokens: 5000,
                  cachedInputTokens: 0,
                  cacheCreationTokens: 0,
                  outputTokens: 1000,
                  reasoningTokens: 0,
                },
              }),
            ],
            [codexSource, abacusSource],
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    // Overall aggregate includes both
    expect(merged.costUsd).toBe(1.75);
    expect(merged.totalTokens).toBe(7500);

    // Subscription-only metrics exclude abacus
    expect(merged.subscriptionCostUsd).toBe(1.5);
    expect(merged.subscriptionTotalTokens).toBe(1500);
    expect(merged.subscriptionTotals.uncachedInputTokens).toBe(1000);
    expect(merged.subscriptionTotals.cachedInputTokens).toBe(200);
    expect(merged.subscriptionTotals.outputTokens).toBe(300);

    // Abacus provider totals have credits
    const abacusProvider = merged.providers.find((p) => p.provider === "abacus");
    expect(abacusProvider?.credits).toBe(500);
    expect(abacusProvider?.costUsd).toBe(0.25);

    // Abacus model totals have credits
    const abacusModel = merged.models.find((m) => m.provider === "abacus");
    expect(abacusModel?.credits).toBe(500);
    expect(abacusModel?.costUsd).toBe(0.25);
  });

  it("separates subscription and credit-based models for codex spillover", () => {
    const codexSource = { provider: "codex" as const, hostId: "mac", homePath: "/a" };
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary(
            [
              // Standard subscription turn
              bucket({
                provider: "codex",
                model: "gpt-5.6-sol",
                costUsd: 2.0,
                totals: {
                  uncachedInputTokens: 2000,
                  cachedInputTokens: 500,
                  cacheCreationTokens: 0,
                  outputTokens: 400,
                  reasoningTokens: 100,
                },
              }),
              // Spillover credit turn (10 credits = $0.40)
              bucket({
                provider: "codex",
                model: "gpt-5.6-sol",
                costUsd: 0.4,
                credits: 10,
                totals: {
                  uncachedInputTokens: 1000,
                  cachedInputTokens: 0,
                  cacheCreationTokens: 0,
                  outputTokens: 200,
                  reasoningTokens: 0,
                },
              }),
            ],
            [codexSource],
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    const subModel = merged.models.find((m) => m.provider === "codex" && !m.isCreditBased);
    expect(subModel).toBeDefined();
    expect(subModel?.costUsd).toBe(2.0);
    expect(subModel?.totalTokens).toBe(2900);
    expect(subModel?.credits).toBeUndefined();

    const creditModel = merged.models.find((m) => m.provider === "codex" && m.isCreditBased);
    expect(creditModel).toBeDefined();
    expect(creditModel?.costUsd).toBe(0.4);
    expect(creditModel?.credits).toBe(10);
    expect(creditModel?.totalTokens).toBe(0);
  });

  it("keeps credit spend out of period provider columns so they sum to Total", () => {
    const codexSource = { provider: "codex" as const, hostId: "mac", homePath: "/a" };
    const totals = {
      uncachedInputTokens: 10,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 2,
      reasoningTokens: 0,
    };
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary(
            [
              bucket({ provider: "codex", model: "gpt-5.6-sol", costUsd: 1, totals }),
              bucket({ provider: "codex", model: "gpt-5.6-sol", costUsd: 3, credits: 25, totals }),
            ],
            [codexSource],
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.daily).toHaveLength(1);
    for (const period of [...merged.daily, ...merged.hourly]) {
      expect(period.costUsd).toBe(1);
      expect(period.byProvider.get("codex")?.costUsd).toBe(1);
    }
    expect(merged.subscriptionCostUsd).toBe(1);
  });

  it("prices codex auto-review at zero in both model buckets", () => {
    const codexSource = { provider: "codex" as const, hostId: "mac", homePath: "/a" };
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary(
            [
              bucket({
                provider: "codex",
                model: "codex-auto-review",
                costUsd: 1,
                totals: {
                  uncachedInputTokens: 10,
                  cachedInputTokens: 0,
                  cacheCreationTokens: 0,
                  outputTokens: 2,
                  reasoningTokens: 0,
                },
              }),
              bucket({
                provider: "codex",
                model: "codex-auto-review",
                costUsd: 0.5,
                credits: 20,
                totals: {
                  uncachedInputTokens: 10,
                  cachedInputTokens: 0,
                  cacheCreationTokens: 0,
                  outputTokens: 2,
                  reasoningTokens: 0,
                },
              }),
            ],
            [codexSource],
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    const autoReviewModels = merged.models.filter(
      (model) => model.provider === "codex" && model.model === "codex-auto-review",
    );
    expect(autoReviewModels).toHaveLength(2);
    expect(autoReviewModels.every((model) => model.costUsd === 0)).toBe(true);
    expect(merged.costUsd).toBe(0);
  });
});
