/**
 * Pure parsers for the provider CLIs' on-disk session transcripts.
 *
 * Each parser is a line-at-a-time reducer so callers can stream large files
 * without materialising them. None of them touch the filesystem.
 *
 * @module usageTranscripts
 */
import {
  ABACUS_CREDIT_COST_USD,
  codexCreditsToUsd,
  type UsageProviderKind,
  type UsageTokenTotals,
} from "@t3tools/contracts";

export interface UsageRecord {
  readonly provider: UsageProviderKind;
  readonly timestampMs: number;
  readonly model: string;
  readonly sessionId: string;
  readonly totals: UsageTokenTotals;
  readonly reportedCostUsd: number | null;
  readonly credits?: number | null;
  readonly creditBalance?: number | null;
  /**
   * Key for cross-file de-duplication, or `null` when the record is inherently
   * unique and needs no dedup.
   */
  readonly dedupeKey: string | null;
}

const EMPTY_TOTALS: UsageTokenTotals = {
  uncachedInputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};

function int(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function parseTimestampMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function addTotals(a: UsageTokenTotals, b: UsageTokenTotals): UsageTokenTotals {
  return {
    uncachedInputTokens: a.uncachedInputTokens + b.uncachedInputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
  };
}

export function totalTokens(totals: UsageTokenTotals): number {
  // reasoningTokens is a subset of outputTokens and must not be added again.
  return (
    totals.uncachedInputTokens +
    totals.cachedInputTokens +
    totals.cacheCreationTokens +
    totals.outputTokens
  );
}

/** Cheap substring gate applied before `JSON.parse`. */
export function mightCarryUsage(line: string, provider: UsageProviderKind): boolean {
  if (provider === "claude") return line.includes('"usage"');
  if (provider === "grok") return line.includes('"turn_completed"');
  return line.includes('"token_count"');
}

export const GROK_COST_USD_TICKS_PER_DOLLAR = 10_000_000_000;

function grokCostTicksToUsd(ticks: unknown): number | null {
  if (typeof ticks !== "number" || !Number.isFinite(ticks) || ticks < 0) return null;
  return ticks / GROK_COST_USD_TICKS_PER_DOLLAR;
}

/* -------------------------------------------------------------------------- */
/* Claude Code                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Parses one line of a Claude Code transcript, returning a usage record if the
 * line was an assistant message carrying token usage.
 */
export function parseClaudeLine(line: string): UsageRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const record = parsed as Record<string, unknown>;
  if (record["type"] !== "assistant") return null;

  const message = record["message"];
  if (typeof message !== "object" || message === null) return null;
  const messageRecord = message as Record<string, unknown>;

  const usage = messageRecord["usage"];
  if (typeof usage !== "object" || usage === null) return null;
  const usageRecord = usage as Record<string, unknown>;

  const timestampMs = parseTimestampMs(record["timestamp"]);
  if (timestampMs === null) return null;

  const model = typeof messageRecord["model"] === "string" ? messageRecord["model"] : "";
  if (model.length === 0) return null;

  const messageId = typeof messageRecord["id"] === "string" ? messageRecord["id"] : null;
  const requestId = typeof record["requestId"] === "string" ? record["requestId"] : null;
  const dedupeKey =
    messageId === null && requestId === null ? null : `${messageId ?? ""}:${requestId ?? ""}`;

  const cost = record["costUSD"];

  return {
    provider: "claude",
    timestampMs,
    model,
    sessionId: typeof record["sessionId"] === "string" ? record["sessionId"] : "",
    totals: {
      uncachedInputTokens: int(usageRecord["input_tokens"]),
      cachedInputTokens: int(usageRecord["cache_read_input_tokens"]),
      cacheCreationTokens: int(usageRecord["cache_creation_input_tokens"]),
      outputTokens: int(usageRecord["output_tokens"]),
      reasoningTokens: 0,
    },
    reportedCostUsd: typeof cost === "number" && Number.isFinite(cost) ? cost : null,
    dedupeKey,
  };
}

