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
  ) => ({
    model,
    totals,
    reportedCostUsd,
    speed,
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

    // Reasoning effort tiers and tiered variant map to base gemini-3.8-flash
    expect(lookupRate(table, "gemini-3.8-flash-high")?.inputCostPerToken).toBe(0.75 / 1_000_000);
    expect(lookupRate(table, "gemini-3.8-flash-medium")?.outputCostPerToken).toBe(3.75 / 1_000_000);
    expect(lookupRate(table, "gemini-3.8-flash-low")?.cacheReadCostPerToken).toBe(
      0.075 / 1_000_000,
    );
    expect(lookupRate(table, "gemini-3.8-flash-tiered")?.inputCostPerToken).toBe(0.75 / 1_000_000);

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
});
