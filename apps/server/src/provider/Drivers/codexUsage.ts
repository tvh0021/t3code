import {
  codexCreditsToUsd,
  type CodexSettings,
  type UsageProviderKind,
  type UsageTokenTotals,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  parseTimestampMs,
  totalTokens,
  type ProviderUsageReader,
  type TranscriptUsageFormat,
  type UsageSpeed,
} from "@t3tools/provider-core/server/usage";

import type { CreditedUsageRecord as UsageRecord } from "../../usage/usageAggregation.ts";

import * as CodexUsageHistory from "../../usage/CodexUsageHistory.ts";
import { resolveCodexHomeLayout } from "./CodexHomeLayout.ts";

const TokenCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const CodexTokenUsage = Schema.Struct({
  input_tokens: TokenCount,
  cached_input_tokens: TokenCount,
  cache_write_input_tokens: TokenCount,
  output_tokens: TokenCount,
  reasoning_output_tokens: TokenCount,
  total_tokens: TokenCount,
}).check(
  Schema.makeFilter(
    (usage) =>
      usage.cached_input_tokens + usage.cache_write_input_tokens <= usage.input_tokens &&
      usage.reasoning_output_tokens <= usage.output_tokens &&
      usage.total_tokens >= usage.input_tokens + usage.output_tokens,
  ),
);
type CodexTokenUsage = typeof CodexTokenUsage.Type;
const isCodexTokenUsage = Schema.is(CodexTokenUsage);
const CODEX_USAGE_FIELDS = Object.keys(CodexTokenUsage.fields) as (keyof CodexTokenUsage)[];

function readCodexTokenUsage(value: unknown): CodexTokenUsage | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const input = raw["input_tokens"];
  const output = raw["output_tokens"];
  if (typeof input !== "number" || typeof output !== "number") return null;
  const usage = {
    input_tokens: input,
    cached_input_tokens: raw["cached_input_tokens"] === undefined ? 0 : raw["cached_input_tokens"],
    cache_write_input_tokens:
      raw["cache_write_input_tokens"] === undefined ? 0 : raw["cache_write_input_tokens"],
    output_tokens: output,
    reasoning_output_tokens:
      raw["reasoning_output_tokens"] === undefined ? 0 : raw["reasoning_output_tokens"],
    total_tokens: raw["total_tokens"] === undefined ? input + output : raw["total_tokens"],
  };
  return isCodexTokenUsage(usage) ? usage : null;
}

function advanceCodexUsage(previous: CodexTokenUsage | null, last: CodexTokenUsage) {
  return readCodexTokenUsage(
    Object.fromEntries(CODEX_USAGE_FIELDS.map((key) => [key, (previous?.[key] ?? 0) + last[key]])),
  );
}

/**
 * Codex `token_count` events carry no model or service tier, so both are carried forward: the model
 * from the most recent `turn_context`, the tier from the most recent `thread_settings_applied`.
 */
export const CodexScanState = Schema.Struct({
  model: Schema.mutableKey(Schema.String),
  speed: Schema.mutableKey(Schema.Literals(["standard", "fast", "ultrafast"])),
  sessionId: Schema.mutableKey(Schema.String),
  lastUsageSignature: Schema.mutableKey(Schema.NullOr(Schema.String)),
  lastCumulativeUsage: Schema.mutableKey(Schema.NullOr(CodexTokenUsage)),
  malformedRecords: Schema.mutableKey(TokenCount),
  sawSessionMeta: Schema.mutableKey(Schema.Boolean),
  modelProvider: Schema.mutableKey(Schema.String),
  turnId: Schema.mutableKey(Schema.String),
  sawThreadSettings: Schema.mutableKey(Schema.Boolean),
  suppressingForkCopies: Schema.mutableKey(Schema.Boolean),
  forkCopyAnchorMs: Schema.mutableKey(Schema.Finite),
});
export type CodexScanState = typeof CodexScanState.Type;

export function initialCodexScanState(): CodexScanState {
  return {
    model: "",
    speed: "standard",
    sessionId: "",
    lastUsageSignature: null,
    lastCumulativeUsage: null,
    malformedRecords: 0,
    sawSessionMeta: false,
    modelProvider: "",
    turnId: "",
    sawThreadSettings: false,
    suppressingForkCopies: false,
    forkCopyAnchorMs: 0,
  };
}