/* -------------------------------------------------------------------------- */
/* Antigravity                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Parses one line of an Antigravity transcript, returning a usage record if the
 * line was a turn usage event.
 */
export function parseAntigravityLine(line: string): UsageRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const record = parsed as Record<string, unknown>;
  if (record["provider"] !== "antigravity") return null;

  const timestampMs = parseTimestampMs(record["timestamp"]);
  if (timestampMs === null) return null;

  const model = typeof record["model"] === "string" ? record["model"] : "";
  if (model.length === 0) return null;

  const rawSessionId = record["sessionId"];
  const sessionId = typeof rawSessionId === "string" ? rawSessionId : "";

  const totals: UsageTokenTotals = {
    uncachedInputTokens: int(record["inputTokens"]),
    cachedInputTokens: int(record["cachedInputTokens"]),
    cacheCreationTokens: int(record["cacheCreationTokens"]),
    outputTokens: int(record["outputTokens"]),
    reasoningTokens: int(record["reasoningTokens"]),
  };

  const rawCredits = record["credits"];
  const credits =
    typeof rawCredits === "number" && Number.isFinite(rawCredits) && rawCredits >= 0
      ? rawCredits
      : null;

  if (totalTokens(totals) === 0 && (credits === null || credits === 0)) return null;

  const rawReportedCost = record["reportedCostUsd"];
  const reportedCostUsd =
    typeof rawReportedCost === "number" && Number.isFinite(rawReportedCost) && rawReportedCost >= 0
      ? rawReportedCost
      : null;

  return {
    provider: "antigravity",
    timestampMs,
    model,
    sessionId,
    totals,
    reportedCostUsd,
    credits,
    dedupeKey: null,
  };
}

/* -------------------------------------------------------------------------- */
/* Codex                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Mutable state threaded across consecutive lines of one Codex rollout file.
 *
 * Codex `token_count` events carry no model, so the model is carried forward
 * from the most recent `turn_context`. Sessions that switch models mid-run
 * attribute correctly from the switch onward.
 */
export interface CodexScanState {
  model: string;
  sessionId: string;
  lastUsageSignature: string | null;
  sawSessionMeta: boolean;
  /** While true, leading usage events are re-stamped copies of parent history. */
  suppressingForkCopies: boolean;
  forkCopyAnchorMs: number;
  lastCreditBalance: number | null;
}

export function initialCodexScanState(): CodexScanState {
  return {
    model: "",
    sessionId: "",
    lastUsageSignature: null,
    sawSessionMeta: false,
    suppressingForkCopies: false,
    forkCopyAnchorMs: 0,
    lastCreditBalance: null,
  };
}

/**
 * A forked or subagent rollout opens with the parent's full history copied in,
 * every line re-stamped to the fork instant. Those copies are written in one
 * synchronous burst (observed gaps 0-40ms), while the child's first genuine
 * usage event only lands after a real model turn (observed 5s+). One second of
 * separation splits the two cleanly; `ccusage` uses the same threshold.
 */
const FORK_COPY_MAX_GAP_MS = 1000;

/** Whether a `session_meta` payload marks the rollout as a fork or subagent. */
function isForkedSessionMeta(payload: Record<string, unknown>): boolean {
  if (typeof payload["forked_from_id"] === "string") return true;
  const source = payload["source"];
  if (typeof source !== "object" || source === null) return false;
  const subagent = (source as Record<string, unknown>)["subagent"];
  if (typeof subagent !== "object" || subagent === null) return false;
  const spawn = (subagent as Record<string, unknown>)["thread_spawn"];
  if (typeof spawn !== "object" || spawn === null) return false;
  return typeof (spawn as Record<string, unknown>)["parent_thread_id"] === "string";
}

/**
 * Feeds one line of a Codex rollout into `state`, returning a record when the
 * line was a usage event.
 *
 * Deltas come from `last_token_usage`. Summing those across a session
 * reconciles with the session's final `total_token_usage`, provided
 * consecutive duplicate events are dropped, which this does.
 */
