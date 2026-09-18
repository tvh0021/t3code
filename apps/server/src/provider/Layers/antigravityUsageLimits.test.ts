// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off cryptoRandomUUID:off cryptoRandomUUIDInEffect:off globalDate:off globalTimersInEffect:off unknownInEffectCatch:off anyUnknownInErrorContext:off
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import {
  antigravityQuotaSummaryToLimits,
  readAntigravityUsageLimits,
  type AntigravityRetrieveUserQuotaSummaryResponse,
} from "./antigravityUsageLimits.ts";

describe("antigravityUsageLimits", () => {
  describe("antigravityQuotaSummaryToLimits", () => {
    it("transforms valid quota response into 4 distinct usage windows", () => {
      const checkedAt = "2026-09-18T05:00:00.000Z";
      const sampleResponse: AntigravityRetrieveUserQuotaSummaryResponse = {
        groups: [
          {
            displayName: "Gemini Models",
            description: "Models within this group: Gemini Flash, Gemini Pro",
            buckets: [
              {
                bucketId: "gemini-weekly",
                displayName: "Weekly Limit Remaining",
                window: "weekly",
                remainingFraction: 0.6329434,
                resetTime: "2026-09-23T03:38:22Z",
              },
              {
                bucketId: "gemini-5h",
                displayName: "Five Hour Limit Remaining",
                window: "5h",
                remainingFraction: 0.3473066,
                resetTime: "2026-09-18T08:31:22Z",
              },
            ],
          },
          {
            displayName: "Claude and GPT models",
            description: "Models within this group: Claude Opus, Claude Sonnet, GPT-OSS",
            buckets: [
              {
                bucketId: "3p-weekly",
                displayName: "Weekly Limit Remaining",
                window: "weekly",
                remainingFraction: 0.39579105,
                resetTime: "2026-09-22T04:37:03Z",
              },
              {
                bucketId: "3p-5h",
                displayName: "Five Hour Limit Remaining",
                window: "5h",
                remainingFraction: 0.1371068,
                resetTime: "2026-09-18T07:58:34Z",
              },
            ],
          },
        ],
      };

      const limits = antigravityQuotaSummaryToLimits(sampleResponse, checkedAt);

      expect(limits.checkedAt).toBe(checkedAt);
      expect(limits.windows).toHaveLength(4);

      const geminiWeekly = limits.windows.find((w) => w.id === "gemini-weekly");
      expect(geminiWeekly).toBeDefined();
      expect(geminiWeekly?.kind).toBe("weekly");
      expect(geminiWeekly?.label).toBe("Gemini (Weekly)");
      expect(geminiWeekly?.usedPercent).toBeCloseTo(36.71, 1);
      expect(geminiWeekly?.windowDurationMins).toBe(10080);
      expect(geminiWeekly?.resetsAt).toBe("2026-09-23T03:38:22.000Z");

      const gemini5h = limits.windows.find((w) => w.id === "gemini-5h");
      expect(gemini5h).toBeDefined();
      expect(gemini5h?.kind).toBe("session");
      expect(gemini5h?.label).toBe("Gemini (5-Hour)");
      expect(gemini5h?.usedPercent).toBeCloseTo(65.27, 1);
      expect(gemini5h?.windowDurationMins).toBe(300);
      expect(gemini5h?.resetsAt).toBe("2026-09-18T08:31:22.000Z");

      const thirdPartyWeekly = limits.windows.find((w) => w.id === "3p-weekly");
      expect(thirdPartyWeekly).toBeDefined();
      expect(thirdPartyWeekly?.kind).toBe("weekly");
      expect(thirdPartyWeekly?.label).toBe("Claude/GPT (Weekly)");
      expect(thirdPartyWeekly?.usedPercent).toBeCloseTo(60.42, 1);
      expect(thirdPartyWeekly?.windowDurationMins).toBe(10080);
      expect(thirdPartyWeekly?.resetsAt).toBe("2026-09-22T04:37:03.000Z");

      const thirdParty5h = limits.windows.find((w) => w.id === "3p-5h");
      expect(thirdParty5h).toBeDefined();
      expect(thirdParty5h?.kind).toBe("session");
      expect(thirdParty5h?.label).toBe("Claude/GPT (5-Hour)");
      expect(thirdParty5h?.usedPercent).toBeCloseTo(86.29, 1);
      expect(thirdParty5h?.windowDurationMins).toBe(300);
      expect(thirdParty5h?.resetsAt).toBe("2026-09-18T07:58:34.000Z");
    });

    it("clamps percentages and handles boundary values", () => {
      const checkedAt = "2026-09-18T05:00:00.000Z";
      const sampleResponse: AntigravityRetrieveUserQuotaSummaryResponse = {
        buckets: [
          {
            bucketId: "gemini-5h",
            window: "5h",
            remainingFraction: 1.5, // should clamp to 0% used
          },
          {
            bucketId: "gemini-weekly",
            window: "weekly",
            remainingFraction: -0.2, // should clamp to 100% used
          },
        ],
      };

      const limits = antigravityQuotaSummaryToLimits(sampleResponse, checkedAt);
      expect(limits.windows).toHaveLength(2);
      expect(limits.windows[0]?.usedPercent).toBe(0);
      expect(limits.windows[1]?.usedPercent).toBe(100);
    });

    it("returns unsupported unavailable limits when no buckets are present", () => {
      const checkedAt = "2026-09-18T05:00:00.000Z";
      const limits = antigravityQuotaSummaryToLimits({}, checkedAt);
      expect(limits.windows).toHaveLength(0);
      expect(limits.unavailable?.reason).toBe("unsupported");
    });
  });

  describe("readAntigravityUsageLimits", () => {
    it.effect("returns unsupported for non-personal auth method", () =>
      Effect.gen(function* () {
        const limits = yield* readAntigravityUsageLimits({
          tokenPath: "/tmp/fake_token.json",
          authMethod: "gemini-api-key",
        });
        expect(limits.windows).toHaveLength(0);
        expect(limits.unavailable?.reason).toBe("unsupported");
      }).pipe(Effect.provide(NodeServices.layer)),
    );
  });

  describe("readAntigravityUsageLimits with FileSystem", () => {
    it.effect("returns probeFailed if token file does not exist", () =>
      Effect.gen(function* () {
        const limits = yield* readAntigravityUsageLimits({
          tokenPath: "/tmp/non_existent_token_12345.json",
          authMethod: "oauth-personal",
        });
        expect(limits.windows).toHaveLength(0);
        expect(limits.unavailable?.reason).toBe("probeFailed");
        expect(limits.unavailable?.message).toContain("No Antigravity credentials file found");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    );

    it.effect("fetches quota summary and caches access token", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const testDir = yield* fs.makeTempDirectoryScoped();
        const tokenPath = `${testDir}/acp_token.json`;

        yield* fs.writeFileString(
          tokenPath,
          JSON.stringify({
            client_id: "test-client-id",
            client_secret: "test-client-secret",
            refresh_token: "test-refresh-token",
            project_id: "test-project-123",
          }),
        );

        let refreshCallCount = 0;
        let quotaCallCount = 0;

        const mockFetch: typeof globalThis.fetch = async (input, init) => {
          const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

          if (url.includes("oauth2.googleapis.com/token")) {
            refreshCallCount++;
            return new Response(
              JSON.stringify({
                access_token: "test-access-token-xyz",
                expires_in: 3600,
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }

          if (url.includes("retrieveUserQuotaSummary")) {
            quotaCallCount++;
            const body = JSON.parse(init?.body as string);
            expect(body.project).toBe("test-project-123");
            return new Response(
              JSON.stringify({
                groups: [
                  {
                    displayName: "Gemini Models",
                    buckets: [
                      {
                        bucketId: "gemini-5h",
                        window: "5h",
                        remainingFraction: 0.5,
                        resetTime: "2026-09-18T08:31:22Z",
                      },
                    ],
                  },
                ],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }

          return new Response("Not found", { status: 404 });
        };

        // First call: refreshes token
        const limits1 = yield* readAntigravityUsageLimits({
          tokenPath,
          authMethod: "oauth-personal",
          fetch: mockFetch,
        });

        expect(limits1.windows).toHaveLength(1);
        expect(limits1.windows[0]?.id).toBe("gemini-5h");
        expect(limits1.windows[0]?.label).toBe("Gemini (5-Hour)");
        expect(limits1.windows[0]?.usedPercent).toBe(50);
        expect(refreshCallCount).toBe(1);
        expect(quotaCallCount).toBe(1);

        // Second call: uses cached token, does not refresh again
        const limits2 = yield* readAntigravityUsageLimits({
          tokenPath,
          authMethod: "oauth-personal",
          fetch: mockFetch,
        });

        expect(limits2.windows).toHaveLength(1);
        expect(refreshCallCount).toBe(1);
        expect(quotaCallCount).toBe(2);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    );

    it.effect("handles HTTP error during quota retrieval", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const testDir = yield* fs.makeTempDirectoryScoped();
        const tokenPath = `${testDir}/acp_token.json`;

        yield* fs.writeFileString(
          tokenPath,
          JSON.stringify({
            client_id: "test-client-id",
            client_secret: "test-client-secret",
            refresh_token: "test-refresh-token",
          }),
        );

        const mockFetch: typeof globalThis.fetch = async (input) => {
          const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          if (url.includes("oauth2.googleapis.com/token")) {
            return new Response(
              JSON.stringify({
                access_token: "test-access-token",
                expires_in: 3600,
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          if (url.includes("loadCodeAssist")) {
            return new Response(JSON.stringify({ cloudaicompanionProject: "test-project" }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response("Server error", { status: 500 });
        };

        const limits = yield* readAntigravityUsageLimits({
          tokenPath,
          authMethod: "oauth-personal",
          fetch: mockFetch,
        });

        expect(limits.windows).toHaveLength(0);
        expect(limits.unavailable?.reason).toBe("probeFailed");
        expect(limits.unavailable?.message).toContain("500");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    );
  });
});
