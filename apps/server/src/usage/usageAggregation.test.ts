import { describe, expect, it } from "@effect/vitest";

import {
  resolveModelAliases,
  UsageAggregator,
  type CreditedUsageRecord,
} from "./usageAggregation.ts";
import { createOverrideRateTable, type RateTable } from "./usagePricing.ts";
import type { UsageRecord } from "@t3tools/provider-core/server/usage";

const rates: RateTable = new Map([
  [
    "claude-fable-5",
    {
      inputCostPerToken: 1e-5,
      outputCostPerToken: 5e-5,
      cacheReadCostPerToken: 1e-6,
      cacheCreationCostPerToken: 1.25e-5,
      fast: {
        inputCostPerToken: 2e-5,
        outputCostPerToken: 1e-4,
        cacheReadCostPerToken: 2e-6,
        cacheCreationCostPerToken: 2.5e-5,
      },
      ultrafast: null,
    },
  ],
  [
    "gpt-5.6-luna",
    {
      inputCostPerToken: 1e-6,
      outputCostPerToken: 2e-6,
      cacheReadCostPerToken: 5e-7,
      cacheCreationCostPerToken: 1.25e-6,
      fast: null,
      ultrafast: null,
    },
  ],
]);

function record(overrides: Partial<CreditedUsageRecord> = {}): CreditedUsageRecord {
  return {
    provider: "claude",
    timestampMs: Date.parse("2026-08-07T04:05:13.944Z"),
    model: "claude-fable-5",
    sessionId: "session-a",
    totals: {
      uncachedInputTokens: 100,
      cachedInputTokens: 1000,
      cacheCreationTokens: 10,
      outputTokens: 50,
      reasoningTokens: 0,
    },
    reportedCostUsd: null,
    speed: "standard",
    dedupeKey: null,
    ...overrides,
  };
}

function aggregate(
  records: readonly UsageRecord[],
  timeZone = "UTC",
  resolution: "day" | "hour" = "day",
) {
  const hourlyBounds =
    resolution === "hour"
      ? {
          sinceTimeMs: Date.parse("2026-08-06T04:37:00.000Z"),
          untilTimeMs: Date.parse("2026-08-07T04:37:00.000Z"),
        }
      : {};
  const aggregator = new UsageAggregator({
    timeZone,
    sinceDay: "2026-08-01",
    untilDay: "2026-08-31",
    resolution,
    ...hourlyBounds,
    rates,
  });
  for (const item of records) aggregator.add(item);
  return aggregator.finish();
}