export function parseCodexLine(
  line: string,
  state: CodexScanState,
  provider: UsageProviderKind = "codex",
): UsageRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const record = parsed as Record<string, unknown>;
  const payload = record["payload"];
  if (typeof payload !== "object" || payload === null) return null;
  const payloadRecord = payload as Record<string, unknown>;
  const payloadType = payloadRecord["type"];

  if (record["type"] === "session_meta") {
    // Only the first meta describes this file's own session. A forked rollout
    // repeats the ancestors' metas right after it; letting those through would
    // reassign every subsequent record to an ancestor session.
    if (state.sawSessionMeta) return null;
    state.sawSessionMeta = true;
    const id = payloadRecord["id"] ?? payloadRecord["session_id"];
    if (typeof id === "string") state.sessionId = id;
    const metaTimestampMs = parseTimestampMs(record["timestamp"]);
    if (metaTimestampMs !== null && isForkedSessionMeta(payloadRecord)) {
      state.suppressingForkCopies = true;
      state.forkCopyAnchorMs = metaTimestampMs;
    }
    return null;
  }

  if (record["type"] === "turn_context") {
    if (typeof payloadRecord["model"] === "string") state.model = payloadRecord["model"];
    state.lastUsageSignature = null;
    return null;
  }

  if (payloadType !== "token_count") return null;

  const info = payloadRecord["info"];
  if (typeof info !== "object" || info === null) return null;
  // Older Antigravity JSONL may contain prompt-length estimates. Only the
  // explicit ACP measurements are safe to include when no database is present.
  if (provider === "antigravity" && (info as Record<string, unknown>)["usage_source"] !== "acp") {
    return null;
  }
  const last = (info as Record<string, unknown>)["last_token_usage"];
  if (typeof last !== "object" || last === null) return null;
  const lastRecord = last as Record<string, unknown>;

  // Only an event that is otherwise eligible may consume the duplicate
  // signature. A token_count arriving before its turn_context (no model yet)
  // must not poison it, or the re-emitted copy after the model is known would
  // be skipped as a duplicate and those tokens never counted.
  const timestampMs = parseTimestampMs(record["timestamp"]);
  if (timestampMs === null) return null;
  if (state.model.length === 0) return null;

  // Codex re-emits an unchanged token_count on some stream boundaries. Summing
  // those would double count, so identical consecutive payloads are skipped.
  const signature = JSON.stringify(lastRecord);
  if (signature === state.lastUsageSignature) {
    // A repeated token payload can carry a newer account-wide balance. It is
    // still not a second usage record, but dropping its snapshot would make
    // the next real turn absorb an earlier concurrent spend.
    const rawRateLimits = payloadRecord["rate_limits"];
    if (typeof rawRateLimits === "object" && rawRateLimits !== null) {
      const credits = (rawRateLimits as Record<string, unknown>)["credits"];
      if (typeof credits === "object" && credits !== null) {
        const balance = Number((credits as Record<string, unknown>)["balance"]);
        if (Number.isFinite(balance) && balance > 0) state.lastCreditBalance = balance;
      }
    }
    return null;
  }
  state.lastUsageSignature = signature;

  // In a forked rollout the copied parent history was already counted from the
  // parent's own file. Drop the leading burst; the first usage event separated
  // from its predecessor by a real turn's worth of time ends it for good.
  if (state.suppressingForkCopies) {
    if (timestampMs - state.forkCopyAnchorMs < FORK_COPY_MAX_GAP_MS) {
      state.forkCopyAnchorMs = timestampMs;
      return null;
    }
    state.suppressingForkCopies = false;
  }

  const inputTokens = int(lastRecord["input_tokens"]);
  const cachedInputTokens = int(lastRecord["cached_input_tokens"]);
  const cacheCreationTokens = int(lastRecord["cache_write_input_tokens"]);
  const outputTokens = int(lastRecord["output_tokens"]);

  const totals: UsageTokenTotals = {
    // Codex reports `input_tokens` inclusive of the cached portion.
    uncachedInputTokens: Math.max(0, inputTokens - cachedInputTokens - cacheCreationTokens),
    cachedInputTokens,
    cacheCreationTokens,
    outputTokens,
    // Reported inside output_tokens, surfaced separately for the token mix.
    reasoningTokens: Math.min(outputTokens, int(lastRecord["reasoning_output_tokens"])),
  };

  const rawRateLimits = payloadRecord["rate_limits"];
  const previousCreditBalance = state.lastCreditBalance;
  let creditBalance: number | null = null;
  if (typeof rawRateLimits === "object" && rawRateLimits !== null) {
    const rateLimits = rawRateLimits as Record<string, unknown>;
    const credsObj = rateLimits["credits"];
    if (typeof credsObj === "object" && credsObj !== null) {
      const balStr = (credsObj as Record<string, unknown>)["balance"];
      if (typeof balStr === "string") {
        const bal = parseFloat(balStr);
        if (Number.isFinite(bal) && bal > 0) {
          creditBalance = bal;
          state.lastCreditBalance = bal;
        }
      }
    }
  }

  const rawCredits = lastRecord["credits"];
  let credits =
    typeof rawCredits === "number" && Number.isFinite(rawCredits) && rawCredits >= 0
      ? rawCredits
      : null;

  if (totalTokens(totals) === 0 && (credits === null || credits === 0)) return null;

  let reportedCostUsd: number | null = null;
  if (
    provider === "codex" &&
    creditBalance !== null &&
    previousCreditBalance !== null &&
    creditBalance < previousCreditBalance
  ) {
    credits = Math.round((previousCreditBalance - creditBalance) * 1_000_000) / 1_000_000;
    reportedCostUsd = codexCreditsToUsd(credits);
  } else if (provider === "abacus" && credits !== null) {
    reportedCostUsd = credits * ABACUS_CREDIT_COST_USD;
  }
  if (provider === "codex" && state.model === "codex-auto-review") {
    credits = 0;
    reportedCostUsd = 0;
  }

  return {
    provider,
    timestampMs,
    model: state.model,
    sessionId: state.sessionId,
    totals,
    reportedCostUsd,
    credits,
    creditBalance,
    // Events surviving the fork-copy suppression above are unique to this
    // rollout, so they need no global dedup.
    dedupeKey: null,
  };
}

