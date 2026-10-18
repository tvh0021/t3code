// @effect-diagnostics nodeBuiltinImport:off - isolated temporary cache files for scanner tests
import { describe, expect, it } from "@effect/vitest";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { ProviderInstanceId, ZedSettings } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";
import { makeZedUsageScanner, mergeZedUsage, zedUsageModel, zedUsageRecords } from "./zedUsage.ts";

const day = (date = "2026-10-17", input = 336) => ({
  date,
  tokens: {
    input,
    input_cache_creation: 124725,
    input_cache_read: 28950,
    output: 392,
    total: input + 124725 + 28950 + 392,
  },
  cost_in_cents: 1.77206975,
  spend_in_cents: 0,
});
const usage = () => ({ usage_by_model: { "GPT-6 Luna": [day()] } });
const decodeSettings = Schema.decodeSync(ZedSettings);
const instance = (id = "zed", session = "session=test-secret") => ({
  instanceId: ProviderInstanceId.make(id),
  configured: true,
  environment: {},
  config: decodeSettings({ dashboardSession: session }),
});
const fixture = Effect.gen(function* () {
  const dir = yield* Effect.promise(() =>
    NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-zed-usage-")),
  );
  yield* Effect.addFinalizer(() =>
    Effect.promise(() => NodeFSP.rm(dir, { recursive: true, force: true })),
  );
  return dir;
});

describe("Zed account model usage", () => {
  it("preserves disjoint categories and raw cost even when allowance spend is zero", () => {
    const record = zedUsageRecords(usage(), "account")[0]!;
    expect(record.model).toBe("zed.dev/gpt-6-luna");
    expect(record.reportedCostUsd).toBeCloseTo(0.0177206975);
    expect(record.totals).toEqual({
      uncachedInputTokens: 336,
      cachedInputTokens: 28950,
      cacheCreationTokens: 124725,
      outputTokens: 392,
      reasoningTokens: 0,
    });
    expect(record.billingDay).toBe("2026-10-17");
    expect(record.sessionId).toBe("");
    expect(zedUsageModel("Claude Sonnet 5.5")).toBe("zed.dev/claude-sonnet-5-5");
    expect(zedUsageModel("zed.dev/claude-sonnet-5-5")).toBe("zed.dev/claude-sonnet-5-5");
    expect(zedUsageRecords({ usage_by_model: { model: [day("2026-02-30")] } }, "account")).toEqual(
      [],
    );
  });

  it("replaces refreshed days, removes disappeared models for those days, and retains older history", () => {
    const before = { usage_by_model: { "GPT-6 Luna": [day("2026-10-16"), day()], old: [day()] } };
    const merged = mergeZedUsage(before, {
      usage_by_model: { "GPT-6 Luna": [day("2026-10-17", 1)] },
    });
    expect(merged.usage_by_model["GPT-6 Luna"]?.map((row) => row.tokens.input)).toEqual([336, 1]);
    expect(merged.usage_by_model.old).toEqual([]);
  });

  it.effect(
    "reads only billing GETs, throttles refreshes, persists snapshots, and deduplicates account instances",
    () =>
      Effect.gen(function* () {
        const dir = yield* fixture;
        const requests: string[] = [];
        let current = usage();
        const http = HttpClient.make((request, _url, _signal, fiber) =>
          Effect.sync(() => {
            expect(request.method).toBe("GET");
            expect(request.headers.cookie).toBe("session=test-secret");
            expect(
              Context.getOrUndefined(fiber.context, FetchHttpClient.RequestInit)?.redirect,
            ).toBe("manual");
            requests.push(request.url);
            return HttpClientResponse.fromWeb(
              request,
              Response.json(
                request.url.endsWith("/session")
                  ? {
                      organizations: [
                        { id: "org-personal", is_personal: true },
                        { id: "org-team", is_personal: false },
                      ],
                    }
                  : current,
              ),
            );
          }),
        );
        const scan = yield* makeZedUsageScanner(dir).pipe(
          Effect.provideService(HttpClient.HttpClient, http),
        );
        const sources = yield* scan([instance(), instance("second")]);
        expect(sources).toHaveLength(1);
        expect(sources[0]?.files?.[0]?.records).toHaveLength(1);
        expect(requests).toEqual([
          "https://cloud.zed.dev/frontend/session",
          "https://cloud.zed.dev/frontend/organizations/org-personal/billing/usage/tokens",
        ]);
        expect((yield* scan([instance()], "hour"))[0]).toMatchObject({
          status: "partial",
          files: [{ records: [] }],
        });
        expect(requests).toHaveLength(2);
        current = { usage_by_model: { "GPT-6 Luna": [day("2026-10-18", 10)] } };
        yield* TestClock.adjust("1 minute");
        expect((yield* scan([instance()]))[0]?.files?.[0]?.records).toHaveLength(2);
        const saved = yield* Effect.promise(() =>
          NodeFSP.readFile(NodePath.join(dir, "usage-zed-accounts.json"), "utf8"),
        );
        expect(saved).not.toContain("test-secret");
        const restored = yield* makeZedUsageScanner(dir).pipe(
          Effect.provideService(HttpClient.HttpClient, http),
        );
        expect((yield* restored([instance()]))[0]?.files?.[0]?.records).toHaveLength(2);
        const secondScanner = yield* makeZedUsageScanner(dir).pipe(
          Effect.provideService(HttpClient.HttpClient, http),
        );
        const secondSource = (yield* secondScanner([instance()]))[0]!;
        expect(secondSource.hostId).toBe(sources[0]?.hostId);
        expect(secondSource.volumeId).toBe(sources[0]?.volumeId);
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "reports missing and expired sessions without fabricating zero usage or following redirects",
    () =>
      Effect.gen(function* () {
        const dir = yield* fixture;
        let calls = 0;
        const http = HttpClient.make((request) =>
          Effect.sync(() => {
            calls++;
            return HttpClientResponse.fromWeb(
              request,
              new Response(null, { status: 302, headers: { Location: "https://example.com" } }),
            );
          }),
        );
        const scan = yield* makeZedUsageScanner(dir).pipe(
          Effect.provideService(HttpClient.HttpClient, http),
        );
        expect((yield* scan([instance("missing", "")]))[0]?.status).toBe("missing");
        expect(calls).toBe(0);
        expect((yield* scan([instance()]))[0]).toMatchObject({
          status: "failed",
          message: expect.stringContaining("expired"),
        });
        yield* scan([instance()]);
        expect(calls).toBe(1);
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "retains the previous snapshot on malformed responses and retries only after the refresh floor",
    () =>
      Effect.gen(function* () {
        const dir = yield* fixture;
        let broken = false;
        const http = HttpClient.make((request) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              Response.json(
                request.url.endsWith("/session")
                  ? { organizations: [{ id: "org-personal", is_personal: true }] }
                  : broken
                    ? {
                        usage_by_model: {
                          model: [{ ...day(), tokens: { ...day().tokens, input: -1 } }],
                        },
                      }
                    : usage(),
              ),
            ),
          ),
        );
        const scan = yield* makeZedUsageScanner(dir).pipe(
          Effect.provideService(HttpClient.HttpClient, http),
        );
        yield* scan([instance()]);
        broken = true;
        yield* TestClock.adjust("1 minute");
        const source = (yield* scan([instance()]))[0]!;
        expect(source.status).toBe("partial");
        expect(source.files?.[0]?.records).toHaveLength(1);
      }).pipe(Effect.provide(NodeServices.layer)),
  );
});