describe("UsageAggregator", () => {
  it("splits a bucket's cost by category and speed", () => {
    const [bucket] = aggregate([record(), record({ speed: "fast" })]).buckets;

    expect(bucket).toMatchObject({
      costUsd: expect.closeTo(0.016875),
      categoryCostUsd: {
        input: expect.closeTo(0.003),
        cacheRead: expect.closeTo(0.003),
        cacheWrite: expect.closeTo(0.000375),
        output: expect.closeTo(0.0075),
      },
      fastCostUsd: expect.closeTo(0.01125),
      speedPremiumUsd: expect.closeTo(0.005625),
    });
    expect(bucket).not.toHaveProperty("ultrafastCostUsd");
  });

  it("keeps only the first record for a repeated dedupe key", () => {
    const result = aggregate([
      record({ dedupeKey: "msg_1:" }),
      record({ dedupeKey: "msg_1:" }),
      record({ dedupeKey: "msg_1:" }),
    ]);

    expect(result.duplicatesDropped).toBe(2);
    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0]?.records).toBe(1);
    expect(result.buckets[0]?.totals.outputTokens).toBe(50);
  });

  it("leaves Claude's locally generated <synthetic> messages out of usage", () => {
    const result = aggregate([record(), record({ model: "<synthetic>" })]);

    expect(result.buckets.map((bucket) => bucket.model)).toEqual([record().model]);
    expect(result.buckets[0]?.records).toBe(1);
  });

  it("still sums records that carry no dedupe key", () => {
    const result = aggregate([record(), record()]);

    expect(result.duplicatesDropped).toBe(0);
    expect(result.buckets[0]?.totals.outputTokens).toBe(100);
  });

  it("buckets by the day in the requested time zone", () => {
    const utc = aggregate([record()], "UTC");
    const losAngeles = aggregate([record()], "America/Los_Angeles");

    expect(utc.buckets[0]?.day).toBe("2026-08-07");
    expect(losAngeles.buckets[0]?.day).toBe("2026-08-06");
  });

  it("finds the day at a quarter-hour zone's midnight across interleaved buckets", () => {
    const result = aggregate(
      [
        record({ timestampMs: Date.parse("2026-08-01T18:14:59.999Z") }),
        record({ timestampMs: Date.parse("2026-08-01T18:15:00.000Z") }),
        record({ timestampMs: Date.parse("2026-08-01T18:15:00.000Z"), model: "claude-opus-5" }),
        record({ timestampMs: Date.parse("2026-08-01T18:16:00.000Z") }),
      ],
      "Asia/Kathmandu",
    );

    expect(result.buckets.map((bucket) => [bucket.day, bucket.model, bucket.records])).toEqual([
      ["2026-08-01", "claude-fable-5", 1],
      ["2026-08-02", "claude-fable-5", 2],
      ["2026-08-02", "claude-opus-5", 1],
    ]);
  });

  it("finds the day at a fixed offset's midnight between quarter hours", () => {
    const result = aggregate(
      [
        record({ timestampMs: Date.parse("2026-08-01T23:58:59.999Z") }),
        record({ timestampMs: Date.parse("2026-08-01T23:59:00.000Z") }),
      ],
      "+00:01",
    );

    expect(result.buckets.map((bucket) => [bucket.day, bucket.records])).toEqual([
      ["2026-08-01", 1],
      ["2026-08-02", 1],
    ]);
  });

  it("splits an hourly request into fixed buckets anchored to its exact start", () => {
    const result = aggregate(
      [
        record({ timestampMs: Date.parse("2026-08-07T02:40:13.944Z") }),
        record({ timestampMs: Date.parse("2026-08-07T03:40:13.944Z") }),
      ],
      "America/Los_Angeles",
      "hour",
    );

    expect(result.buckets.map((bucket) => [bucket.day, bucket.hourStart])).toEqual([
      ["2026-08-06", "2026-08-07T02:37:00.000Z"],
      ["2026-08-06", "2026-08-07T03:37:00.000Z"],
    ]);
  });

  it("uses an inclusive start and exclusive end for rolling windows", () => {
    const result = aggregate(
      [
        record({ timestampMs: Date.parse("2026-08-06T04:36:59.999Z") }),
        record({ timestampMs: Date.parse("2026-08-06T04:37:00.000Z") }),
        record({ timestampMs: Date.parse("2026-08-07T04:36:59.999Z") }),
        record({ timestampMs: Date.parse("2026-08-07T04:37:00.000Z") }),
      ],
      "UTC",
      "hour",
    );

    expect(result.outOfWindow).toBe(2);
    expect(result.buckets.map((bucket) => bucket.hourStart)).toEqual([
      "2026-08-06T04:37:00.000Z",
      "2026-08-07T03:37:00.000Z",
    ]);
  });


  it("prices ChatLLM Argon usage while preserving reported credits", () => {
    const result = aggregate([
      record({ provider: "abacus", model: "gemini-4-argon", credits: 42 }),
    ]);

    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0]).toMatchObject({
      provider: "abacus",
      model: "gemini-4-argon",
      costUsd: expect.closeTo(0.00082, 9),
      costSource: "modelPriced",
      credits: 42,
      unpricedRecords: 0,
    });
  });

  it("takes a ledger-billed day's cost from the ledger and only tokens from turns", () => {
    const aggregator = new UsageAggregator({
      timeZone: "UTC",
      sinceDay: "2026-08-01",
      untilDay: "2026-08-31",
      rates,
      billedDays: new Map([["abacus", new Set(["2026-08-07"])]]),
    });
    const turn = { provider: "abacus", model: "gemini-4-argon", credits: 42 } as const;
    aggregator.add(record(turn));
    aggregator.add(record({ ...turn, timestampMs: Date.parse("2026-08-08T01:00:00Z") }));
    aggregator.add(
      record({
        ...turn,
        credits: 30,
        reportedCostUsd: 0.015,
        billingDay: "2026-08-07",
        sessionId: "",
        totals: {
          uncachedInputTokens: 0,
          cachedInputTokens: 0,
          cacheCreationTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
        },
      }),
    );
    const byDay = new Map<string, { credits: number; costUsd: number; outputTokens: number }>();
    for (const bucket of aggregator.finish().buckets) {
      const day = byDay.get(bucket.day) ?? { credits: 0, costUsd: 0, outputTokens: 0 };
      day.credits += bucket.credits ?? 0;
      day.costUsd += bucket.costUsd;
      day.outputTokens += bucket.totals.outputTokens;
      byDay.set(bucket.day, day);
    }

    expect(byDay.get("2026-08-07")).toEqual({ credits: 30, costUsd: 0.015, outputTokens: 50 });
    expect(byDay.get("2026-08-08")).toMatchObject({ credits: 42, outputTokens: 50 });
  });

  it("counts tokens but not cost for a model with no rate", () => {
    const result = aggregate([record({ model: "kimi-k3" })]);

    expect(result.buckets[0]?.costUsd).toBe(0);
    expect(result.buckets[0]?.costSource).toBe("unpriced");
    expect(result.buckets[0]?.unpricedRecords).toBe(1);
    expect(result.buckets[0]?.totals.outputTokens).toBe(50);
  });

  it("prefers a reported cost over the rate table", () => {
    const result = aggregate([record({ reportedCostUsd: 1.25 })]);

    expect(result.buckets[0]?.costUsd).toBe(1.25);
    expect(result.buckets[0]?.costSource).toBe("providerReported");
  });

  it("folds a mapped model into its target and prices it there", () => {
    const aggregator = new UsageAggregator({
      timeZone: "UTC",
      sinceDay: "2026-08-01",
      untilDay: "2026-08-31",
      rates,
      modelAliases: resolveModelAliases({ "example-preview": "claude-fable-5" }),
    });
    aggregator.add(record());
    aggregator.add(record({ model: "example-preview", rateModel: "example-preview-high" }));
    const result = aggregator.finish();

    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0]?.model).toBe("claude-fable-5");
    expect(result.buckets[0]?.records).toBe(2);
    expect(result.buckets[0]?.costUsd).toBeCloseTo(0.00925, 9);
    expect(result.buckets[0]?.unpricedRecords).toBe(0);
  });

  it("merges gemini-3.8-flash tiers (high, medium, low, tiered) into unified gemini-3.8-flash accounting", () => {
    const result = aggregate([
      record({
        provider: "antigravity",
        model: "gemini-3.8-flash-high",
        totals: {
          uncachedInputTokens: 100,
          cachedInputTokens: 0,
          cacheCreationTokens: 0,
          outputTokens: 50,
          reasoningTokens: 0,
        },
      }),
      record({
        provider: "antigravity",
        model: "gemini-3.8-flash-medium",
        totals: {
          uncachedInputTokens: 200,
          cachedInputTokens: 0,
          cacheCreationTokens: 0,
          outputTokens: 100,
          reasoningTokens: 0,
        },
      }),
      record({
        provider: "antigravity",
        model: "gemini-3.8-flash-tiered",
        totals: {
          uncachedInputTokens: 300,
          cachedInputTokens: 0,
          cacheCreationTokens: 0,
          outputTokens: 150,
          reasoningTokens: 0,
        },
      }),
      record({
        provider: "antigravity",
        model: "gemini-3.8-flash-low",
        totals: {
          uncachedInputTokens: 400,
          cachedInputTokens: 0,
          cacheCreationTokens: 0,
          outputTokens: 200,
          reasoningTokens: 0,
        },
      }),
    ]);

    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0]?.model).toBe("gemini-3.8-flash");
    expect(result.buckets[0]?.totals.uncachedInputTokens).toBe(1000);
    expect(result.buckets[0]?.totals.outputTokens).toBe(500);
    expect(result.buckets[0]?.records).toBe(4);
  });
});

describe("resolveModelAliases", () => {
  it("follows chains to the final model and drops chains that enter a loop", () => {
    expect(
      resolveModelAliases({
        "preview[1m]": "preview",
        preview: "example-model",
        loop: "back",
        back: "loop",
        intoLoop: "loop",
        self: "self",
      }),
    ).toEqual(
      new Map([
        ["preview[1m]", "example-model"],
        ["preview", "example-model"],
      ]),
    );
  });
});
