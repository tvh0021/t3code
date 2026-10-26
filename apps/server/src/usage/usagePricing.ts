import {
  normalizeUsageModel,
  type UsageCategoryCost,
  type UsageCostSource,
  type UsageModelPriceOverride,
  type UsageTokenTotals,
} from "@t3tools/contracts";

import type { UsageRecord, UsageSpeed } from "@t3tools/provider-core/server/usage";

export interface TokenRates {
  readonly inputCostPerToken: number;
  readonly outputCostPerToken: number;
  readonly cacheReadCostPerToken: number;
  readonly cacheCreationCostPerToken: number;
}

/** Omits LiteLLM's above_272k_tokens, flex and batches variants, which transcripts do not record. */
export interface ModelRate extends TokenRates {
  readonly fast: TokenRates | null;
  readonly ultrafast: TokenRates | null;
}

export type RateTable = ReadonlyMap<string, ModelRate>;

function ratePerMillion(
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite = input,
): ModelRate {
  return {
    inputCostPerToken: input / 1_000_000,
    outputCostPerToken: output / 1_000_000,
    cacheReadCostPerToken: cacheRead / 1_000_000,
    cacheCreationCostPerToken: cacheWrite / 1_000_000,
    fast: null,
    ultrafast: null,
  };
}

/**
 * Official OpenAI, Anthropic (5-minute cache write), and Google base-tier API
 * rates verified 2026-10-11; transcripts omit long-context tier modifiers.
 */
export const OFFICIAL_MODEL_RATES: RateTable = new Map([
  ["gpt-6-astra", ratePerMillion(10, 50, 1, 12.5)],
  ["gpt-6.1-sol", ratePerMillion(2, 10, 0.1, 2.5)],
  ["gpt-6-sol", ratePerMillion(2, 10, 0.2, 2.5)],
  ["gpt-6-luna", ratePerMillion(0.1, 0.5, 0.01, 0.125)],
  // Promotional rate available at least through 2026-11-21.
  ["gpt-5.6-sol", ratePerMillion(4, 20, 0.4, 5)],
  ["gpt-5.6-terra", ratePerMillion(2, 12, 0.2, 2.5)],
  ["gpt-5.6-luna", ratePerMillion(0.2, 1.2, 0.02, 0.25)],
  ["claude-opus-5-5", ratePerMillion(4, 20, 0.2, 5)],
  ["claude-sonnet-5-5", ratePerMillion(2, 10, 0.1, 2.5)],
  ["claude-opus-4-6", ratePerMillion(5, 25, 0.5, 6.25)],
  ["claude-opus-4.6", ratePerMillion(5, 25, 0.5, 6.25)],
  // Introductory rates through 2026-12-31. Gemini publishes cache storage
  // separately; cache creation uses the input rate and excludes storage fees.
  ["gemini-3.8-flash", ratePerMillion(0.75, 3.75, 0.075)],
  ["gemini-3.1-pro", ratePerMillion(2, 12, 0.2)],
  ["gemini-3.1-pro-preview", ratePerMillion(2, 12, 0.2)],
  // Introductory rates through 2026-11-30, doubling from 2026-12-01.
  ["gemini-4-argon", ratePerMillion(2, 10, 0.1)],
]);

/**
 * Fallback rates for models known from online documentation that are not
 * present in or aliased identically by LiteLLM.
 * All rates are USD per token.
 */
export const STATIC_FALLBACK_RATES: ReadonlyMap<string, ModelRate> = new Map([
  ["gemini-2.5-pro", ratePerMillion(1.25, 10.0, 0.3125)],
  ["gemini-2.5-flash", ratePerMillion(0.3, 2.5, 0.075)],
  ["glm-5.3-flash", ratePerMillion(0.15, 0.5, 0.03)],
  ["deepseek-v4.1-flash", ratePerMillion(0.15, 0.6, 0.003)],
  ["route-llm", ratePerMillion(0.3, 1.2, 0.06)],
]);

