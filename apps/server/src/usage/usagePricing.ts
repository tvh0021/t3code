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

/**
 * LiteLLM also publishes `*_above_272k_tokens`, `*_flex`, and `*_batches` variants. Transcripts
 * don't record those, so we don't price them.
 */
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
 * Standard API rates verified 2026-10-11. Use the base context tier and
 * Anthropic's 5-minute cache writes because transcripts omit those modifiers.
 *
 * OpenAI: https://developers.openai.com/api/docs/pricing
 * Older models: https://developers.openai.com/api/docs/models/gpt-6-sol
 * https://developers.openai.com/api/docs/models/gpt-5.6-sol
 * https://developers.openai.com/api/docs/models/gpt-5.6-terra
 * https://developers.openai.com/api/docs/models/gpt-5.6-luna
 * Claude: https://platform.claude.com/docs/en/about-claude/pricing
 * Gemini: https://ai.google.dev/gemini-api/docs/pricing
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
]);

/** Account invoice rates observed 2026-10-17, before allowance and prepaid adjustments. */
export const ZED_MODEL_RATES: RateTable = new Map([
  ["zed.dev/claude-sonnet-5", ratePerMillion(2.2, 11, 0.22, 2.75)],
  ["zed.dev/claude-sonnet-5-5", ratePerMillion(2.2, 11, 0.22, 2.75)],
  ["zed.dev/claude-haiku-5-5", ratePerMillion(0.11, 0.55, 0.011, 0.1375)],
  ["zed.dev/gpt-5.6-luna", ratePerMillion(0.22, 1.32, 0.022, 0.275)],
  ["zed.dev/gpt-6-luna", ratePerMillion(0.11, 0.55, 0.011, 0.1375)],
  // The invoice has no Gemini cache rate; fall back to input pricing, never free tokens.
  ["zed.dev/gemini-4-argon", ratePerMillion(2.2, 11, 2.2)],
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

/**
 * Anthropic bills cache reads at a discount and cache writes at a premium. When the standard
 * tier omits them, cached input is priced as plain input rather than as free.
 */
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

/**
 * Entries without both an input and an output rate are dropped: a half-priced model would
 * silently under-report cost, which is worse than reporting the model as unpriced.
 */
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
    } else if (held !== null && !sameRate(held, rate)) {
      aliasCandidates.set(alias, null);
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

function sameRate(a: ModelRate, b: ModelRate): boolean {
  return (
    sameTokenRates(a, b) &&
    sameTokenRates(a.fast, b.fast) &&
    sameTokenRates(a.ultrafast, b.ultrafast)
  );
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

/**
 * Drops a bracketed variant suffix such as `claude-fable-5-1[1m]`, which
 * Claude Code writes for the 1M context tier. The rate table only knows the
 * base name, and we price at the base tier anyway.
 */
function stripVariantSuffix(key: string): string {
  const bracket = key.indexOf("[");
  return bracket === -1 ? key : key.slice(0, bracket);
}

/**
 * `<synthetic>` marks locally generated messages that were never billed. Bare family names
 * ("opus", "sonnet") are genuinely ambiguous across generations, so we report them as unpriced
 * instead of guessing a generation.
 */
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
  for (const candidate of candidates) {
    const zed = ZED_MODEL_RATES.get(candidate);
    if (zed !== undefined) return zed;
  }

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

/**
 * `reasoningTokens` is intentionally not charged separately: it is already
 * counted inside `outputTokens`.
 */
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
