// @effect-diagnostics globalDate:off - validates UTC billing dates reported by the dashboard
import type { UsageResolution, ZedSettings } from "@t3tools/contracts";
import type {
  ProviderUsageInstance,
  ProviderUsageScan,
  UsageRecord,
} from "@t3tools/provider-core/server/usage";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

// Undocumented shapes from dashboard.zed.dev's frontend client, inspected 2026-10-18.
const NonNegative = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));
const Count = NonNegative.check(Schema.isInt());
const BillingDay = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/));
const DailyUsage = Schema.Struct({
  date: BillingDay,
  tokens: Schema.Struct({
    input: Count,
    input_cache_creation: Count,
    input_cache_read: Count,
    output: Count,
    total: Count,
  }),
  cost_in_cents: Schema.NullOr(NonNegative),
  spend_in_cents: Schema.NullOr(NonNegative),
});
const TokenUsage = Schema.Struct({
  usage_by_model: Schema.Record(Schema.String, Schema.Array(DailyUsage)),
});
const Session = Schema.Struct({
  organizations: Schema.Array(Schema.Struct({ id: Schema.String, is_personal: Schema.Boolean })),
});
const Cache = Schema.Record(Schema.String, TokenUsage);
const cacheCodec = Schema.fromJsonString(Cache);
const decodeCache = Schema.decodeUnknownEffect(cacheCodec);
const encodeCache = Schema.encodeEffect(cacheCodec);
const decodeUsage = Schema.decodeUnknownEffect(TokenUsage);
const decodeSession = Schema.decodeUnknownEffect(Session);

class ZedUsageRequestError extends Schema.TaggedError<ZedUsageRequestError>()(
  "ZedUsageRequestError",
  { status: Schema.Number },
) {}