export function createOverrideRateTable(
  overrides: Readonly<Record<string, UsageModelPriceOverride>>,
): RateTable {
  return new Map(
    Object.entries(overrides).map(([model, prices]) => [
      model.trim(),
      {
        inputCostPerToken: prices.inputCostPerMillionTokens / 1_000_000,
        outputCostPerToken: prices.outputCostPerMillionTokens / 1_000_000,
        cacheReadCostPerToken:
          (prices.cacheReadCostPerMillionTokens ?? prices.inputCostPerMillionTokens) / 1_000_000,
        cacheCreationCostPerToken:
          (prices.cacheWriteCostPerMillionTokens ?? prices.inputCostPerMillionTokens) / 1_000_000,
        fast: null,
        ultrafast: null,
      },
    ]),
  );
}

type LiteLlmEntry = Readonly<Record<string, unknown>>;

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Missing cache rates fall back to input pricing; Anthropic normally discounts reads and charges extra for writes.
function readTokenRates(
  entry: LiteLlmEntry,
  suffix: string,
  standard?: TokenRates,
): TokenRates | null {
  const input = finiteNumber(entry[`input_cost_per_token${suffix}`]);
  const output = finiteNumber(entry[`output_cost_per_token${suffix}`]);
  if (input === null || output === null) return null;
  const cacheRate = (name: string, field: "cacheReadCostPerToken" | "cacheCreationCostPerToken") =>
    finiteNumber(entry[`${name}${suffix}`]) ??
    (standard !== undefined && standard.inputCostPerToken > 0
      ? (standard[field] / standard.inputCostPerToken) * input
      : input);
  return {
    inputCostPerToken: input,
    outputCostPerToken: output,
    cacheReadCostPerToken: cacheRate("cache_read_input_token_cost", "cacheReadCostPerToken"),
    cacheCreationCostPerToken: cacheRate(
      "cache_creation_input_token_cost",
      "cacheCreationCostPerToken",
    ),
  };
}

function scaleTokenRates(rates: TokenRates, multiple: number): TokenRates {
  return {
    inputCostPerToken: rates.inputCostPerToken * multiple,
    outputCostPerToken: rates.outputCostPerToken * multiple,
    cacheReadCostPerToken: rates.cacheReadCostPerToken * multiple,
    cacheCreationCostPerToken: rates.cacheCreationCostPerToken * multiple,
  };
}

function fastMultiplier(entry: LiteLlmEntry): number | null {
  const specific = entry["provider_specific_entry"];
  if (typeof specific !== "object" || specific === null) return null;
  const fast = finiteNumber((specific as Record<string, unknown>)["fast"]);
  return fast !== null && fast > 0 ? fast : null;
}

/** Drops models missing input or output rates to avoid understating cost. */
export function parseRateTable(document: unknown): RateTable {
  const table = new Map<string, ModelRate>();
  if (typeof document !== "object" || document === null) return table;

  for (const [name, raw] of Object.entries(document as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as LiteLlmEntry;
    const standard = readTokenRates(entry, "");
    if (standard === null) continue;

    const key = normalizeRateKey(name);
    if (key.length === 0) continue;
    const multiple = fastMultiplier(entry);
    table.set(key, {
      ...standard,
      fast:
        multiple === null
          ? readTokenRates(entry, "_priority", standard)
          : scaleTokenRates(standard, multiple),
      ultrafast: readTokenRates(entry, "_ultrafast", standard),
    });
  }

  const aliasCandidates = new Map<string, ModelRate | null>();
  for (const [key, rate] of table) {
    const alias = bareModelName(key);
    if (alias.length === 0 || alias === key || table.has(alias)) continue;
    const held = aliasCandidates.get(alias);
    if (held === undefined) {
      aliasCandidates.set(alias, rate);
    } else if (held !== null) {
      aliasCandidates.set(alias, mergeAliasRate(held, rate));
    }
  }
  for (const [alias, rate] of aliasCandidates) {
    if (rate !== null) table.set(alias, rate);
  }

  return table;
}

function sameTokenRates(a: TokenRates | null, b: TokenRates | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.inputCostPerToken === b.inputCostPerToken &&
    a.outputCostPerToken === b.outputCostPerToken &&
    a.cacheReadCostPerToken === b.cacheReadCostPerToken &&
    a.cacheCreationCostPerToken === b.cacheCreationCostPerToken
  );
}