/**
 * Reconciles Codex account-level credit balances across the chronological
 * timeline of all rollout files.
 *
 * `rate_limits.credits.balance` in Codex rollouts is a snapshot of the user's
 * global OpenAI account balance. When subagents or parallel sessions run
 * concurrently, computing balance drops per-file multiplies credit usage by
 * the number of concurrent threads.
 *
 * Chronological reconciliation tracks the monotonic decline of the global
 * account balance, cleanly attributing credit drops to the turn that actually
 * consumed them without double counting across subagents.
 */
export function reconcileCodexCreditUsage(
  files: ReadonlyArray<{ readonly path: string; readonly records: readonly UsageRecord[] }>,
): ReadonlyArray<{ readonly path: string; readonly records: readonly UsageRecord[] }> {
  type RecordEntry = {
    readonly record: UsageRecord;
    readonly fileIdx: number;
    readonly recordIdx: number;
  };

  const entries: RecordEntry[] = [];
  for (let fIdx = 0; fIdx < files.length; fIdx++) {
    const file = files[fIdx]!;
    for (let rIdx = 0; rIdx < file.records.length; rIdx++) {
      const rec = file.records[rIdx]!;
      if (rec.provider === "codex" && typeof rec.creditBalance === "number") {
        entries.push({ record: rec, fileIdx: fIdx, recordIdx: rIdx });
      }
    }
  }

  entries.sort((a, b) => a.record.timestampMs - b.record.timestampMs);

  let runningMinBalance: number | null = null;
  const updates = new Map<string, { credits: number; reportedCostUsd: number | null }>();

  for (const entry of entries) {
    const bal = entry.record.creditBalance;
    if (typeof bal !== "number" || bal <= 0) continue;

    const key = `${entry.fileIdx}:${entry.recordIdx}`;
    if (runningMinBalance === null) {
      runningMinBalance = bal;
      updates.set(key, {
        credits: 0,
        reportedCostUsd: entry.record.model === "codex-auto-review" ? 0 : null,
      });
      continue;
    }

    if (entry.record.model === "codex-auto-review") {
      updates.set(key, { credits: 0, reportedCostUsd: 0 });
      if (bal > runningMinBalance + 100) runningMinBalance = bal;
      // Keep the previous baseline on a drop so a concurrent paid turn is
      // counted once on the next paid record.
      continue;
    }

    if (bal < runningMinBalance) {
      const diff = runningMinBalance - bal;

      runningMinBalance = bal;
      if (diff > 0.000001) {
        const credits = Math.round(diff * 1_000_000) / 1_000_000;
        updates.set(key, {
          credits,
          reportedCostUsd: codexCreditsToUsd(credits),
        });
      } else {
        updates.set(key, { credits: 0, reportedCostUsd: null });
      }
    } else if (bal > runningMinBalance + 100) {
      // Balance refill / top-up
      runningMinBalance = bal;
      updates.set(key, { credits: 0, reportedCostUsd: null });
    } else {
      updates.set(key, { credits: 0, reportedCostUsd: null });
    }
  }

  return files.map((file, fIdx) => ({
    path: file.path,
    records: file.records.map((rec, rIdx) => {
      const update = updates.get(`${fIdx}:${rIdx}`);
      if (update !== undefined) {
        return {
          ...rec,
          credits: update.credits,
          reportedCostUsd: update.reportedCostUsd,
        };
      }
      return rec;
    }),
  }));
}