/** Forks copy and restamp parent history in a burst (0-40ms gaps); genuine child usage follows a model turn (5s+ observed). */
const FORK_COPY_MAX_GAP_MS = 1000;

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
 * Cumulative counters validate request deltas. Older events without cumulative counters use
 * normalized consecutive-request deduplication.
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
  return parseCodexRecord(parsed, state, provider);
}

function parseCodexRecord(
  parsed: unknown,
  state: CodexScanState,
  provider: UsageProviderKind = "codex",
): UsageRecord | null {
  if (typeof parsed !== "object" || parsed === null) return null;

  const record = parsed as Record<string, unknown>;
  const payload = record["payload"];
  if (typeof payload !== "object" || payload === null) return null;
  const payloadRecord = payload as Record<string, unknown>;
  const payloadType = payloadRecord["type"];

  if (record["type"] === "session_meta") {
    // Only the first meta identifies this session; copied ancestor metas would misattribute later records.
    if (state.sawSessionMeta) return null;
    state.sawSessionMeta = true;
    const id = payloadRecord["id"] ?? payloadRecord["session_id"];
    if (typeof id === "string") state.sessionId = id;
    if (typeof payloadRecord["model_provider"] === "string") {
      state.modelProvider = payloadRecord["model_provider"];
    }
    const metaTimestampMs = parseTimestampMs(record["timestamp"]);
    if (metaTimestampMs !== null && isForkedSessionMeta(payloadRecord)) {
      state.suppressingForkCopies = true;
      state.forkCopyAnchorMs = metaTimestampMs;
    }
    return null;
  }

  if (record["type"] === "turn_context") {
    if (typeof payloadRecord["model"] === "string") state.model = payloadRecord["model"];
    // Model carry is useful for usage, but history recovery needs this context's own identity.
    state.turnId =
      typeof payloadRecord["turn_id"] === "string" &&
      typeof payloadRecord["model"] === "string" &&
      payloadRecord["model"].length > 0
        ? payloadRecord["turn_id"]
        : "";
    return null;
  }

  if (payloadType === "thread_settings_applied") {
    state.sawThreadSettings = true;
    const settings = payloadRecord["thread_settings"];
    if (typeof settings === "object" && settings !== null) {
      state.speed = codexSpeed((settings as Record<string, unknown>)["service_tier"]);
    }
    return null;
  }

  if (payloadType !== "token_count") return null;

  const info = payloadRecord["info"];
  if (typeof info !== "object" || info === null) return null;
  const infoRecord = info as Record<string, unknown>;

  // Codex may re-emit these counters after the model or timestamp becomes available.
  const timestampMs = parseTimestampMs(record["timestamp"]);
  if (timestampMs === null || state.model.length === 0) return null;

  const last = readCodexTokenUsage(infoRecord["last_token_usage"]);
  const rawCumulative = infoRecord["total_token_usage"];
  const hasCumulative = rawCumulative !== undefined && rawCumulative !== null;
  const cumulative = hasCumulative ? readCodexTokenUsage(rawCumulative) : null;

  if (state.suppressingForkCopies) {
    if (timestampMs - state.forkCopyAnchorMs < FORK_COPY_MAX_GAP_MS) {
      state.forkCopyAnchorMs = timestampMs;
      // Copied history is already billed in the parent, but establishes the child's baseline.
      const signature = last === null ? null : JSON.stringify(last);
      if (cumulative !== null) state.lastCumulativeUsage = cumulative;
      else if (!hasCumulative && last !== null && signature !== state.lastUsageSignature) {
        state.lastCumulativeUsage = advanceCodexUsage(state.lastCumulativeUsage, last);
      }
      state.lastUsageSignature = signature;
      return null;
    }
    state.suppressingForkCopies = false;
    state.lastUsageSignature = null;
  }

  const previous = state.lastCumulativeUsage;
  // A valid snapshot remains the next baseline even when its paired request is malformed.
  if (cumulative !== null) state.lastCumulativeUsage = cumulative;
  if (last === null || (hasCumulative && cumulative === null)) {
    state.malformedRecords += 1;
    return null;
  }

  // Zero-component counters report context size, not a request: fill_to_context_window, or the
  // post-compaction marker whose total is the new context size (its cumulative may reset to zero).
  if (last.input_tokens + last.output_tokens === 0) {
    state.lastUsageSignature = null;
    return null;
  }

  if (
    cumulative !== null &&
    previous !== null &&
    CODEX_USAGE_FIELDS.every((key) => cumulative[key] === previous[key])
  ) {
    return null;
  }

  if (last.total_tokens !== last.input_tokens + last.output_tokens) {
    state.malformedRecords += 1;
    return null;
  }

  const signature = JSON.stringify(last);
  if (cumulative !== null) {
    // A session resumed in a new Codex process restarts its cumulative counters at this request.
    const restarted = CODEX_USAGE_FIELDS.every((key) => cumulative[key] === last[key]);
    // Forks and paginated continuations can inherit totals without copying a counter snapshot.
    // Only bill the latest request, and require the unseen prefix to be valid usage too.
    const reconciled =
      previous === null
        ? readCodexTokenUsage(
            Object.fromEntries(CODEX_USAGE_FIELDS.map((key) => [key, cumulative[key] - last[key]])),
          ) !== null
        : CODEX_USAGE_FIELDS.every((key) => cumulative[key] - previous[key] === last[key]);
    if (!restarted && !reconciled) {
      state.malformedRecords += 1;
      return null;
    }
  } else {
    if (signature === state.lastUsageSignature) return null;
    // Advance expected totals for billed legacy requests so a cumulative re-emission is stale.
    const advanced = advanceCodexUsage(previous, last);
    if (advanced === null) {
      state.malformedRecords += 1;
      return null;
    }
    state.lastCumulativeUsage = advanced;
  }
  state.lastUsageSignature = signature;

  const inputTokens = last.input_tokens;
  const cachedInputTokens = last.cached_input_tokens;
  const cacheCreationTokens = last.cache_write_input_tokens;
  const outputTokens = last.output_tokens;

  const totals: UsageTokenTotals = {
    // Codex reports `input_tokens` inclusive of the cached portion.
    uncachedInputTokens: inputTokens - cachedInputTokens - cacheCreationTokens,
    cachedInputTokens,
    cacheCreationTokens,
    outputTokens,
    // Reported inside output_tokens, surfaced separately for the token mix.
    reasoningTokens: last.reasoning_output_tokens,
  };

  const rawRateLimits = payloadRecord["rate_limits"];
  let creditBalance: number | null = null;
  if (typeof rawRateLimits === "object" && rawRateLimits !== null) {
    const rateLimits = rawRateLimits as Record<string, unknown>;
    const credsObj = rateLimits["credits"];
    if (typeof credsObj === "object" && credsObj !== null) {
      const balStr = (credsObj as Record<string, unknown>)["balance"];
      if (typeof balStr === "string") {
        const bal = parseFloat(balStr);
        if (Number.isFinite(bal) && bal > 0) creditBalance = bal;
      }
    }
  }

  const rawLastUsage = infoRecord["last_token_usage"];
  const rawCredits =
    typeof rawLastUsage === "object" && rawLastUsage !== null
      ? (rawLastUsage as Record<string, unknown>)["credits"]
      : undefined;
  let credits =
    typeof rawCredits === "number" && Number.isFinite(rawCredits) && rawCredits >= 0
      ? rawCredits
      : null;

  if (totalTokens(totals) === 0 && (credits === null || credits === 0)) return null;

  let reportedCostUsd: number | null = null;
  if (state.model === "codex-auto-review") {
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
    speed: state.speed,
    ...(credits !== null ? { credits } : {}),
    ...(creditBalance !== null ? { creditBalance } : {}),
    ...(!state.sawThreadSettings &&
    state.modelProvider === "openai" &&
    state.sessionId.length > 0 &&
    state.turnId.length > 0
      ? { unresolvedServiceTierTurnId: state.turnId }
      : {}),
    dedupeKey: null,
  };
}

