import { describe, expect, it } from "@effect/vitest";

import { cursorRateModel } from "@t3tools/provider-cursor/server/accountUsage";
import type { UsageSpeed } from "@t3tools/provider-core/server/usage";
import {
  cacheSavingsUsd,
  createOverrideRateTable,
  lookupRate,
  parseRateTable,
  priceUsage,
} from "./usagePricing.ts";

const rate = (input: number, cacheRead?: number) => ({
  input_cost_per_token: input,
  output_cost_per_token: input * 5,
  ...(cacheRead === undefined ? {} : { cache_read_input_token_cost: cacheRead }),
});

describe("usage pricing", () => {
  const totals = {
    uncachedInputTokens: 1_000_000,
    cachedInputTokens: 1_000_000,
    cacheCreationTokens: 1_000_000,
    outputTokens: 1_000_000,
    reasoningTokens: 500_000,
  };
  const record = (
    model: string,
    reportedCostUsd: number | null = null,
    speed: UsageSpeed = "standard",
    timestampMs = Date.parse("2026-10-11T00:00:00Z"),
  ) => ({
    model,
    totals,
    reportedCostUsd,
    speed,
    timestampMs,
  });

  it.each([
    ["gpt-6-astra", 73.5],
    ["gpt-6.1-sol", 14.6],
    ["gpt-6-sol", 14.7],
    ["gpt-6-luna", 0.735],
    ["gpt-5.6-sol", 29.4],
    ["gpt-5.6-terra", 16.7],
    ["gpt-5.6-luna", 1.67],
    ["claude-opus-5-5", 29.2],
    ["claude-sonnet-5-5", 14.6],
    ["claude-opus-4.6", 36.75],
    ["gemini-3.8-flash", 5.325],
    ["gemini-pro-agent", 16.2],
    ["gemini-pro-default", 16.2],
    ["gemini-4-argon", 14.1],
    ["gemini-3.1-pro-preview", 16.2],
  ])("prices %s offline at official standard rates", (model, expected) => {
    const priced = priceUsage(new Map(), record(model));
    expect(priced.costSource).toBe("modelPriced");
    expect(priced.costUsd).toBeCloseTo(expected, 9);
  });

  it.each([
    ["gemini-4-argon", "2026-11-30T23:59:59Z", 14.1, "2026-12-01T00:00:00Z", 28.2],
    ["gemini-3.8-flash", "2026-12-31T23:59:59Z", 5.325, "2027-01-01T00:00:00Z", 10.65],
  ])(
    "prices %s by the record's date once its launch rate ends",
    (model, before, launchCost, after, standardCost) => {
      const at = (iso: string) => record(model, null, "standard", Date.parse(iso));
      expect(priceUsage(new Map(), at(before)).costUsd).toBeCloseTo(launchCost, 9);
      expect(priceUsage(new Map(), at(after)).costUsd).toBeCloseTo(standardCost, 9);
      expect(cacheSavingsUsd(new Map(), at(after))).toBeCloseTo(
        2 * cacheSavingsUsd(new Map(), at(before)),
        9,
      );
    },
  );

  it("uses verified rates ahead of stale public rates while honoring custom and reported costs", () => {
    const table = parseRateTable({ "claude-sonnet-5-5": rate(1) });
    expect(priceUsage(table, record("claude-sonnet-5-5-medium")).costUsd).toBeCloseTo(14.6);
    expect(priceUsage(table, record("claude-sonnet-5-5-low", 7)).costUsd).toBe(7);
    const overrides = createOverrideRateTable({
      "claude-sonnet-5-5": { inputCostPerMillionTokens: 1, outputCostPerMillionTokens: 2 },
      "claude-sonnet-5-5-high": { inputCostPerMillionTokens: 2, outputCostPerMillionTokens: 4 },
    });
    expect(priceUsage(table, record("claude-sonnet-5-5-low", 7), overrides).costUsd).toBe(5);
    expect(priceUsage(table, record("claude-sonnet-5-5-high", 7), overrides).costUsd).toBe(10);
    const variantOnly = createOverrideRateTable({
      "claude-sonnet-5-5-high": { inputCostPerMillionTokens: 2, outputCostPerMillionTokens: 4 },
    });
    expect(priceUsage(table, record("claude-sonnet-5-5-low"), variantOnly).costUsd).toBeCloseTo(
      14.6,
    );
  });

  it("uses custom token rates ahead of public and provider-reported costs", () => {
    const table = parseRateTable({ "example-model": rate(1) });
    const overrides = createOverrideRateTable({
      "example-model": {
        inputCostPerMillionTokens: 2,
        outputCostPerMillionTokens: 8,
        cacheReadCostPerMillionTokens: 0.5,
        cacheWriteCostPerMillionTokens: 3,
      },
    });

    for (const reportedCostUsd of [null, 99]) {
      expect(priceUsage(table, record("example-model", reportedCostUsd), overrides)).toMatchObject({
        costUsd: 13.5,
        costSource: "modelPriced",
      });
    }
    expect(cacheSavingsUsd(table, record("example-model"), overrides)).toBe(1.5);
  });

  it("prices Cursor cache savings at the base model rate", () => {
    const table = parseRateTable({
      "claude-fable-5-1": rate(10e-6, 1e-6),
      "xai/grok-4.7": rate(2e-6, 0.5e-6),
      "openrouter/x-ai/grok-4.7": rate(3e-6, 0.5e-6),
    });
    const cursorRecord = (model: string) => ({
      ...record(model, 0.25),
      rateModel: cursorRateModel(model),
    });

    expect(cacheSavingsUsd(table, cursorRecord("claude-fable-5-1-thinking-high"))).toBeCloseTo(9);
    expect(cacheSavingsUsd(table, cursorRecord("cursor-grok-4.7-high-fast"))).toBeCloseTo(1.5);
    expect(cacheSavingsUsd(table, cursorRecord("default"))).toBe(0);
    expect(priceUsage(table, cursorRecord("grok-4.7-xhigh-fast"))).toMatchObject({
      costUsd: 0.25,
      costSource: "providerReported",
    });
  });

  it("falls back to the display model when the rate model is unlisted", () => {
    const table = parseRateTable({ "example-model": rate(1e-6, 0.1e-6) });
    const unlisted = { ...record("example-model"), rateModel: "reseller/example-model" };

    expect(priceUsage(table, unlisted)).toEqual(priceUsage(table, record("example-model")));
    expect(cacheSavingsUsd(table, unlisted)).toBeCloseTo(0.9);
  });

  it("prices unknown models offline and uses input prices for omitted cache rates", () => {
    const table = parseRateTable({});
    const overrides = createOverrideRateTable({
      "example-model": { inputCostPerMillionTokens: 2, outputCostPerMillionTokens: 8 },
    });

    expect(priceUsage(table, record("example-model"), overrides)).toMatchObject({
      costUsd: 14,
      costSource: "modelPriced",
    });
    expect(cacheSavingsUsd(table, record("example-model"), overrides)).toBe(0);
  });

  it("preserves explicit zero rates and matches only the exact trimmed model ID", () => {
    const table = parseRateTable({});
    const overrides = createOverrideRateTable({
      " vendor/example-model[1m] ": {
        inputCostPerMillionTokens: 0,
        outputCostPerMillionTokens: 0,
      },
    });
    expect(priceUsage(table, record(" vendor/example-model[1m] ", 99), overrides)).toMatchObject({
      costUsd: 0,
      costSource: "modelPriced",
    });
    for (const model of [
      "example-model[1m]",
      "vendor/example-model",
      "vendor/Example-model[1m]",
      "other/example-model[1m]",
    ]) {
      expect(priceUsage(table, record(model), overrides).costSource).toBe("unpriced");
      expect(priceUsage(table, record(model, 99), overrides)).toEqual({
        costUsd: 99,
        costSource: "providerReported",
        categoryCostUsd: null,
        speedPremiumUsd: 0,
      });
    }
  });

  it("prices fast-mode requests at the model's published fast multiple", () => {
    const table = parseRateTable({
      "claude-opus-5-5": { ...rate(4e-6, 2e-7), provider_specific_entry: { fast: 2, us: 1.1 } },
      "claude-fable-5-1": { ...rate(1e-5, 2.5e-7), provider_specific_entry: { us: 1.1 } },
    });
    const overrides = createOverrideRateTable({
      "claude-opus-5-5": { inputCostPerMillionTokens: 4, outputCostPerMillionTokens: 20 },
    });
    const cost = (model: string, speed: UsageSpeed, custom?: typeof overrides) =>
      priceUsage(table, record(model, null, speed), custom).costUsd;

    expect(cost("claude-opus-5-5", "fast")).toBeCloseTo(2 * cost("claude-opus-5-5", "standard"));
    expect(cacheSavingsUsd(table, record("claude-opus-5-5", null, "fast"))).toBeCloseTo(
      2 * cacheSavingsUsd(table, record("claude-opus-5-5")),
    );
    expect(cost("claude-fable-5-1", "fast")).toBe(cost("claude-fable-5-1", "standard"));
    expect(cost("claude-opus-5-5", "fast", overrides)).toBe(
      cost("claude-opus-5-5", "standard", overrides),
    );
  });

  it("splits cost by category and prices the speed premium", () => {
    const table = parseRateTable({
      "fast-model": {
        ...rate(4e-6, 4e-7),
        cache_creation_input_token_cost: 5e-6,
        provider_specific_entry: { fast: 2 },
      },
    });
    const split = (input: number, cacheRead: number, cacheWrite: number, output: number) => ({
      input: expect.closeTo(input),
      cacheRead: expect.closeTo(cacheRead),
      cacheWrite: expect.closeTo(cacheWrite),
      output: expect.closeTo(output),
    });

    expect(priceUsage(table, record("fast-model", null, "fast"))).toEqual({
      costUsd: expect.closeTo(58.8),
      costSource: "modelPriced",
      categoryCostUsd: split(8, 0.8, 10, 40),
      speedPremiumUsd: expect.closeTo(29.4),
    });
    expect(priceUsage(table, record("fast-model", 29.4, "fast"))).toEqual({
      costUsd: 29.4,
      costSource: "providerReported",
      categoryCostUsd: split(4, 0.4, 5, 20),
      speedPremiumUsd: expect.closeTo(14.7),
    });
    expect(priceUsage(table, record("unknown-model", 29.4, "fast"))).toMatchObject({
      costUsd: 29.4,
      categoryCostUsd: null,
      speedPremiumUsd: 0,
    });
  });

  it("prices Codex priority and ultrafast requests at their published tier rates", () => {
    const table = parseRateTable({
      "gpt-6-astra": {
        ...rate(1e-5, 1e-6),
        input_cost_per_token_priority: 2e-5,
        output_cost_per_token_priority: 1e-4,
        cache_read_input_token_cost_priority: 2e-6,
        input_cost_per_token_ultrafast: 6e-5,
        output_cost_per_token_ultrafast: 3e-4,
      },
      "gpt-6-sol": rate(2e-6, 2e-7),
    });
    const cost = (model: string, speed: UsageSpeed) =>
      priceUsage(table, record(model, null, speed)).costUsd;
    const standard = cost("gpt-6-astra", "standard");

    expect(cost("gpt-6-astra", "fast")).toBeCloseTo(2 * standard);
    expect(cost("gpt-6-astra", "ultrafast")).toBeCloseTo(6 * standard);
    expect(cacheSavingsUsd(table, record("gpt-6-astra", null, "ultrafast"))).toBeCloseTo(
      6 * cacheSavingsUsd(table, record("gpt-6-astra")),
    );
    expect(cost("gpt-6-sol", "ultrafast")).toBe(cost("gpt-6-sol", "standard"));
  });

  it("prices a request above the model's long-context threshold at its above-tier rates", () => {
    const table = parseRateTable({
      "claude-haiku-5-5": {
        input_cost_per_token: 1e-6,
        output_cost_per_token: 5e-6,
        cache_read_input_token_cost: 1e-7,
        cache_creation_input_token_cost: 1.25e-6,
        input_cost_per_token_above_100k_tokens: 2e-6,
        output_cost_per_token_above_100k_tokens: 7.5e-6,
        cache_read_input_token_cost_above_100k_tokens: 2e-7,
        cache_creation_input_token_cost_above_100k_tokens: 2.5e-6,
      },
      "gpt-6-sol": {
        ...rate(2e-6, 2e-7),
        input_cost_per_token_priority: 4e-6,
        output_cost_per_token_priority: 2e-5,
        cache_read_input_token_cost_priority: 4e-7,
        input_cost_per_token_above_272k_tokens_priority: 8e-6,
        output_cost_per_token_above_272k_tokens_priority: 3e-5,
        cache_read_input_token_cost_above_272k_tokens_priority: 8e-7,
      },
    });
    const longRequest = (
      model: string,
      speed: UsageSpeed,
      totals: { uncached: number; cacheRead: number; cacheWrite: number; output: number },
    ) => ({
      model,
      speed,
      reportedCostUsd: null,
      totals: {
        uncachedInputTokens: totals.uncached,
        cachedInputTokens: totals.cacheRead,
        cacheCreationTokens: totals.cacheWrite,
        outputTokens: totals.output,
        reasoningTokens: 0,
      },
    });

    // The Claude prompt is input + cache read + cache write: 120K, above the 100K tier.
    expect
      .soft(
        priceUsage(
          table,
          longRequest("claude-haiku-5-5", "standard", {
            uncached: 10_000,
            cacheRead: 100_000,
            cacheWrite: 10_000,
            output: 1_000,
          }),
        ).costUsd,
      )
      .toBeCloseTo(10_000 * 2e-6 + 100_000 * 2e-7 + 10_000 * 2.5e-6 + 1_000 * 7.5e-6, 12);
    expect(
      priceUsage(
        table,
        longRequest("gpt-6-sol", "fast", {
          uncached: 20_000,
          cacheRead: 280_000,
          cacheWrite: 0,
          output: 1_000,
        }),
      ).costUsd,
    ).toBeCloseTo(20_000 * 8e-6 + 280_000 * 8e-7 + 1_000 * 3e-5, 12);
  });

  it("bills the long-context tier only above its threshold, filling missing tier fields from base", () => {
    const table = parseRateTable({
      "gpt-6-sol": {
        input_cost_per_token: 2e-6,
        output_cost_per_token: 1e-5,
        cache_read_input_token_cost: 2e-7,
        input_cost_per_token_priority: 4e-6,
        output_cost_per_token_priority: 2e-5,
        input_cost_per_token_above_272k_tokens: 4e-6,
      },
    });
    const cost = (prompt: number, speed: UsageSpeed = "standard") =>
      priceUsage(table, {
        model: "gpt-6-sol",
        speed,
        reportedCostUsd: null,
        totals: {
          uncachedInputTokens: prompt - 200_000,
          cachedInputTokens: 200_000,
          cacheCreationTokens: 0,
          outputTokens: 1_000,
          reasoningTokens: 0,
        },
      }).costUsd;

    expect(cost(272_000)).toBeCloseTo(72_000 * 2e-6 + 200_000 * 2e-7 + 1_000 * 1e-5, 12);
    // Output keeps the base rate; cache reads keep the base discount relative to input.
    expect(cost(272_001)).toBeCloseTo(72_001 * 4e-6 + 200_000 * 4e-7 + 1_000 * 1e-5, 12);
    // Without a priority long-context rate, priority requests keep the priority rate.
    expect(cost(272_001, "fast")).toBeCloseTo(72_001 * 4e-6 + 200_000 * 4e-7 + 1_000 * 2e-5, 12);
  });

  it("keeps the canonical Fable rate separate from DeepInfra in either order", () => {
    const canonical = ["claude-fable-5", rate(1e-5, 1e-6)] as const;
    const deepInfra = ["deepinfra/anthropic/claude-fable-5", rate(1e-5)] as const;

    for (const entries of [
      [canonical, deepInfra],
      [deepInfra, canonical],
    ]) {
      const table = parseRateTable(Object.fromEntries(entries));

      expect(lookupRate(table, "claude-fable-5")?.cacheReadCostPerToken).toBe(1e-6);
      expect(lookupRate(table, "deepinfra/anthropic/claude-fable-5")?.cacheReadCostPerToken).toBe(
        1e-5,
      );
      expect(lookupRate(table, "other/claude-fable-5")).toBeNull();
    }
  });

  it("prices a bracketed context-tier variant at the base model's rate", () => {
    const table = parseRateTable({ "claude-fable-5-1": rate(1e-5, 2.5e-7) });

    expect(lookupRate(table, "claude-fable-5-1[1m]")).toEqual(
      lookupRate(table, "claude-fable-5-1"),
    );
    expect(lookupRate(table, "anthropic/Claude-Fable-5-1[1m]")).toBeNull();
  });

  it("adds a bare alias when every qualified entry has the same rate", () => {
    const table = parseRateTable({
      "provider-a/example-model": rate(1),
      "provider-b/example-model": rate(1),
    });

    expect(lookupRate(table, "example-model")).toEqual(
      lookupRate(table, "provider-a/example-model"),
    );
  });

  it("keeps a bare alias when a reseller entry omits the fast tier", () => {
    const table = parseRateTable({
      "provider-a/example-model": {
        ...rate(1),
        input_cost_per_token_priority: 2,
        output_cost_per_token_priority: 10,
        input_cost_per_token_above_272k_tokens: 2,
        input_cost_per_token_above_272k_tokens_priority: 4,
        output_cost_per_token_above_272k_tokens_priority: 20,
      },
      "provider-b/example-model": { ...rate(1), input_cost_per_token_above_272k_tokens: 2 },
      "provider-c/example-model": rate(1),
    });

    expect(lookupRate(table, "example-model")).toEqual(
      lookupRate(table, "provider-a/example-model"),
    );
  });

  it("leaves an ambiguous bare name unpriced", () => {
    const table = parseRateTable({
      "provider-a/example-model": rate(1),
      "provider-b/example-model": rate(3),
    });

    expect(lookupRate(table, "provider-a/example-model")?.inputCostPerToken).toBe(1);
    expect(lookupRate(table, "provider-b/example-model")?.inputCostPerToken).toBe(3);
    expect(lookupRate(table, "example-model")).toBeNull();
  });

  it("resolves rates for Antigravity reasoning tiers and ChatLLM models", () => {
    const table = parseRateTable({
      "gemini-3.8-flash": {
        input_cost_per_token: 0.75 / 1_000_000,
        output_cost_per_token: 3.75 / 1_000_000,
        cache_read_input_token_cost: 0.075 / 1_000_000,
        cache_creation_input_token_cost: 0.75 / 1_000_000,
      },
      "gemini-2.5-pro": {
        input_cost_per_token: 1.25 / 1_000_000,
        output_cost_per_token: 10 / 1_000_000,
        cache_read_input_token_cost: 0.3125 / 1_000_000,
        cache_creation_input_token_cost: 1.25 / 1_000_000,
      },
      "zai/glm-5.3-flash": {
        input_cost_per_token: 0.15 / 1_000_000,
        output_cost_per_token: 0.5 / 1_000_000,
        cache_read_input_token_cost: 0.03 / 1_000_000,
      },
      "claude-opus-4-6": {
        input_cost_per_token: 5.0 / 1_000_000,
        output_cost_per_token: 25.0 / 1_000_000,
        cache_read_input_token_cost: 0.5 / 1_000_000,
        cache_creation_input_token_cost: 6.25 / 1_000_000,
      },
    });

    // Reasoning effort tiers and tiered variant map to base gemini-3.8-flash,
    // whose standard rate outranks the table; the launch rate applies per record.
    expect(lookupRate(table, "gemini-3.8-flash-high")?.inputCostPerToken).toBe(1.5 / 1_000_000);
    expect(lookupRate(table, "gemini-3.8-flash-medium")?.outputCostPerToken).toBe(7.5 / 1_000_000);
    expect(lookupRate(table, "gemini-3.8-flash-low")?.cacheReadCostPerToken).toBe(0.15 / 1_000_000);
    expect(lookupRate(table, "gemini-3.8-flash-tiered")?.inputCostPerToken).toBe(1.5 / 1_000_000);

    // claude-opus-4-6-thinking maps to claude-opus-4-6
    expect(lookupRate(table, "claude-opus-4-6-thinking")?.inputCostPerToken).toBe(5.0 / 1_000_000);

    // Auto-review has no public API token rate; aggregation accounts for it at zero.
    expect(lookupRate(table, "codex-auto-review")).toBeNull();

    expect(lookupRate(table, "gemini-pro-agent")?.inputCostPerToken).toBe(2 / 1_000_000);

    // zai-org resolves to zai/glm-5.3-flash
    expect(lookupRate(table, "zai-org/GLM-5.3-Flash")?.inputCostPerToken).toBe(0.15 / 1_000_000);

    // DeepSeek and route-llm resolve via static fallbacks if not in table
    expect(lookupRate(table, "deepseek-ai/DeepSeek-V4.1-Flash")?.inputCostPerToken).toBe(
      0.15 / 1_000_000,
    );
    expect(lookupRate(table, "route-llm")?.outputCostPerToken).toBe(1.2 / 1_000_000);
  });

  it("prices a bare name at the model maker's rate when a reseller marks it up", () => {
    const reseller = { "kyma/gemini-example-pro": rate(5.4e-6) };
    const makers = {
      "gemini/gemini-example-pro": rate(2e-6, 1e-7),
      "vertex_ai/gemini-example-pro": rate(2e-6, 1e-7),
    };

    for (const document of [
      { ...reseller, ...makers },
      { ...makers, ...reseller },
    ]) {
      const table = parseRateTable(document);
      expect(lookupRate(table, "gemini-example-pro")).toEqual(
        lookupRate(table, "gemini/gemini-example-pro"),
      );
    }
  });

  it("prices a bare name listed only under Bedrock IDs at the base anthropic rate", () => {
    const bedrock = (input: number, output: number, cacheRead: number, cacheCreation: number) => ({
      input_cost_per_token: input,
      output_cost_per_token: output,
      cache_read_input_token_cost: cacheRead,
      cache_creation_input_token_cost: cacheCreation,
    });
    const base = bedrock(8e-6, 4e-5, 2e-7, 1e-5);
    const regional = bedrock(8.8e-6, 4.4e-5, 2.2e-7, 1.1e-5);
    const govCloud = bedrock(9.6e-6, 4.8e-5, 2.4e-7, 1.2e-5);
    const rows = [
      ["anthropic.claude-mythos-5-2", base],
      ["global.anthropic.claude-mythos-5-2", base],
      ["us.anthropic.claude-mythos-5-2", regional],
      ["eu.anthropic.claude-mythos-5-2", regional],
      ["us-gov.anthropic.claude-mythos-5-2", govCloud],
      ["bedrock/us-gov-east-1/anthropic.claude-mythos-5-2", govCloud],
      ["bedrock/us-gov-west-1/anthropic.claude-mythos-5-2", govCloud],
    ] as const;

    for (const entries of [rows, rows.toReversed()]) {
      const table = parseRateTable(Object.fromEntries(entries));
      expect(lookupRate(table, "claude-mythos-5-2")).toMatchObject({
        inputCostPerToken: 8e-6,
        outputCostPerToken: 4e-5,
        cacheReadCostPerToken: 2e-7,
        cacheCreationCostPerToken: 1e-5,
      });
    }
  });

  it("leaves a bare name unpriced when model makers' own entries disagree", () => {
    const table = parseRateTable({
      "openai/example-model": rate(1),
      "xai/example-model": rate(3),
      "kyma/example-model": rate(1),
    });

    expect(lookupRate(table, "example-model")).toBeNull();
  });
});