export function reconcileCodexRecords(records: readonly UsageRecord[]): readonly UsageRecord[] {
  const result = reconcileCodexCreditUsage([{ path: "memory", records }]);
  return result[0]?.records ?? [];
}

/* -------------------------------------------------------------------------- */
/* Grok Build                                                                 */
/* -------------------------------------------------------------------------- */

interface GrokUsageTotals {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedReadTokens: number;
  readonly cacheCreationTokens: number;
  readonly reasoningTokens: number;
  readonly costUsdTicks: number | null;
}

function parseGrokTotals(value: unknown): GrokUsageTotals | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;

  const rawTicks = record["cost_usd_ticks"];
  const costUsdTicks =
    typeof rawTicks === "number" && Number.isFinite(rawTicks) ? Math.trunc(rawTicks) : null;

  return {
    inputTokens: int(record["input_tokens"]),
    outputTokens: int(record["output_tokens"]),
    cachedReadTokens: int(record["cached_read_tokens"]),
    cacheCreationTokens: int(record["cache_creation_tokens"]),
    reasoningTokens: int(record["reasoning_tokens"]),
    costUsdTicks,
  };
}

/**
 * Subtracts prior cumulative totals from the current event, floored at zero.
 *
 * Grok emits cumulative lifetime totals on its task events rather than
 * per-turn deltas. If a turn reports fewer tokens than the prior turn (which
 * happens when Grok restarts a conversation worker), the delta clamps to
 * zero rather than yielding negative usage.
 */
function subtractGrokTotals(current: GrokUsageTotals, prior: GrokUsageTotals): GrokUsageTotals {
  return {
    inputTokens: Math.max(0, current.inputTokens - prior.inputTokens),
    outputTokens: Math.max(0, current.outputTokens - prior.outputTokens),
    cachedReadTokens: Math.max(0, current.cachedReadTokens - prior.cachedReadTokens),
    cacheCreationTokens: Math.max(0, current.cacheCreationTokens - prior.cacheCreationTokens),
    reasoningTokens: Math.max(0, current.reasoningTokens - prior.reasoningTokens),
    costUsdTicks:
      current.costUsdTicks === null || prior.costUsdTicks === null
        ? current.costUsdTicks
        : Math.max(0, current.costUsdTicks - prior.costUsdTicks),
  };
}

/**
 * Mutable state threaded across consecutive lines of one Grok `updates.jsonl`.
 *
 * Grok emits `task_started` events whose `message` holds the model name, then
 * zero or more `task_progress` events whose `data.usage` holds cumulative
 * token counts, and finally a `task_completed` event with the same structure.
 */
