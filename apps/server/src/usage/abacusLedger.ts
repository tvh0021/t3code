// @effect-diagnostics globalDate:off - validates UTC billing dates reported by the ledger
import {
  ABACUS_CREDIT_COST_USD,
  type AbacusSettings,
  type UsageResolution,
} from "@t3tools/contracts";
import type { ProviderUsageInstance, ProviderUsageScan } from "@t3tools/provider-core/server/usage";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { HttpClient, HttpClientRequest } from "effect/http";

import type { CreditedUsageRecord } from "./usageAggregation.ts";

// Undocumented endpoint behind the ChatLLM billing dashboard, inspected 2026-10-18.
// It accepts the API key and returns the last 30 UTC days that have charges.
const LEDGER_URL = "https://api.abacus.ai/api/v0/_getOrganizationComputePointLog";
const BillingDay = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/));
const Ledger = Schema.Struct({
  columns: Schema.Record(Schema.String, Schema.String),
  log: Schema.Array(
    Schema.StructWithRest(Schema.Struct({ date: BillingDay }), [
      Schema.Record(Schema.String, Schema.Unknown),
    ]),
  ),
});
type Ledger = typeof Ledger.Type;
const decodeResponse = Schema.decodeUnknownEffect(
  Schema.Struct({ success: Schema.Literal(true), result: Ledger }),
);
const cacheCodec = Schema.fromJsonString(Schema.Record(Schema.String, Ledger));
const decodeCache = Schema.decodeUnknownEffect(cacheCodec);
const encodeCache = Schema.encodeEffect(cacheCodec);

class AbacusLedgerRequestError extends Schema.TaggedError<AbacusLedgerRequestError>()(
  "AbacusLedgerRequestError",
  { status: Schema.Number },
) {}

const LEDGER_TOTAL_KEYS = new Set(["date", "total", "non_conversation"]);
const compact = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Ledger columns are internal enum names (`XAI_GROK_4_7`) with display labels
 * (`Grok 4.7`); T3 records `grok-4.7`. A known model matches when it equals the
 * label or ends the vendor-prefixed key, ignoring punctuation.
 */
export function abacusLedgerModel(
  key: string,
  label: string | undefined,
  knownModels: Iterable<string>,
): string {
  const keyForm = compact(key);
  const labelForm = label === undefined ? "" : compact(label);
  let match: string | undefined;
  for (const model of knownModels) {
    const form = compact(model);
    if (form.length < 4 || (form !== labelForm && !keyForm.endsWith(form))) continue;
    if (match === undefined || form.length > compact(match).length) match = model;
  }
  return match ?? (label ?? key).trim().toLowerCase().replace(/\s+/g, "-");
}

export function abacusLedgerRecords(
  ledger: Ledger,
  account: string,
  knownModels: Iterable<string>,
): readonly CreditedUsageRecord[] {
  const models = [...knownModels];
  return ledger.log.flatMap((day) => {
    const timestampMs = Date.parse(`${day.date}T00:00:00.000Z`);
    if (
      !Number.isFinite(timestampMs) ||
      new Date(timestampMs).toISOString().slice(0, 10) !== day.date
    )
      return [];
    return Object.entries(day).flatMap(([key, credits]) => {
      if (LEDGER_TOTAL_KEYS.has(key) || typeof credits !== "number") return [];
      if (!Number.isFinite(credits) || credits <= 0) return [];
      return [
        {
          provider: "abacus" as const,
          model: abacusLedgerModel(key, ledger.columns[key], models),
          timestampMs,
          billingDay: day.date,
          sessionId: "",
          speed: "standard" as const,
          reportedCostUsd: credits * ABACUS_CREDIT_COST_USD,
          credits,
          totals: {
            uncachedInputTokens: 0,
            cachedInputTokens: 0,
            cacheCreationTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
          },
          dedupeKey: JSON.stringify(["abacus-ledger", account, key, day.date]),
        },
      ];
    });
  });
}

/** A returned day replaces its saved copy; older days keep the saved copy. */
export function mergeAbacusLedger(previous: Ledger | undefined, fresh: Ledger): Ledger {
  const dates = new Set(fresh.log.map((day) => day.date));
  return {
    columns: { ...previous?.columns, ...fresh.columns },
    log: [...fresh.log, ...(previous?.log ?? []).filter((day) => !dates.has(day.date))],
  };
}

