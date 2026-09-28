// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Exit from "effect/Exit";
import * as Context from "effect/Context";
import { CoordinationPolicy, layer } from "./CoordinationPolicy.ts";
import { ServerConfig } from "../config.ts";
import { ServerActivation } from "../serverActivation.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import { UsageService } from "../usage/UsageService.ts";

it.effect(
  "refreshes stale monthly pricing, retains named/user limits, and retries failed maintenance without overwriting the cache",
  () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() =>
        NodeFSP.mkdtemp("/private/tmp/t3-coordination-policy-"),
      );
      let fresh = true;
      let refreshes = 0;
      let prices: Readonly<Record<string, number>> = {
        new: 11,
        cheap: 0.5,
        "claude-sonnet-5": 0.5,
      };
      const catalog: ReadonlyArray<ServerProvider> = [
        {
          instanceId: ProviderInstanceId.make("codex"),
          driver: ProviderDriverKind.make("codex"),
          enabled: true,
          installed: true,
          version: null,
          status: "ready",
          auth: { status: "authenticated" },
          checkedAt: "2026-09-27T00:00:00.000Z",
          slashCommands: [],
          skills: [],
          models: ["new", "cheap", "unpriced"].map((slug) => ({
            slug,
            name: slug,
            isCustom: false,
            capabilities: null,
          })),
        },
      ];
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(
        layer.pipe(
          Layer.provideMerge(ServerConfig.layerTest(process.cwd(), root)),
          Layer.provide(
            ServerSettingsService.layerTest({ coordinationModelLimits: { "provider/new": 7 } }),
          ),
          Layer.provide(
            Layer.mock(ProviderRegistry)({
              getProviders: Effect.succeed(catalog),
              refreshInstance: () => Effect.succeed(catalog),
            }),
          ),
          Layer.provide(
            Layer.mock(ProviderInstanceRegistry)({ listInstances: Effect.succeed([]) }),
          ),
          Layer.provide(
            Layer.mock(UsageService)({
              refreshRates: Effect.sync(() => {
                refreshes++;
                return {
                  status: fresh ? ("fresh" as const) : ("cached" as const),
                  source: "test",
                  fetchedAt: "2026-09-27T00:00:00.000Z",
                  knownModels: 3,
                };
              }),
              readOutputPrices: Effect.sync(() => prices),
            }),
          ),
          Layer.provide(Layer.succeed(ServerActivation, Effect.never)),
          Layer.provide(NodeServices.layer),
        ),
        scope,
      );
      try {
        const config = Context.get(context, ServerConfig);
        yield* Effect.promise(() => NodeFSP.mkdir(config.stateDir, { recursive: true }));
        const file = `${config.stateDir}/coordination-policy.json`;
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            file,
            '{"updatedAt":"2020-01-01T00:00:00.000Z","outputPrices":{"new":2}}',
          ),
        );
        const policy = Context.get(context, CoordinationPolicy);
        const first = yield* policy.read();
        expect(refreshes).toBe(1);
        expect(first.budgets).toEqual(
          expect.arrayContaining([
            { model: "new", limit: 7, used: 0 },
            { model: "cheap", limit: null, used: 0 },
            { model: "claude-sonnet-5", limit: 1, used: 0 },
          ]),
        );
        expect(first.budgets.some((budget) => budget.model === "unpriced")).toBe(false);
        yield* policy.read();
        expect(refreshes).toBe(1);
        const saved = yield* Effect.promise(() => NodeFSP.readFile(file, "utf8"));
        fresh = false;
        expect((yield* policy.read(true).pipe(Effect.exit))._tag).toBe("Failure");
        expect(yield* Effect.promise(() => NodeFSP.readFile(file, "utf8"))).toBe(saved);
        fresh = true;
        prices = { new: 0.5, cheap: 10, "claude-sonnet-5": 0.5 };
        const next = yield* policy.read(true);
        expect(next.budgets).toEqual(
          expect.arrayContaining([
            { model: "new", limit: 7, used: 0 },
            { model: "cheap", limit: 4, used: 0 },
          ]),
        );
        expect(first.budgets).toContainEqual({ model: "cheap", limit: null, used: 0 });
      } finally {
        yield* Scope.close(scope, Exit.void);
        yield* Effect.promise(() => NodeFSP.rm(root, { recursive: true, force: true }));
      }
    }),
);