// Resellers often omit speed tiers, so a missing tier fills from the other entry instead of conflicting.
function mergeAliasRate(a: ModelRate, b: ModelRate): ModelRate | null {
  const fast = a.fast ?? b.fast;
  const ultrafast = a.ultrafast ?? b.ultrafast;
  if (
    !sameTokenRates(a, b) ||
    !sameTokenRates(fast, b.fast ?? fast) ||
    !sameTokenRates(ultrafast, b.ultrafast ?? ultrafast)
  ) {
    return null;
  }
  return { ...a, fast, ultrafast };
}

function ratesAt(rate: ModelRate, speed: UsageSpeed): TokenRates {
  return (speed === "standard" ? null : rate[speed]) ?? rate;
}

function normalizeRateKey(model: string): string {
  return model.trim().toLowerCase();
}

function bareModelName(key: string): string {
  const slash = key.lastIndexOf("/");
  return slash === -1 ? key : key.slice(slash + 1);
}

// Price Claude's bracketed context variants at the base tier, the only name the rate table knows.
function stripVariantSuffix(key: string): string {
  const bracket = key.indexOf("[");
  return bracket === -1 ? key : key.slice(0, bracket);
}

// Synthetic messages are unbilled; bare family names are generation-ambiguous and remain unpriced.
const UNPRICEABLE_MODELS = new Set([
  "<synthetic>",
  "synthetic",
  "opus",
  "sonnet",
  "haiku",
  "fable",
]);

function candidateRateKeys(key: string): readonly string[] {
  const candidates: string[] = [key];

  const normalized = normalizeUsageModel(key);
  if (normalized !== key) {
    candidates.push(normalized);
  }

  // Strip thinking suffix: claude-opus-4-6-thinking -> claude-opus-4-6, claude-opus-4.6
  if (key.endsWith("-thinking")) {
    const strippedThinking = key.slice(0, -"-thinking".length);
    candidates.push(strippedThinking);
    if (strippedThinking.includes("-")) {
      candidates.push(strippedThinking.replace(/(\d+)-(\d+)/g, "$1.$2"));
    }
  }

  // Provider aliases
  if (key.startsWith("zai-org/")) {
    const sub = key.slice("zai-org/".length);
    candidates.push(`zai/${sub}`, sub);
  }

  if (key.startsWith("deepseek-ai/")) {
    const sub = key.slice("deepseek-ai/".length);
    candidates.push(
      `openrouter/deepseek/${sub}`,
      `together_ai/deepseek-ai/${sub}`,
      `deepseek/${sub}`,
      sub,
    );
  }

  return candidates;
}

/**
 * A scan prices every record twice against a few dozen models, and tables are
 * never mutated once built.
 */

// Immutable tables permit caching rates across twice-per-record pricing lookups.
const resolvedRates = new WeakMap<RateTable, Map<string, ModelRate | null>>();

export function lookupRate(table: RateTable, model: string): ModelRate | null {
  let resolved = resolvedRates.get(table);
  if (resolved === undefined) {
    resolved = new Map();
    resolvedRates.set(table, resolved);
  }
  let rate = resolved.get(model);
  if (rate === undefined) {
    rate = resolveRate(table, model);
    resolved.set(model, rate);
  }
  return rate;
}

/**
 * Official rates carry no speed tiers. Applies LiteLLM's fast/ultrafast
 * multiple for the same model, measured on input rates, to the official rates.
 */
function withTableSpeedTiers(official: ModelRate, fromTable: ModelRate | undefined): ModelRate {
  if (fromTable === undefined || fromTable.inputCostPerToken <= 0) return official;
  const tier = (rates: TokenRates | null) =>
    rates === null
      ? null
      : scaleTokenRates(official, rates.inputCostPerToken / fromTable.inputCostPerToken);
  return { ...official, fast: tier(fromTable.fast), ultrafast: tier(fromTable.ultrafast) };
}