// Identifies one account across instances and environments without storing the key.
function accountId(apiKey: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < apiKey.length; index += 1) {
    hash = Math.imul(hash ^ apiKey.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Owned by UsageService so the cache and request throttling live for one server lifetime. */
export const makeAbacusLedgerScanner = Effect.fn("UsageService.makeAbacusLedgerScanner")(function* (
  stateDir: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const client = yield* HttpClient.HttpClient;
  const cachePath = path.join(stateDir, "usage-abacus-ledger.json");
  let accounts: Record<string, Ledger> = {};
  const attempts = new Map<string, { at: number; error?: string }>();
  const lock = yield* Semaphore.make(1);
  const loaded = yield* Effect.cached(
    fileSystem.readFileString(cachePath).pipe(
      Effect.flatMap(decodeCache),
      Effect.tap((value) =>
        Effect.sync(() => {
          accounts = value;
        }),
      ),
      Effect.catch(() => Effect.void),
    ),
  );
  const fetchLedger = (apiKey: string) =>
    client
      .execute(
        HttpClientRequest.post(LEDGER_URL).pipe(
          HttpClientRequest.setHeaders({ Accept: "application/json", apiKey }),
          HttpClientRequest.bodyJsonUnsafe({ byLlm: true }),
        ),
      )
      .pipe(
        Effect.filterOrFail(
          (response) => response.status >= 200 && response.status < 300,
          (response) => new AbacusLedgerRequestError({ status: response.status }),
        ),
        Effect.flatMap((response) => response.json),
        Effect.flatMap(decodeResponse),
        Effect.map((response) => response.result),
      );

  const scan = Effect.fn("UsageService.scanAbacusLedger")(function* (
    instances: readonly ProviderUsageInstance<AbacusSettings>[],
    knownModels: Iterable<string>,
    resolution: UsageResolution = "day",
  ) {
    yield* loaded;
    const sources: ProviderUsageScan[] = [];
    const seen = new Set<string>();
    for (const instance of instances) {
      const apiKey = instance.environment.ABACUS_API_KEY?.trim();
      if (!instance.configured || !apiKey) continue;
      const account = accountId(apiKey);
      if (seen.has(account)) continue;
      seen.add(account);
      let attempt = attempts.get(account);
      const now = yield* Clock.currentTimeMillis;
      if (!attempt || now - attempt.at >= 60_000) {
        const read = yield* fetchLedger(apiKey).pipe(Effect.timeout("15 seconds"), Effect.result);
        if (Result.isSuccess(read)) {
          accounts = { ...accounts, [account]: mergeAbacusLedger(accounts[account], read.success) };
          attempt = { at: now };
          yield* encodeCache(accounts).pipe(
            Effect.flatMap((contents) =>
              writeFileStringAtomically({ filePath: cachePath, contents }),
            ),
            Effect.provideService(FileSystem.FileSystem, fileSystem),
            Effect.provideService(Path.Path, path),
            Effect.ignore,
          );
        } else {
          const rejected =
            read.failure._tag === "AbacusLedgerRequestError" &&
            [401, 403].includes(read.failure.status);
          attempt = {
            at: now,
            error: rejected
              ? "Abacus rejected the API key, so ChatLLM credits are estimated from tokens."
              : "Could not read the Abacus billing ledger, so recent ChatLLM credits are estimated from tokens.",
          };
        }
        attempts.set(account, attempt);
      }
      const ledger = accounts[account];
      const dir = `abacus-account:${account}`;
      if (!ledger) {
        sources.push({
          dir,
          hostId: dir,
          volumeId: account,
          files: [],
          status: "failed",
          message: attempt.error ?? "",
        });
        continue;
      }
      sources.push({
        dir,
        hostId: dir,
        volumeId: account,
        files: [
          {
            path: dir,
            records: resolution === "hour" ? [] : abacusLedgerRecords(ledger, account, knownModels),
          },
        ],
        status: attempt.error ? "partial" : "ok",
        message:
          attempt.error ??
          (resolution === "hour"
            ? "Abacus bills by UTC day, so hourly ChatLLM credits are estimated from tokens."
            : "ChatLLM credits come from Abacus's billing ledger by UTC day and include use outside T3. Charges can take a few minutes to post."),
      });
    }
    return sources;
  });
  return (...args: Parameters<typeof scan>) => scan(...args).pipe(lock.withPermit);
});
