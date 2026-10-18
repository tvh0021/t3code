import * as Schema from "effect/Schema";

import { ForwardCompatibleArray, NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Bumped whenever the shape of {@link UsageSummary} changes incompatibly.
 * Adding providers or other array-element variants is additive: unknown entries
 * are skipped on decode and do not require a version bump.
 */
export const USAGE_CONTRACT_VERSION = 6 as const;

export const USAGE_MERGE_COMPATIBLE_SINCE = 4 as const;

export const UsageProviderKind = Schema.Literals([
  "claude",
  "codex",
  "grok",
  "cursor",
  "opencode",
  "antigravity",
  "pi",
  "abacus",
]);
export type UsageProviderKind = typeof UsageProviderKind.Type;

export const ABACUS_CREDIT_COST_USD = 0.0005;

export function abacusCreditsToUsd(credits: number): number {
  return credits * ABACUS_CREDIT_COST_USD;
}

export function usdToAbacusCredits(usd: number): number {
  return usd / ABACUS_CREDIT_COST_USD;
}

export const CODEX_CREDIT_COST_USD = 0.04;

export function codexCreditsToUsd(credits: number): number {
  return credits * CODEX_CREDIT_COST_USD;
}

export function usdToCodexCredits(usd: number): number {
  return usd / CODEX_CREDIT_COST_USD;
}

/**
 * Normalizes model names for usage accounting.
 *
 * Effort and thinking variants share one model row. Provider prefixes and
 * other model variants remain distinct.
 */
export function normalizeUsageModel(model: string): string {
  // Codex Max is a model, unlike a trailing reasoning-effort setting.
  if (/(?:^|\/)gpt-\d+(?:\.\d+)?-codex-max(?:\[[^\]]*\])?$/i.test(model.trim())) {
    return model.trim();
  }
  const trimmed = model
    .trim()
    .replace(
      /((?:^|\/)(?:gpt-\d[^/[\]]*|claude-(?:opus|sonnet|haiku|fable)-\d[^/[\]]*|gemini-[^/[\]]*))-(none|minimal|low|medium|high|xhigh|max|ultra|ultrathink|thinking|tiered)(?=\[|$)/i,
      "$1",
    );
  // Antigravity's ACP model list labels this ID "Gemini 3.1 Pro (High)", and
  // its generation metadata names the same calls `gemini-pro-default`.
  if (/^gemini-pro-(agent|default)$/i.test(trimmed)) {
    return "gemini-3.1-pro";
  }
  if (/^claude-opus-4-6(-thinking)?$/i.test(trimmed)) {
    return "claude-opus-4.6";
  }
  if (/^(deepseek-ai\/)?deepseek-v4\.1-flash$/i.test(trimmed)) {
    return "deepseek-v4.1-flash";
  }
  if (/^(zai-org\/|zai\/)?glm-5\.3-flash$/i.test(trimmed)) {
    return "glm-5.3-flash";
  }
  return trimmed;
}

const USAGE_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const UsageDay = TrimmedNonEmptyString.check(Schema.isPattern(USAGE_DAY_PATTERN)).pipe(
  Schema.brand("UsageDay"),
);
export type UsageDay = typeof UsageDay.Type;

export const UsageResolution = Schema.Literals(["day", "hour"]);
export type UsageResolution = typeof UsageResolution.Type;

export const UsageCostSource = Schema.Literals(["providerReported", "modelPriced", "unpriced"]);
export type UsageCostSource = typeof UsageCostSource.Type;

/**
 * `cachedInputTokens` and `cacheCreationTokens` are disjoint from
 * `uncachedInputTokens`; summing all three gives total input. `reasoningTokens`
 * is a *subset* of `outputTokens` (Codex reports it that way, and Anthropic
 * folds thinking into output), so it must never be added on top.
 */
export const UsageTokenTotals = Schema.Struct({
  uncachedInputTokens: NonNegativeInt,
  cachedInputTokens: NonNegativeInt,
  cacheCreationTokens: NonNegativeInt,
  outputTokens: NonNegativeInt,
  reasoningTokens: NonNegativeInt,
});
export type UsageTokenTotals = typeof UsageTokenTotals.Type;

export const UsageCategoryCost = Schema.Struct({
  input: Schema.Number,
  cacheRead: Schema.Number,
  cacheWrite: Schema.Number,
  output: Schema.Number,
});
export type UsageCategoryCost = typeof UsageCategoryCost.Type;

export const UsageBucket = Schema.Struct({
  day: UsageDay,
  hourStart: Schema.optional(TrimmedNonEmptyString),
  provider: UsageProviderKind,
  model: TrimmedNonEmptyString,
  sourcePath: Schema.optional(TrimmedNonEmptyString),
  totals: UsageTokenTotals,
  costUsd: Schema.Number,
  cacheSavingsUsd: Schema.Number,
  categoryCostUsd: Schema.optional(UsageCategoryCost),
  fastCostUsd: Schema.optional(Schema.Number),
  ultrafastCostUsd: Schema.optional(Schema.Number),
  speedPremiumUsd: Schema.optional(Schema.Number),
  costSource: UsageCostSource,
  records: NonNegativeInt,
  unpricedRecords: NonNegativeInt,
  sessions: NonNegativeInt,
  /** Credit consumption for credit-based providers. */
  credits: Schema.optional(Schema.Number),
});
export type UsageBucket = typeof UsageBucket.Type;

export const UsageSourceFingerprint = Schema.Struct({
  hostId: TrimmedNonEmptyString,
  provider: UsageProviderKind,
  resolvedHomePath: TrimmedNonEmptyString,
  /**
   * Filesystem identity of the transcript directory, as `device:inode`.
   * Hostname and path alone are not enough: every Mac in a fleet resolves
   * `/Users/<user>/.claude`, so two machines that happen to share a hostname
   * would look like one source and have their usage silently dropped.
   */
  volumeId: Schema.String,
});
export type UsageSourceFingerprint = typeof UsageSourceFingerprint.Type;

export const UsageSourceStatus = Schema.Literals(["ok", "missing", "partial", "failed"]);
export type UsageSourceStatus = typeof UsageSourceStatus.Type;

export const UsageSource = Schema.Struct({
  fingerprint: UsageSourceFingerprint,
  status: UsageSourceStatus,
  scannedFiles: NonNegativeInt,
  skippedFiles: NonNegativeInt,
  malformedRecords: NonNegativeInt,
  /**
   * Buckets also carry per-bucket session counts, but a session spans days and
   * models, so summing those overcounts; this is the figure clients should
   * total.
   */
  distinctSessions: NonNegativeInt,
  message: Schema.NullOr(TrimmedNonEmptyString),
  action: Schema.optionalKey(Schema.Literal("enableCursorKeychain")),
  /**
   * Present when this source answered from its cache while a slow refresh (an
   * account API, for example) runs. Repeat the request with `awaitRefresh` to
   * get the refreshed source.
   */
  refreshing: Schema.optionalKey(Schema.Literal(true)),
});
export type UsageSource = typeof UsageSource.Type;

export const UsagePricingStatus = Schema.Literals(["fresh", "cached", "unavailable"]);
export type UsagePricingStatus = typeof UsagePricingStatus.Type;

export const UsagePricing = Schema.Struct({
  status: UsagePricingStatus,
  source: TrimmedNonEmptyString,
  fetchedAt: Schema.NullOr(Schema.String),
  knownModels: NonNegativeInt,
});
export type UsagePricing = typeof UsagePricing.Type;

export const UsageSummaryInput = Schema.Struct({
  sinceDay: UsageDay,
  untilDay: UsageDay,
  /**
   * IANA zone the client wants days bucketed in. An offset would be wrong for
   * any window that crosses a DST boundary.
   */
  timeZone: TrimmedNonEmptyString,
  resolution: Schema.optional(UsageResolution),
  sinceTime: Schema.optional(TrimmedNonEmptyString),
  untilTime: Schema.optional(TrimmedNonEmptyString),
  awaitRefresh: Schema.optional(Schema.Boolean),
});
export type UsageSummaryInput = typeof UsageSummaryInput.Type;

export const UsageSummary = Schema.Struct({
  contractVersion: Schema.Number,
  readAt: Schema.String,
  timeZone: TrimmedNonEmptyString,
  sinceDay: UsageDay,
  untilDay: UsageDay,
  buckets: ForwardCompatibleArray(UsageBucket),
  sources: ForwardCompatibleArray(UsageSource),
  pricing: UsagePricing,
  scanDurationMs: NonNegativeInt,
});
export type UsageSummary = typeof UsageSummary.Type;

export class UsageReadError extends Schema.TaggedError<UsageReadError>()("UsageReadError", {
  reason: Schema.Literals(["scanFailed", "invalidWindow"]),
  detail: TrimmedNonEmptyString,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Usage read failed (${this.reason}): ${this.detail}`;
  }
}