function resolveRate(table: RateTable, model: string): ModelRate | null {
  const key = stripVariantSuffix(normalizeRateKey(model));
  const bareName = bareModelName(key);
  if (bareName.length === 0 || UNPRICEABLE_MODELS.has(bareName)) return null;
  const candidates = candidateRateKeys(key);

  const fromTable = candidates
    .map((candidate) => table.get(candidate))
    .find((rate) => rate !== undefined);

  for (const candidate of candidates) {
    const official = OFFICIAL_MODEL_RATES.get(candidate);
    if (official !== undefined) return withTableSpeedTiers(official, fromTable);
  }

  if (fromTable !== undefined) return fromTable;

  for (const candidate of candidates) {
    const fromFallback = STATIC_FALLBACK_RATES.get(candidate);
    if (fromFallback !== undefined) return fromFallback;
  }

  return null;
}

function findOverride(overrides: RateTable | undefined, model: string): ModelRate | undefined {
  return overrides?.get(model.trim()) ?? overrides?.get(normalizeUsageModel(model));
}

export type PricedRecord = Pick<
  UsageRecord,
  "model" | "rateModel" | "totals" | "speed" | "reportedCostUsd"
>;

export interface PricedUsage {
  readonly costUsd: number;
  readonly costSource: UsageCostSource;
  readonly categoryCostUsd: UsageCategoryCost | null;
  readonly speedPremiumUsd: number;
}

function costByCategory(totals: UsageTokenTotals, rates: TokenRates): UsageCategoryCost {
  return {
    input: totals.uncachedInputTokens * rates.inputCostPerToken,
    cacheRead: totals.cachedInputTokens * rates.cacheReadCostPerToken,
    cacheWrite: totals.cacheCreationTokens * rates.cacheCreationCostPerToken,
    output: totals.outputTokens * rates.outputCostPerToken,
  };
}

function sumCategories(cost: UsageCategoryCost): number {
  return cost.input + cost.cacheRead + cost.cacheWrite + cost.output;
}

/** Reasoning tokens are already included in outputTokens; do not charge twice. */
export function priceUsage(
  table: RateTable,
  record: PricedRecord,
  overrides?: RateTable,
): PricedUsage {
  const { model, totals, reportedCostUsd } = record;
  const override = findOverride(overrides, model);
  const reported =
    override === undefined && reportedCostUsd !== null && Number.isFinite(reportedCostUsd)
      ? reportedCostUsd
      : null;
  const unsplit = (costUsd: number, costSource: UsageCostSource): PricedUsage => ({
    costUsd,
    costSource,
    categoryCostUsd: null,
    speedPremiumUsd: 0,
  });
  const rate = override ?? lookupRate(table, record.rateModel ?? model);
  if (rate === null) {
    return reported === null ? unsplit(0, "unpriced") : unsplit(reported, "providerReported");
  }

  const listCost = costByCategory(totals, ratesAt(rate, record.speed));
  const listCostUsd = sumCategories(listCost);
  if (reported !== null && listCostUsd <= 0) return unsplit(reported, "providerReported");
  const premiumUsd =
    record.speed === "standard" ? 0 : listCostUsd - sumCategories(costByCategory(totals, rate));
  const scale = reported === null ? 1 : reported / listCostUsd;
  return {
    costUsd: reported ?? listCostUsd,
    costSource: reported === null ? "modelPriced" : "providerReported",
    categoryCostUsd: {
      input: listCost.input * scale,
      cacheRead: listCost.cacheRead * scale,
      cacheWrite: listCost.cacheWrite * scale,
      output: listCost.output * scale,
    },
    speedPremiumUsd: premiumUsd * scale,
  };
}

export function cacheSavingsUsd(
  table: RateTable,
  record: PricedRecord,
  overrides?: RateTable,
): number {
  const rate =
    findOverride(overrides, record.model) ?? lookupRate(table, record.rateModel ?? record.model);
  if (rate === null) return 0;
  const rates = ratesAt(rate, record.speed);
  return record.totals.cachedInputTokens * (rates.inputCostPerToken - rates.cacheReadCostPerToken);
}