export function zedUsageModel(model: string): string {
  const slug = model
    .trim()
    .replace(/^zed\.dev\//, "")
    .toLowerCase()
    .replace(/\s+/g, "-");
  return `zed.dev/${slug.startsWith("claude-") ? slug.replace(/(\d+)\.(\d+)/g, "$1-$2") : slug}`;
}

/** Dashboard costs precede allowance adjustments; spend and amount due must not replace them. */
export function zedUsageRecords(
  usage: typeof TokenUsage.Type,
  account: string,
): readonly UsageRecord[] {
  return Object.entries(usage.usage_by_model).flatMap(([model, days]) =>
    days.flatMap((day) => {
      const timestampMs = Date.parse(`${day.date}T00:00:00.000Z`);
      if (
        !Number.isFinite(timestampMs) ||
        new Date(timestampMs).toISOString().slice(0, 10) !== day.date
      )
        return [];
      return [
        {
          provider: "zed" as const,
          model: zedUsageModel(model),
          timestampMs,
          billingDay: day.date,
          sessionId: "",
          speed: "standard" as const,
          reportedCostUsd: day.cost_in_cents === null ? null : day.cost_in_cents / 100,
          totals: {
            uncachedInputTokens: day.tokens.input,
            cachedInputTokens: day.tokens.input_cache_read,
            cacheCreationTokens: day.tokens.input_cache_creation,
            outputTokens: day.tokens.output,
            reasoningTokens: 0,
          },
          dedupeKey: JSON.stringify(["zed", account, model, day.date]),
        },
      ];
    }),
  );
}

/** Refreshes replace complete daily snapshots, including days corrected downward. */
export function mergeZedUsage(
  previous: typeof TokenUsage.Type | undefined,
  fresh: typeof TokenUsage.Type,
): typeof TokenUsage.Type {
  // A returned day is authoritative across models, including a model removed from that day.
  const dates = new Set(
    Object.values(fresh.usage_by_model).flatMap((days) => days.map((day) => day.date)),
  );
  const models = new Set([
    ...Object.keys(previous?.usage_by_model ?? {}),
    ...Object.keys(fresh.usage_by_model),
  ]);
  return {
    usage_by_model: Object.fromEntries(
      [...models].map((model) => [
        model,
        [
          ...(previous?.usage_by_model[model] ?? []).filter((day) => !dates.has(day.date)),
          ...(fresh.usage_by_model[model] ?? []),
        ],
      ]),
    ),
  };
}

/** Owned by UsageService so caches and request throttling live for one server lifetime. */
export const makeZedUsageScanner = Effect.fn("UsageService.makeZedUsageScanner")(function* (
  stateDir: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const client = yield* HttpClient.HttpClient;
  const cachePath = path.join(stateDir, "usage-zed-accounts.json");
  let accounts: typeof Cache.Type = {};
  const attempts = new Map<string, { at: number; account?: string; error?: string }>();
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
  const get = (route: string, session: string) =>
    client
      .execute(
        HttpClientRequest.get(`https://cloud.zed.dev${route}`).pipe(
          HttpClientRequest.setHeaders({
            Accept: "application/json",
            Cookie: session,
            Origin: "https://dashboard.zed.dev",
          }),
        ),
      )
      .pipe(
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
        Effect.filterOrFail(
          (response) => response.status >= 200 && response.status < 300,
          (response) => new ZedUsageRequestError({ status: response.status }),
        ),
        Effect.flatMap((response) => response.json),
      );
  const scan = Effect.fn("UsageService.scanZedUsage")(function* (
    instances: readonly ProviderUsageInstance<ZedSettings>[],
    resolution: UsageResolution = "day",
  ) {
    yield* loaded;
    const sources: ProviderUsageScan[] = [];
    const seen = new Set<string>();
    for (const instance of instances) {
      if (!instance.configured) continue;
      const session = instance.config?.dashboardSession?.trim();
      const missing = {
        dir: `zed-instance:${instance.instanceId}`,
        volumeId: "",
        files: [],
      } as const;
      if (!session) {
        sources.push({
          ...missing,
          status: "missing",
          message: "Connect a Zed dashboard session in provider settings to read model usage.",
        });
        continue;
      }
      let attempt = attempts.get(session);
      const now = yield* Clock.currentTimeMillis;
      if (!attempt || now - attempt.at >= 60_000) {
        const read = yield* Effect.gen(function* () {
          const identity = yield* get("/frontend/session", session).pipe(
            Effect.flatMap(decodeSession),
          );
          const organization = identity.organizations.find((entry) => entry.is_personal);
          if (!organization) return yield* new ZedUsageRequestError({ status: 404 });
          const usage = yield* get(
            `/frontend/organizations/${encodeURIComponent(organization.id)}/billing/usage/tokens`,
            session,
          ).pipe(Effect.flatMap(decodeUsage));
          return { account: organization.id, usage };
        }).pipe(Effect.timeout("15 seconds"), Effect.result);
        if (Result.isSuccess(read)) {
          const { account, usage } = read.success;
          accounts = { ...accounts, [account]: mergeZedUsage(accounts[account], usage) };
          attempt = { at: now, account };
          yield* encodeCache(accounts).pipe(
            Effect.flatMap((contents) =>
              writeFileStringAtomically({ filePath: cachePath, contents }),
            ),
            Effect.provideService(FileSystem.FileSystem, fileSystem),
            Effect.provideService(Path.Path, path),
            Effect.catch(() => Effect.void),
          );
        } else {
          const expired =
            read.failure._tag === "ZedUsageRequestError" &&
            [302, 401, 403].includes(read.failure.status);
          attempt = {
            at: now,
            ...(attempt?.account ? { account: attempt.account } : {}),
            error: expired
              ? "The Zed dashboard session expired. Reconnect it in provider settings."
              : "Could not read Zed model usage. Check the Zed dashboard.",
          };
        }
        attempts.set(session, attempt);
      }
      const account = attempt.account;
      if (!account) {
        sources.push({
          ...missing,
          status: "failed",
          message: attempt.error ?? "Could not identify the Zed account.",
        });
        continue;
      }
      if (seen.has(account)) continue;
      seen.add(account);
      const dir = `zed-account:${account}`;
      sources.push({
        dir,
        hostId: dir,
        volumeId: account,
        files: [
          {
            path: dir,
            records: resolution === "hour" ? [] : zedUsageRecords(accounts[account]!, account),
          },
        ],
        status: attempt.error || resolution === "hour" ? "partial" : "ok",
        message:
          attempt.error ??
          (resolution === "hour"
            ? "Zed reports daily UTC totals; hourly usage is unavailable."
            : "Zed account totals use UTC billing days, include usage outside T3, and may lag. Costs precede allowance and prepaid adjustments. Session counts are unavailable."),
      });
    }
    return sources;
  });
  return (...args: Parameters<typeof scan>) => scan(...args).pipe(lock.withPermit);
});