export interface GrokScanState {
  model: string;
  sessionId: string;
  cumulativeTotals: GrokUsageTotals;
}

export function initialGrokScanState(): GrokScanState {
  return {
    model: "",
    sessionId: "",
    cumulativeTotals: {
      inputTokens: 0,
      outputTokens: 0,
      cachedReadTokens: 0,
      cacheCreationTokens: 0,
      reasoningTokens: 0,
      costUsdTicks: null,
    },
  };
}

/** Converts integer ticks (microdollars) into fractional USD. */
function ticksToUsd(ticks: number | null): number | null {
  if (ticks === null) return null;
  return Math.round((ticks / 1_000_000) * 1_000_000) / 1_000_000;
}

/**
 * Feeds one line of a Grok `updates.jsonl` into `state`, returning a record
 * when the line was an event carrying newly consumed tokens.
 */
export function parseGrokEventLine(line: string, state: GrokScanState): UsageRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const record = parsed as Record<string, unknown>;
  const event = record["event"];
  if (typeof event !== "object" || event === null) return null;
  const eventRecord = event as Record<string, unknown>;

  const eventType = eventRecord["type"];

  // Task start declares the model for subsequent progress and completion events.
  if (eventType === "task_started") {
    const rawModel = eventRecord["message"];
    if (typeof rawModel === "string" && rawModel.length > 0) {
      state.model = rawModel;
    }
    return null;
  }

  if (eventType !== "task_progress" && eventType !== "task_completed") {
    return null;
  }

  const data = eventRecord["data"];
  if (typeof data !== "object" || data === null) return null;
  const dataRecord = data as Record<string, unknown>;

  const current = parseGrokTotals(dataRecord["usage"]);
  if (current === null) return null;

  const timestampMs = parseTimestampMs(record["timestamp"]);
  if (timestampMs === null) return null;

  // Derive per-step delta by subtracting the prior cumulative state.
  const delta = subtractGrokTotals(current, state.cumulativeTotals);
  state.cumulativeTotals = current;

  const totals: UsageTokenTotals = {
    // Grok's `input_tokens` is already uncached.
    uncachedInputTokens: delta.inputTokens,
    cachedInputTokens: delta.cachedReadTokens,
    cacheCreationTokens: delta.cacheCreationTokens,
    outputTokens: delta.outputTokens,
    reasoningTokens: delta.reasoningTokens,
  };

  if (totalTokens(totals) === 0) return null;

  const model = state.model.length > 0 ? state.model : "<synthetic>";

  return {
    provider: "grok",
    timestampMs,
    model,
    sessionId: state.sessionId,
    totals,
    reportedCostUsd: ticksToUsd(delta.costUsdTicks),
    dedupeKey: null,
  };
}

interface LegacyGrokUsageTotals {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedReadTokens: number;
  readonly cacheCreationTokens: number;
  readonly reasoningTokens: number;
  readonly costUsdTicks: number | null;
}

function readLegacyGrokUsageTotals(value: unknown): LegacyGrokUsageTotals | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  return {
    inputTokens: int(record["inputTokens"]),
    outputTokens: int(record["outputTokens"]),
    cachedReadTokens: int(record["cachedReadTokens"]),
    cacheCreationTokens: int(record["cacheCreationTokens"]),
    reasoningTokens: int(record["reasoningTokens"]),
    costUsdTicks:
      typeof record["costUsdTicks"] === "number" && Number.isFinite(record["costUsdTicks"])
        ? record["costUsdTicks"]
        : null,
  };
}

function legacyGrokTotalsToUsage(totals: LegacyGrokUsageTotals): UsageTokenTotals {
  return {
    uncachedInputTokens: Math.max(
      0,
      totals.inputTokens - totals.cachedReadTokens - totals.cacheCreationTokens,
    ),
    cachedInputTokens: totals.cachedReadTokens,
    cacheCreationTokens: totals.cacheCreationTokens,
    outputTokens: totals.outputTokens,
    reasoningTokens: Math.min(totals.outputTokens, totals.reasoningTokens),
  };
}

