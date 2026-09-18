// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off cryptoRandomUUID:off cryptoRandomUUIDInEffect:off globalDate:off globalTimersInEffect:off unknownInEffectCatch:off anyUnknownInErrorContext:off
import type { ServerProviderUsageLimits, ServerProviderUsageWindow } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  clampPercent,
  makeUnavailableUsageLimits,
  makeUsageLimits,
} from "../providerUsageLimits.ts";

export const AbacusComputePointsResponse = Schema.Struct({
  success: Schema.optional(Schema.Boolean),
  error: Schema.optional(Schema.String),
  result: Schema.optional(
    Schema.Struct({
      totalComputePoints: Schema.optional(Schema.Number),
      computePointsLeft: Schema.optional(Schema.Number),
      curr_month_avail_points: Schema.optional(Schema.Number),
      curr_month_usage: Schema.optional(Schema.Number),
      last_24_hours_usage: Schema.optional(Schema.Number),
      last_7_days_usage: Schema.optional(Schema.Number),
      nextBillingDate: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
      resetAt: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
    }),
  ),
});

export type AbacusComputePointsResponse = typeof AbacusComputePointsResponse.Type;

export const AbacusBillingInfoResponse = Schema.Struct({
  success: Schema.optional(Schema.Boolean),
  error: Schema.optional(Schema.String),
  result: Schema.optional(
    Schema.Struct({
      subscriptionStartTime: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
      nextBillingDate: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
      monthlyPrice: Schema.optional(Schema.Number),
      currentTier: Schema.optional(Schema.String),
      nextTier: Schema.optional(Schema.String),
    }),
  ),
});

export type AbacusBillingInfoResponse = typeof AbacusBillingInfoResponse.Type;

export function abacusUsageResponseToLimits(
  response: typeof AbacusComputePointsResponse.Type,
  checkedAt: string,
  billingInfo?: typeof AbacusBillingInfoResponse.Type | undefined,
): ServerProviderUsageLimits {
  if (response.error) {
    return makeUnavailableUsageLimits({
      checkedAt,
      reason: "probeFailed",
      message: response.error,
    });
  }

  if (!response.result) {
    return makeUnavailableUsageLimits({
      checkedAt,
      reason: "probeFailed",
      message: "No compute point information in ChatLLM response.",
    });
  }

  const {
    totalComputePoints,
    computePointsLeft,
    curr_month_avail_points,
    nextBillingDate: pointsNextBillingDate,
    resetAt,
  } = response.result;

  const left = computePointsLeft ?? curr_month_avail_points;
  if (left === undefined || !Number.isFinite(left)) {
    return makeUnavailableUsageLimits({ checkedAt, reason: "unsupported" });
  }

  const total =
    totalComputePoints !== undefined &&
    Number.isFinite(totalComputePoints) &&
    totalComputePoints > 0
      ? totalComputePoints
      : undefined;

  const usedPercent = total !== undefined ? clampPercent(((total - left) / total) * 100) : 0;

  const rawResetDate = billingInfo?.result?.nextBillingDate ?? pointsNextBillingDate ?? resetAt;

  let resetEpoch: number = NaN;
  if (typeof rawResetDate === "number") {
    resetEpoch = rawResetDate;
  } else if (typeof rawResetDate === "string") {
    resetEpoch = Date.parse(rawResetDate);
  }

  // Fallback: If no billing date was returned, fall back to the 1st of the next UTC month.
  if (!Number.isFinite(resetEpoch)) {
    const checkedDate = new Date(checkedAt);
    resetEpoch = Date.UTC(
      checkedDate.getUTCFullYear(),
      checkedDate.getUTCMonth() + 1,
      1,
      0,
      0,
      0,
      0,
    );
  }

  const reset = Number.isFinite(resetEpoch) ? DateTime.make(resetEpoch) : Option.none();
  const resetsAt = Option.isSome(reset) ? DateTime.formatIso(reset.value) : undefined;

  // Window duration in minutes (used for calculating pace of spending)
  let windowDurationMins: number | undefined;
  const rawStartTime = billingInfo?.result?.subscriptionStartTime;
  if (rawStartTime) {
    const startEpoch =
      typeof rawStartTime === "number" ? rawStartTime : Date.parse(String(rawStartTime));
    if (Number.isFinite(startEpoch) && resetEpoch > startEpoch) {
      windowDurationMins = Math.max(1, Math.round((resetEpoch - startEpoch) / (60 * 1000)));
    }
  }
  if (windowDurationMins === undefined && resetsAt) {
    // Default to ~30 days in minutes
    windowDurationMins = 30 * 24 * 60;
  }

  const label =
    total !== undefined
      ? `Monthly (${Math.round(left).toLocaleString("en-US")} / ${Math.round(total).toLocaleString("en-US")} credits left)`
      : `Monthly (${Math.round(left).toLocaleString("en-US")} credits left)`;

  const window: ServerProviderUsageWindow = {
    id: "abacus_monthly_credits",
    kind: "monthly",
    label,
    usedPercent,
    ...(resetsAt ? { resetsAt } : {}),
    ...(windowDurationMins !== undefined ? { windowDurationMins } : {}),
  };

  return makeUsageLimits({ checkedAt, windows: [window] });
}

