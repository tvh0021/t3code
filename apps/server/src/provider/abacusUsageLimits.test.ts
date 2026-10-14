// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off cryptoRandomUUID:off cryptoRandomUUIDInEffect:off globalDate:off globalTimersInEffect:off unknownInEffectCatch:off anyUnknownInErrorContext:off
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { abacusUsageResponseToLimits, readAbacusUsageLimits } from "./abacusUsageLimits.ts";

describe("abacusUsageLimits", () => {
  describe("abacusUsageResponseToLimits", () => {
    it("transforms valid compute points response into monthly usage window with billing info", () => {
      const checkedAt = "2026-09-17T21:00:00.000Z";
      const limits = abacusUsageResponseToLimits(
        {
          success: true,
          result: {
            totalComputePoints: 30000,
            computePointsLeft: 24850,
          },
        },
        checkedAt,
        {
          success: true,
          result: {
            subscriptionStartTime: "2026-09-12T03:59:37+00:00",
            nextBillingDate: "2026-10-12T03:59:37+00:00",
          },
        },
      );

      expect(limits.checkedAt).toBe(checkedAt);
      expect(limits.windows).toHaveLength(1);
      const window = limits.windows[0]!;
      expect(window.id).toBe("abacus_monthly_credits");
      expect(window.kind).toBe("monthly");
      expect(window.label).toBe("Monthly (24,850 / 30,000 credits left)");
      // Used = 30000 - 24850 = 5150. Percent = 5150 / 30000 = ~17.166%
      expect(window.usedPercent).toBeCloseTo(17.17, 1);
      expect(window.resetsAt).toBe("2026-10-12T03:59:37.000Z");
      expect(window.windowDurationMins).toBe(43200);
    });

    it("falls back to 1st of next month when nextBillingDate is absent", () => {
      const checkedAt = "2026-09-17T21:00:00.000Z";
      const limits = abacusUsageResponseToLimits(
        {
          success: true,
          result: {
            totalComputePoints: 14000,
            computePointsLeft: 49,
          },
        },
        checkedAt,
      );

      expect(limits.windows).toHaveLength(1);
      const window = limits.windows[0]!;
      expect(window.resetsAt).toBe("2026-10-01T00:00:00.000Z");
      expect(window.windowDurationMins).toBe(43200);
    });

    it("handles response with curr_month_avail_points and no total gracefully", () => {
      const checkedAt = "2026-09-17T21:00:00.000Z";
      const limits = abacusUsageResponseToLimits(
        {
          success: true,
          result: {
            curr_month_avail_points: 15200,
          },
        },
        checkedAt,
      );

      expect(limits.windows).toHaveLength(1);
      expect(limits.windows[0]!.label).toBe("Monthly (15,200 credits left)");
      expect(limits.windows[0]!.usedPercent).toBe(0);
    });

    it("returns probeFailed if response contains error", () => {
      const checkedAt = "2026-09-17T21:00:00.000Z";
      const limits = abacusUsageResponseToLimits(
        {
          success: false,
          error: "Unauthorized",
        },
        checkedAt,
      );

      expect(limits.unavailable?.reason).toBe("probeFailed");
      expect(limits.unavailable?.message).toBe("Unauthorized");
    });
  });

  describe("readAbacusUsageLimits", () => {
    it.effect("fetches and decodes compute points and billing info with session cookie", () =>
      Effect.gen(function* () {
        const capturedUrls: string[] = [];
        const capturedHeaders: Record<string, string>[] = [];

        const mockFetch: typeof globalThis.fetch = async (url, init) => {
          capturedUrls.push(String(url));
          capturedHeaders.push((init?.headers ?? {}) as Record<string, string>);
          if (String(url).includes("_getBillingInfo")) {
            return new Response(
              JSON.stringify({
                success: true,
                result: {
                  subscriptionStartTime: "2026-09-12T03:59:37+00:00",
                  nextBillingDate: "2026-10-12T03:59:37+00:00",
                },
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          return new Response(
            JSON.stringify({
              success: true,
              result: {
                totalComputePoints: 20000,
                computePointsLeft: 18500,
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        };

        const limits = yield* readAbacusUsageLimits(
          {
            sessionCookie: "test-session-token",
            fetch: mockFetch,
          },
          {},
        );

        expect(capturedUrls).toContain("https://apps.abacus.ai/api/_getOrganizationComputePoints");
        expect(capturedUrls).toContain("https://apps.abacus.ai/api/_getBillingInfo");
        expect(capturedHeaders[0]!["Cookie"]).toBe("session=test-session-token");
        expect(limits.windows).toHaveLength(1);
        expect(limits.windows[0]!.label).toBe("Monthly (18,500 / 20,000 credits left)");
        expect(limits.windows[0]!.resetsAt).toBe("2026-10-12T03:59:37.000Z");
        expect(limits.windows[0]!.windowDurationMins).toBe(43200);
      }),
    );

    it.effect("fetches and decodes compute points with API key even when billing info fails", () =>
      Effect.gen(function* () {
        let capturedHeaders: Record<string, string> = {};

        const mockFetch: typeof globalThis.fetch = async (url, init) => {
          capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
          if (String(url).includes("_getBillingInfo")) {
            return new Response("Unauthorized", { status: 403, statusText: "Forbidden" });
          }
          return new Response(
            JSON.stringify({
              success: true,
              result: {
                totalComputePoints: 30000,
                computePointsLeft: 30000,
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        };

        const limits = yield* readAbacusUsageLimits(
          {
            apiKey: "my-abacus-api-key",
            fetch: mockFetch,
          },
          {},
        );

        expect(capturedHeaders["apiKey"]).toBe("my-abacus-api-key");
        expect(capturedHeaders["Authorization"]).toBe("Bearer my-abacus-api-key");
        expect(limits.windows).toHaveLength(1);
        expect(limits.windows[0]!.usedPercent).toBe(0);
        // Falls back to next month
        expect(limits.windows[0]!.resetsAt).toBeDefined();
      }),
    );

    it.effect("returns unsupported when no auth credentials exist", () =>
      Effect.gen(function* () {
        const limits = yield* readAbacusUsageLimits({}, {});
        expect(limits.unavailable?.reason).toBe("unsupported");
      }),
    );

    it.effect("handles HTTP errors gracefully with probeFailed", () =>
      Effect.gen(function* () {
        const mockFetch: typeof globalThis.fetch = async () => {
          return new Response("Internal Server Error", {
            status: 500,
            statusText: "Internal Server Error",
          });
        };

        const limits = yield* readAbacusUsageLimits(
          {
            apiKey: "some-key",
            fetch: mockFetch,
          },
          {},
        );

        expect(limits.unavailable?.reason).toBe("probeFailed");
      }),
    );
  });
});
