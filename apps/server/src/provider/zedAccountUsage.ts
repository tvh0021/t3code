/**
 * Zed account token spend, read from the routes dashboard.zed.dev uses.
 *
 * Zed's native credential cannot read billing (those routes return 401 to it),
 * so this needs the dashboard's own cookie session for cloud.zed.dev. The
 * routes are undocumented; any failure becomes an explicit unavailable state,
 * never a zeroed bar.
 *
 * @module provider/zedAccountUsage
 */
import type { ServerProviderUsageLimits } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

import {
  clampPercent,
  makeUnavailableUsageLimits,
  makeUsageLimits,
} from "@t3tools/provider-core/server/usageLimits";

const ZED_CLOUD_URL = "https://cloud.zed.dev";
export const ZED_DASHBOARD_URL = "https://dashboard.zed.dev";
const ZED_EXTERNAL_USAGE = { label: "Zed dashboard", url: ZED_DASHBOARD_URL } as const;

export const ZED_SPEND_WINDOW_ID = "zed_token_spend";

const BillingUsage = Schema.Struct({
  current_usage: Schema.NullOr(
    Schema.Struct({
      token_spend: Schema.Struct({
        spend_in_cents: Schema.Number,
        limit_in_cents: Schema.NullOr(Schema.Number),
      }),
    }),
  ),
});

const CurrentSubscription = Schema.Struct({
  subscription: Schema.NullOr(
    Schema.Struct({
      period: Schema.NullOr(Schema.Struct({ start_at: Schema.String, end_at: Schema.String })),
    }),
  ),
});

class ZedDashboardRequestError extends Schema.TaggedError<ZedDashboardRequestError>()(
  "ZedDashboardRequestError",
  { status: Schema.Number },
) {}

// A lapsed session answers 401/403, or a redirect to sign-in on some routes.
const isSignedOut = (status: number) => status === 401 || status === 403 || status === 302;

const decodeBillingUsage = Schema.decodeUnknownEffect(BillingUsage);
const decodeCurrentSubscription = Schema.decodeUnknownEffect(CurrentSubscription);

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function withDashboardLink(limits: ServerProviderUsageLimits): ServerProviderUsageLimits {
  return { ...limits, externalUsage: ZED_EXTERNAL_USAGE };
}

export function zedUsageWithoutSession(checkedAt: string): ServerProviderUsageLimits {
  return withDashboardLink(
    makeUnavailableUsageLimits({
      checkedAt,
      reason: "unsupported",
      message: "Add a Zed dashboard session in Zed provider settings to see account spend.",
    }),
  );
}

/** Shown from startup until the first dashboard read finishes. */
export function zedUsageNotYetRead(checkedAt: string): ServerProviderUsageLimits {
  return withDashboardLink(
    makeUnavailableUsageLimits({
      checkedAt,
      reason: "probeFailed",
      message: "Zed account spend has not been read yet.",
    }),
  );
}

/** Turns the dashboard's billing responses into the account's monthly spend window. */
export function zedSpendToUsageLimits(input: {
  readonly checkedAt: string;
  readonly usage: typeof BillingUsage.Type;
  readonly subscription: typeof CurrentSubscription.Type;
}): ServerProviderUsageLimits {
  const spend = input.usage.current_usage?.token_spend;
  if (!spend) {
    return withDashboardLink(
      makeUnavailableUsageLimits({
        checkedAt: input.checkedAt,
        reason: "probeFailed",
        message: "Zed reported no token spend for this account.",
      }),
    );
  }
  const limit = spend.limit_in_cents;
  const period = Option.fromNullishOr(input.subscription.subscription?.period);
  const start = Option.flatMap(period, (p) => DateTime.make(p.start_at));
  const end = Option.flatMap(period, (p) => DateTime.make(p.end_at));
  const durationMs =
    Option.isSome(start) && Option.isSome(end)
      ? DateTime.toEpochMillis(end.value) - DateTime.toEpochMillis(start.value)
      : 0;
  return withDashboardLink(
    makeUsageLimits({
      checkedAt: input.checkedAt,
      windows: [
        {
          id: ZED_SPEND_WINDOW_ID,
          kind: "monthly",
          label:
            limit !== null && limit > 0
              ? `Spend ${dollars(spend.spend_in_cents)} of ${dollars(limit)}`
              : `Spend ${dollars(spend.spend_in_cents)}, no limit`,
          usedPercent:
            limit !== null && limit > 0 ? clampPercent((spend.spend_in_cents / limit) * 100) : 0,
          ...(Option.isSome(end) ? { resetsAt: DateTime.formatIso(end.value) } : {}),
          ...(durationMs > 0 ? { windowDurationMins: Math.round(durationMs / 60_000) } : {}),
        },
      ],
    }),
  );
}

/** Reads current spend and the billing period. Never fails; problems become unavailable states. */
export const readZedAccountUsage = Effect.fn("readZedAccountUsage")(function* (
  dashboardSession: string,
) {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  if (!dashboardSession.trim()) return zedUsageWithoutSession(checkedAt);

  const client = yield* HttpClient.HttpClient;
  const getJson = (path: string) =>
    client
      .execute(
        HttpClientRequest.get(`${ZED_CLOUD_URL}${path}`).pipe(
          HttpClientRequest.setHeaders({
            Accept: "application/json",
            Cookie: dashboardSession.trim(),
            Origin: ZED_DASHBOARD_URL,
          }),
        ),
      )
      .pipe(
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
        Effect.filterOrFail(
          (response) => response.status >= 200 && response.status < 300,
          (response) => new ZedDashboardRequestError({ status: response.status }),
        ),
        Effect.flatMap((response) => response.json),
      );

  return yield* Effect.all(
    {
      usage: getJson("/frontend/billing/usage").pipe(Effect.flatMap(decodeBillingUsage)),
      subscription: getJson("/frontend/billing/subscriptions/current").pipe(
        Effect.flatMap(decodeCurrentSubscription),
      ),
    },
    { concurrency: 2 },
  ).pipe(
    Effect.timeout("15 seconds"),
    Effect.map(({ usage, subscription }) =>
      zedSpendToUsageLimits({ checkedAt, usage, subscription }),
    ),
    Effect.catch((cause) =>
      cause._tag === "ZedDashboardRequestError" && isSignedOut(cause.status)
        ? Effect.succeed(
            withDashboardLink(
              makeUnavailableUsageLimits({
                checkedAt,
                reason: "probeFailed",
                message: "The Zed dashboard session expired. Replace it in Zed provider settings.",
              }),
            ),
          )
        : Effect.logWarning("zed.account-usage.read-failed", { cause }).pipe(
            Effect.as(
              withDashboardLink(
                makeUnavailableUsageLimits({
                  checkedAt,
                  reason: "probeFailed",
                  message: "Could not read Zed account spend. Check the Zed dashboard.",
                }),
              ),
            ),
          ),
    ),
  );
});
