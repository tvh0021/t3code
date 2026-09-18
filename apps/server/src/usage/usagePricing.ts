/**
 * Model rate lookup and cost arithmetic.
 *
 * Rates come from LiteLLM's `model_prices_and_context_window.json`, the same
 * table `ccusage` prices against. Everything here is pure: fetching and caching
 * the table lives in `UsageService`.
 *
 * @module usagePricing
 */
import {
  normalizeUsageModel,
  type UsageCostSource,
  type UsageModelPriceOverride,
  type UsageTokenTotals,
} from "@t3tools/contracts";

/**
 * The subset of a LiteLLM entry we price against. All values are USD per token.
 *
 * LiteLLM also publishes tiered variants (`*_above_272k_tokens`, `*_flex`,
 * `*_priority`, `*_batches`). We deliberately price at the base tier: the
 * transcripts don't record which tier served a request, so anything else would
 * be a guess dressed up as precision.
 */
export interface ModelRate {
  readonly inputCostPerToken: number;
  readonly outputCostPerToken: number;
  readonly cacheReadCostPerToken: number;
  readonly cacheCreationCostPerToken: number;
}

export type RateTable = ReadonlyMap<string, ModelRate>;

/**
 * Fallback rates for models known from online documentation that are not
 * present in or aliased identically by LiteLLM.
 * All rates are USD per token.
 */
export const STATIC_FALLBACK_RATES: ReadonlyMap<string, ModelRate> = new Map([
  [
    "gemini-3.8-flash",
    {
      inputCostPerToken: 0.75 / 1_000_000,
      outputCostPerToken: 3.75 / 1_000_000,
      cacheReadCostPerToken: 0.075 / 1_000_000,
      cacheCreationCostPerToken: 0.75 / 1_000_000,
    },
  ],
  [
    "gemini-2.5-pro",
    {
      inputCostPerToken: 1.25 / 1_000_000,
      outputCostPerToken: 10.0 / 1_000_000,
      cacheReadCostPerToken: 0.3125 / 1_000_000,
      cacheCreationCostPerToken: 1.25 / 1_000_000,
    },
  ],
  [
    "gemini-2.5-flash",
    {
      inputCostPerToken: 0.3 / 1_000_000,
      outputCostPerToken: 2.5 / 1_000_000,
      cacheReadCostPerToken: 0.075 / 1_000_000,
      cacheCreationCostPerToken: 0.3 / 1_000_000,
    },
  ],
  [
    "glm-5.3-flash",
    {
      inputCostPerToken: 0.15 / 1_000_000,
      outputCostPerToken: 0.5 / 1_000_000,
      cacheReadCostPerToken: 0.03 / 1_000_000,
      cacheCreationCostPerToken: 0.15 / 1_000_000,
    },
  ],
  [
    "deepseek-v4.1-flash",
    {
      inputCostPerToken: 0.15 / 1_000_000,
      outputCostPerToken: 0.6 / 1_000_000,
      cacheReadCostPerToken: 0.003 / 1_000_000,
      cacheCreationCostPerToken: 0.15 / 1_000_000,
    },
  ],
  [
    "route-llm",
    {
      inputCostPerToken: 0.3 / 1_000_000,
      outputCostPerToken: 1.2 / 1_000_000,
      cacheReadCostPerToken: 0.06 / 1_000_000,
      cacheCreationCostPerToken: 0.3 / 1_000_000,
    },
  ],
  [
    "claude-opus-4-6",
    {
      inputCostPerToken: 5.0 / 1_000_000,
      outputCostPerToken: 25.0 / 1_000_000,
      cacheReadCostPerToken: 0.5 / 1_000_000,
      cacheCreationCostPerToken: 6.25 / 1_000_000,
    },
  ],
  [
    "claude-opus-4.6",
    {
      inputCostPerToken: 5.0 / 1_000_000,
      outputCostPerToken: 25.0 / 1_000_000,
      cacheReadCostPerToken: 0.5 / 1_000_000,
      cacheCreationCostPerToken: 6.25 / 1_000_000,
    },
  ],
  [
    "codex-auto-review",
    {
      inputCostPerToken: 1.0 / 1_000_000,
      outputCostPerToken: 4.0 / 1_000_000,
      cacheReadCostPerToken: 0.25 / 1_000_000,
      cacheCreationCostPerToken: 1.0 / 1_000_000,
    },
  ],
]);

/** Custom IDs keep their case, provider prefix, and variant suffix. */
export function createOverrideRateTable(
  overrides: Readonly<Record<string, UsageModelPriceOverride>>,
): RateTable {
  const table = new Map<string, ModelRate>();
  for (const [model, prices] of Object.entries(overrides)) {
    const rate: ModelRate = {
      inputCostPerToken: prices.inputCostPerMillionTokens / 1_000_000,
      outputCostPerToken: prices.outputCostPerMillionTokens / 1_000_000,
      cacheReadCostPerToken:
        (prices.cacheReadCostPerMillionTokens ?? prices.inputCostPerMillionTokens) / 1_000_000,
      cacheCreationCostPerToken:
        (prices.cacheWriteCostPerMillionTokens ?? prices.inputCostPerMillionTokens) / 1_000_000,
    };
    table.set(model.trim(), rate);
    const normalized = normalizeUsageModel(model.trim());
    if (!table.has(normalized)) {
      table.set(normalized, rate);
    }
  }
  return table;
}