/** Parses a Grok Build `updates.jsonl` turn-completed event. */
export function parseGrokLine(line: string): readonly UsageRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];

  const record = parsed as Record<string, unknown>;
  const params = record["params"];
  if (typeof params !== "object" || params === null) return [];
  const paramsRecord = params as Record<string, unknown>;
  const update = paramsRecord["update"];
  if (typeof update !== "object" || update === null) return [];
  const updateRecord = update as Record<string, unknown>;
  if (updateRecord["sessionUpdate"] !== "turn_completed") return [];

  const usage = updateRecord["usage"];
  if (typeof usage !== "object" || usage === null) return [];
  const usageRecord = usage as Record<string, unknown>;
  const sessionId = typeof paramsRecord["sessionId"] === "string" ? paramsRecord["sessionId"] : "";
  const promptId = typeof updateRecord["prompt_id"] === "string" ? updateRecord["prompt_id"] : null;

  const meta = paramsRecord["_meta"];
  let timestampMs: number | null = null;
  if (typeof meta === "object" && meta !== null) {
    const agentTimestampMs = (meta as Record<string, unknown>)["agentTimestampMs"];
    if (typeof agentTimestampMs === "number" && Number.isFinite(agentTimestampMs))
      timestampMs = agentTimestampMs;
  }
  if (timestampMs === null) {
    const timestamp = record["timestamp"];
    if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
      timestampMs = timestamp > 1e12 ? timestamp : timestamp * 1000;
    }
  }
  if (timestampMs === null) return [];

  const topLevel = readLegacyGrokUsageTotals(usageRecord);
  if (topLevel === null) return [];

  const modelEntries: Array<{ model: string; totals: LegacyGrokUsageTotals }> = [];
  const modelUsage = usageRecord["modelUsage"];
  if (typeof modelUsage === "object" && modelUsage !== null) {
    for (const [model, raw] of Object.entries(modelUsage as Record<string, unknown>)) {
      const totals = readLegacyGrokUsageTotals(raw);
      if (model.length > 0 && totals !== null) modelEntries.push({ model, totals });
    }
  }
  if (modelEntries.length === 0) {
    const totals = legacyGrokTotalsToUsage(topLevel);
    if (totalTokens(totals) === 0) return [];
    return [
      {
        provider: "grok",
        timestampMs,
        model: "grok",
        sessionId,
        totals,
        reportedCostUsd: grokCostTicksToUsd(topLevel.costUsdTicks),
        dedupeKey: promptId === null ? null : `${sessionId}:${promptId}:grok`,
      },
    ];
  }

  const topLevelCostUsd = grokCostTicksToUsd(topLevel.costUsdTicks);
  let usedTickedCostUsd = 0;
  let untickedTokenDenominator = 0;
  for (const entry of modelEntries) {
    const tokens = totalTokens(legacyGrokTotalsToUsage(entry.totals));
    if (tokens === 0) continue;
    if (entry.totals.costUsdTicks !== null) {
      usedTickedCostUsd += grokCostTicksToUsd(entry.totals.costUsdTicks) ?? 0;
    } else {
      untickedTokenDenominator += tokens;
    }
  }
  const remainingCostUsd =
    topLevelCostUsd === null ? null : Math.max(0, topLevelCostUsd - usedTickedCostUsd);

  const results: UsageRecord[] = [];
  for (const entry of modelEntries) {
    const totals = legacyGrokTotalsToUsage(entry.totals);
    if (totalTokens(totals) === 0) continue;
    let reportedCostUsd = grokCostTicksToUsd(entry.totals.costUsdTicks);
    if (reportedCostUsd === null && remainingCostUsd !== null && untickedTokenDenominator > 0) {
      reportedCostUsd = remainingCostUsd * (totalTokens(totals) / untickedTokenDenominator);
    }
    results.push({
      provider: "grok",
      timestampMs,
      model: entry.model,
      sessionId,
      totals,
      reportedCostUsd,
      dedupeKey: promptId === null ? null : `${sessionId}:${promptId}:${entry.model}`,
    });
  }
  return results;
}

export { EMPTY_TOTALS };
