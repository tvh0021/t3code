import { describe, expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";

import { readZedAccountUsage, ZED_SPEND_WINDOW_ID } from "./zedAccountUsage.ts";

const period = { start_at: "2026-10-01T00:00:00Z", end_at: "2026-10-31T00:00:00Z" };

const read = (
  dashboardSession: string,
  responses: { usage?: Response; subscription?: Response } = {},
) =>
  Effect.gen(function* () {
    const requests: Array<string> = [];
    const http = HttpClient.make((request, _url, _signal, fiber) =>
      Effect.sync(() => {
        expect(Context.getOrUndefined(fiber.context, FetchHttpClient.RequestInit)?.redirect).toBe(
          "manual",
        );
        expect(request.headers.cookie).toBe("session=abc");
        requests.push(new URL(request.url).pathname);
        return HttpClientResponse.fromWeb(
          request,
          request.url.endsWith("/billing/usage")
            ? (responses.usage ??
                Response.json({
                  current_usage: { token_spend: { spend_in_cents: 520, limit_in_cents: 1000 } },
                }))
            : (responses.subscription ?? Response.json({ subscription: { period } })),
        );
      }),
    );
    const usage = yield* readZedAccountUsage(dashboardSession).pipe(
      Effect.provideService(HttpClient.HttpClient, http),
    );
    return { usage, requests };
  });

describe("readZedAccountUsage", () => {
  it.effect("reports spend against the limit with the billing period's reset", () =>
    Effect.gen(function* () {
      const { usage, requests } = yield* read("  session=abc  ");
      expect(requests.toSorted()).toEqual([
        "/frontend/billing/subscriptions/current",
        "/frontend/billing/usage",
      ]);
      expect(usage.unavailable).toBeUndefined();
      expect(usage.windows).toEqual([
        {
          id: ZED_SPEND_WINDOW_ID,
          kind: "monthly",
          label: "Spend $5.20 of $10.00",
          usedPercent: 52,
          resetsAt: "2026-10-31T00:00:00.000Z",
          windowDurationMins: 30 * 24 * 60,
        },
      ]);
      expect(usage.externalUsage?.url).toBe("https://dashboard.zed.dev");
    }),
  );

  it.effect("shows spend without a bar when the account has no limit or period", () =>
    Effect.gen(function* () {
      const { usage } = yield* read("session=abc", {
        usage: Response.json({
          current_usage: { token_spend: { spend_in_cents: 1234, limit_in_cents: null } },
        }),
        subscription: Response.json({ subscription: null }),
      });
      expect(usage.windows).toEqual([
        {
          id: ZED_SPEND_WINDOW_ID,
          kind: "monthly",
          label: "Spend $12.34, no limit",
          usedPercent: 0,
        },
      ]);
    }),
  );

  it.effect.each([401, 403, 302])("asks to replace an expired session on HTTP %i", (status) =>
    Effect.gen(function* () {
      const { usage } = yield* read("session=abc", { usage: new Response(null, { status }) });
      expect(usage).toMatchObject({
        windows: [],
        unavailable: {
          reason: "probeFailed",
          message: "The Zed dashboard session expired. Replace it in Zed provider settings.",
        },
      });
    }),
  );

  it.effect("reports a read failure for server errors and unexpected payloads", () =>
    Effect.gen(function* () {
      for (const response of [
        new Response(null, { status: 500 }),
        Response.json({ current_usage: { token_spend: {} } }),
      ]) {
        const { usage } = yield* read("session=abc", { usage: response });
        expect(usage).toMatchObject({
          windows: [],
          unavailable: {
            reason: "probeFailed",
            message: "Could not read Zed account spend. Check the Zed dashboard.",
          },
        });
      }
    }),
  );

  it.effect("does not contact Zed without a session", () =>
    Effect.gen(function* () {
      const { usage, requests } = yield* read("   ");
      expect(requests).toEqual([]);
      expect(usage.unavailable?.reason).toBe("unsupported");
    }),
  );
});