/** Raw shape of one LiteLLM entry, narrowed to the fields we read. */
interface LiteLlmEntry {
  readonly input_cost_per_token?: unknown;
  readonly output_cost_per_token?: unknown;
  readonly cache_read_input_token_cost?: unknown;
  readonly cache_creation_input_token_cost?: unknown;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Projects the LiteLLM document into a rate table.
 *
 * Entries without both an input and an output rate are dropped: a half-priced
 * model would silently under-report cost, which is worse than reporting the
 * model as unpriced.
 *
 * Entries keep their full normalized key; a bare name is aliased only when no
 * canonical entry exists and every qualified entry has the same rate.
 */
export function parseRateTable(document: unknown): RateTable {
  const table = new Map<string, ModelRate>();
  if (typeof document !== "object" || document === null) return table;

  for (const [name, raw] of Object.entries(document as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as LiteLlmEntry;
    const input = finiteNumber(entry.input_cost_per_token);
    const output = finiteNumber(entry.output_cost_per_token);
    if (input === null || output === null) continue;

    const key = normalizeRateKey(name);
    if (key.length === 0) continue;
    table.set(key, {
      inputCostPerToken: input,
      outputCostPerToken: output,
      // Anthropic bills cache reads at a discount and cache writes at a
      // premium. When a model omits them, cached input is priced as plain
      // input rather than as free.
      cacheReadCostPerToken: finiteNumber(entry.cache_read_input_token_cost) ?? input,
      cacheCreationCostPerToken: finiteNumber(entry.cache_creation_input_token_cost) ?? input,
    });
  }

  // `null` marks a bare name claimed at conflicting rates: no alias for it.
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

function sameRate(a: ModelRate, b: ModelRate): boolean {
  return (
    a.inputCostPerToken === b.inputCostPerToken &&
    a.outputCostPerToken === b.outputCostPerToken &&
    a.cacheReadCostPerToken === b.cacheReadCostPerToken &&
    a.cacheCreationCostPerToken === b.cacheCreationCostPerToken
  );
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
 * Models we never price, regardless of the table.
 *
 * `<synthetic>` marks locally generated messages that were never billed. Bare
 * family names ("opus", "sonnet") are genuinely ambiguous across generations,
 * so we report them as unpriced instead of guessing a generation.
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

  // Strip reasoning effort or tier suffix: gemini-3.8-flash-(high|medium|low|tiered) -> gemini-3.8-flash
  const strippedGemini = normalizeUsageModel(key);
  if (strippedGemini !== key) {
    candidates.push(strippedGemini);
  }

  // Strip thinking suffix: claude-opus-4-6-thinking -> claude-opus-4-6, claude-opus-4.6
  if (key.endsWith("-thinking")) {
    const strippedThinking = key.slice(0, -"-thinking".length);
    candidates.push(strippedThinking);
    if (strippedThinking.includes("-")) {
      candidates.push(strippedThinking.replace(/(\d+)-(\d+)/g, "$1.$2"));
    }
  }

  // Gemini aliases
  if (key === "gemini-pro-agent") {
    candidates.push("gemini-2.5-pro", "gemini-pro");
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

export function lookupRate(table: RateTable, model: string): ModelRate | null {
  const key = stripVariantSuffix(normalizeRateKey(model));
  const bareName = bareModelName(key);
  if (bareName.length === 0 || UNPRICEABLE_MODELS.has(bareName)) return null;

  for (const candidate of candidateRateKeys(key)) {
    const fromTable = table.get(candidate);
    if (fromTable !== undefined) return fromTable;
  }

  for (const candidate of candidateRateKeys(key)) {
    const fromFallback = STATIC_FALLBACK_RATES.get(candidate);
    if (fromFallback !== undefined) return fromFallback;
  }

  return null;
}

export interface PricedUsage {
  readonly costUsd: number;
  readonly costSource: UsageCostSource;
}

/**
 * Prices a bucket's tokens.
 *
 * `reasoningTokens` is intentionally not charged separately: it is already
 * counted inside `outputTokens`.
 */
export function priceUsage(
  table: RateTable,
  model: string,
  totals: UsageTokenTotals,
  reportedCostUsd: number | null,
  overrides?: RateTable,
): PricedUsage {
  const override = overrides?.get(model.trim());
  if (override === undefined && reportedCostUsd !== null && Number.isFinite(reportedCostUsd)) {
    return { costUsd: reportedCostUsd, costSource: "providerReported" };
  }

  const rate = override ?? lookupRate(table, model);
  if (rate === null) return { costUsd: 0, costSource: "unpriced" };

  const costUsd =
    totals.uncachedInputTokens * rate.inputCostPerToken +
    totals.cachedInputTokens * rate.cacheReadCostPerToken +
    totals.cacheCreationTokens * rate.cacheCreationCostPerToken +
    totals.outputTokens * rate.outputCostPerToken;

  return { costUsd, costSource: "modelPriced" };
}

/**
 * What the cached input would have cost at full input rates, minus what it
 * actually cost. Drives the "cache savings" figure.
 */
export function cacheSavingsUsd(
  table: RateTable,
  model: string,
  totals: UsageTokenTotals,
  overrides?: RateTable,
): number {
  const rate = overrides?.get(model.trim()) ?? lookupRate(table, model);
  if (rate === null) return 0;
  return totals.cachedInputTokens * (rate.inputCostPerToken - rate.cacheReadCostPerToken);
}