export interface ReadAbacusUsageLimitsOptions {
  readonly sessionCookie?: string | undefined;
  readonly apiKey?: string | undefined;
  readonly fetch?: typeof globalThis.fetch | undefined;
  readonly timeoutMs?: number | undefined;
}

export const readAbacusUsageLimits = Effect.fn("readAbacusUsageLimits")(function* (
  options: ReadAbacusUsageLimitsOptions,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const fetchFn = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;

  const sessionCookie =
    options.sessionCookie?.trim() || environment.ABACUS_SESSION_COOKIE?.trim() || "";
  const apiKey = options.apiKey?.trim() || environment.ABACUS_API_KEY?.trim() || "";

  if (!sessionCookie && !apiKey) {
    return makeUnavailableUsageLimits({
      checkedAt,
      reason: "unsupported",
      message: "ChatLLM usage requires ABACUS_SESSION_COOKIE or ABACUS_API_KEY.",
    });
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (sessionCookie) {
    headers.Cookie = sessionCookie.startsWith("session=")
      ? sessionCookie
      : `session=${sessionCookie}`;
  }
  if (apiKey) {
    headers.apiKey = apiKey;
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return yield* Effect.tryPromise({
    try: async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const [pointsResResult, billingResResult] = await Promise.allSettled([
          fetchFn("https://apps.abacus.ai/api/_getOrganizationComputePoints", {
            method: "GET",
            headers,
            signal: controller.signal,
          }),
          fetchFn("https://apps.abacus.ai/api/_getBillingInfo", {
            method: "POST",
            headers,
            signal: controller.signal,
          }),
        ]);

        if (pointsResResult.status === "rejected") {
          throw pointsResResult.reason;
        }

        const pointsRes = pointsResResult.value;
        if (!pointsRes.ok) {
          return makeUnavailableUsageLimits({
            checkedAt,
            reason: "probeFailed",
            message: `HTTP ${pointsRes.status} ${pointsRes.statusText}`,
          });
        }

        const computeData = (await pointsRes.json()) as AbacusComputePointsResponse;

        let billingData: AbacusBillingInfoResponse | undefined;
        if (billingResResult.status === "fulfilled" && billingResResult.value.ok) {
          try {
            billingData = (await billingResResult.value.json()) as AbacusBillingInfoResponse;
          } catch {
            // Non-fatal: billing info parsing error falls back gracefully
          }
        }

        return abacusUsageResponseToLimits(computeData, checkedAt, billingData);
      } catch (error) {
        return makeUnavailableUsageLimits({
          checkedAt,
          reason: "probeFailed",
          message: error instanceof Error ? error.message : "ChatLLM could not read usage limits.",
        });
      } finally {
        clearTimeout(timer);
      }
    },
    catch: (error) =>
      makeUnavailableUsageLimits({
        checkedAt,
        reason: "probeFailed",
        message: error instanceof Error ? error.message : "ChatLLM could not read usage limits.",
      }),
  });
});