/** Reconciles Codex account-level credit balances chronologically across rollout files (`$0.04`/credit). */
export function reconcileCodexCreditUsage<
  T extends { readonly path: string; readonly records: readonly UsageRecord[] },
>(files: ReadonlyArray<T>): ReadonlyArray<T> {
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
    ...file,
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

/**
 * Runs `reconcileCodexCreditUsage` once per Codex home, across its `sessions`
 * and `archived_sessions` together. Reconciling each directory alone charged
 * the same balance drop once per directory. `filesByDir` lines up with `dirs`;
 * non-Codex directories pass through unchanged.
 */
export function reconcileCodexCreditUsageByHome<
  T extends { readonly path: string; readonly records: readonly UsageRecord[] },
>(
  dirs: ReadonlyArray<{ readonly provider: string; readonly dir: string }>,
  filesByDir: ReadonlyArray<ReadonlyArray<T>>,
): ReadonlyArray<ReadonlyArray<T>> {
  const homes = new Map<string, number[]>();
  dirs.forEach(({ provider, dir }, index) => {
    if (provider !== "codex") return;
    const home = dir.replace(/[\\/]+[^\\/]+[\\/]*$/, "");
    homes.set(home, [...(homes.get(home) ?? []), index]);
  });
  const result = [...filesByDir];
  for (const indexes of homes.values()) {
    // Directory order is kept so a record's first copy, the one aggregation
    // keeps, is the copy that receives the credits.
    const reconciled = reconcileCodexCreditUsage(indexes.flatMap((index) => filesByDir[index]!));
    let offset = 0;
    for (const index of indexes) {
      const count = filesByDir[index]!.length;
      result[index] = reconciled.slice(offset, offset + count);
      offset += count;
    }
  }
  return result;
}

/**
 * Codex omits the field when no tier was requested, which bills as standard, as
 * do `default` and `standard`. `fast` is accepted as an alias of `priority`.
 */

/** Missing, default and standard tiers bill as standard; fast aliases priority. */
function codexSpeed(serviceTier: unknown): UsageSpeed {
  if (serviceTier === "priority" || serviceTier === "fast") return "fast";
  if (serviceTier === "ultrafast") return "ultrafast";
  return "standard";
}

const orEmpty = (record: UsageRecord | null): readonly UsageRecord[] =>
  record === null ? [] : [record];

export const codexUsageFormat: TranscriptUsageFormat<CodexScanState> = {
  selectFields: {
    type: true,
    timestamp: true,
    payload: {
      type: true,
      id: true,
      session_id: true,
      model_provider: true,
      turn_id: true,
      model: true,
      thread_settings: { service_tier: true },
      forked_from_id: true,
      source: { subagent: { thread_spawn: { parent_thread_id: true } } },
      info: { last_token_usage: true, total_token_usage: true },
      rate_limits: { credits: { balance: true } },
    },
  },
  // Metadata lines carry model, tier and session even without usage.
  usageMarkers: ['"token_count"', '"turn_context"', '"thread_settings_applied"', '"session_meta"'],
  parseLine: (line, state) => orEmpty(parseCodexLine(line, state)),
  parseProjected: (projected, state) => orEmpty(parseCodexRecord(projected, state)),
  state: { initial: initialCodexScanState, schema: CodexScanState },
  readMalformedRecords: (state) => state.malformedRecords,
  // A rollout that moved after it was read leaves a copy in both places.
  sharedSessionsAcrossFiles: true,
};

export const codexUsageReader: ProviderUsageReader<
  CodexSettings,
  Path.Path | CodexUsageHistory.CodexUsageHistory
> = {
  kind: "transcripts",
  provider: "codex",
  format: codexUsageFormat,
  resolveServiceTiers: Effect.fn("codexUsageReader.resolveServiceTiers")(function* (records) {
    const history = yield* CodexUsageHistory.CodexUsageHistory;
    const requests = new Map<CodexUsageHistory.CodexUsageHistoryRequest, UsageRecord>();
    for (const record of records) {
      if (record.unresolvedServiceTierTurnId === undefined) continue;
      requests.set(
        {
          sessionId: record.sessionId,
          nativeTurnId: record.unresolvedServiceTierTurnId,
          model: record.model,
        },
        record,
      );
    }
    const resolved = yield* history.resolve([...requests.keys()]).pipe(
      Effect.catchTags({
        CodexUsageHistoryReadError: () =>
          Effect.succeed(new Map<CodexUsageHistory.CodexUsageHistoryRequest, UsageSpeed>()),
      }),
    );
    const speeds = new Map<UsageRecord, UsageSpeed>();
    for (const [request, speed] of resolved) {
      const record = requests.get(request);
      if (record !== undefined) speeds.set(record, speed);
    }
    return speeds;
  }),
  directories: Effect.fn("codexUsageReader.directories")(function* ({ config, environment }) {
    if (config === undefined) return [];
    const path = yield* Path.Path;
    const environmentHome = environment.CODEX_HOME?.trim();
    const layout = yield* resolveCodexHomeLayout(
      config.setupMode !== "managed" &&
        !config.homePath.trim() &&
        !config.shadowHomePath.trim() &&
        environmentHome
        ? { ...config, homePath: environmentHome }
        : config,
    );
    // Archiving a thread moves its rollout out of `sessions`; its spend still counts.
    return [
      { dir: path.resolve(layout.sharedHomePath, "sessions") },
      { dir: path.resolve(layout.sharedHomePath, "archived_sessions") },
    ];
  }),
};
