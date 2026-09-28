import {
  coordinationLimit,
  coordinationModelKey,
  DEFAULT_COORDINATION_LIMITS,
  IsoDateTime,
  type CoordinationBudget,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { ServerConfig } from "../config.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { UsageService } from "../usage/UsageService.ts";
import { forkParked } from "../serverActivation.ts";

const PolicyFile = Schema.Struct({
  updatedAt: IsoDateTime,
  outputPrices: Schema.Record(Schema.String, Schema.Finite),
});
const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(PolicyFile));
const encode = Schema.encodeEffect(Schema.fromJsonString(PolicyFile));

export class CoordinationPolicyError extends Schema.TaggedError<CoordinationPolicyError>()(
  "CoordinationPolicyError",
  { message: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {}

export class CoordinationPolicy extends Context.Service<
  CoordinationPolicy,
  {
    readonly read: (
      force?: boolean,
      refreshCatalog?: boolean,
    ) => Effect.Effect<
      { updatedAt: string; budgets: ReadonlyArray<CoordinationBudget> },
      CoordinationPolicyError
    >;
  }
>()("t3/orchestration/CoordinationPolicy") {}

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const providers = yield* ProviderRegistry;
  const instances = yield* ProviderInstanceRegistry;
  const usage = yield* UsageService;
  const settings = yield* ServerSettingsService;
  const lock = yield* Semaphore.make(1);
  const file = path.join(config.stateDir, "coordination-policy.json");
  let cached: typeof PolicyFile.Type | undefined;
  const read = Effect.fn("CoordinationPolicy.read")(
    function* (force = false, refreshCatalog = true) {
      const now = DateTime.formatIso(yield* DateTime.now);
      if (!cached)
        cached = yield* fs.readFileString(file).pipe(
          Effect.flatMap(decode),
          Effect.catch(() => Effect.succeed(undefined)),
        );
      if (force || !cached || cached.updatedAt.slice(0, 7) !== now.slice(0, 7)) {
        const catalog = yield* providers.getProviders;
        for (const instance of refreshCatalog ? yield* instances.listInstances : []) {
          if (
            !catalog.some(
              (provider) =>
                provider.instanceId === instance.instanceId &&
                provider.enabled &&
                provider.installed,
            )
          )
            continue;
          if (instance.refreshModels)
            yield* instance.refreshModels().pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("Monthly coordination model refresh failed", {
                  instanceId: instance.instanceId,
                  cause,
                }),
              ),
            );
          yield* providers.refreshInstance(instance.instanceId);
        }
        const pricing = yield* usage.refreshRates;
        const outputPrices = yield* usage.readOutputPrices;
        if (force && pricing.status !== "fresh")
          return yield* new CoordinationPolicyError({
            message: "Pricing refresh failed. The previous model policy remains available.",
          });
        if (pricing.status === "fresh" || !cached) {
          const next = {
            updatedAt:
              pricing.status === "fresh" ? now : (pricing.fetchedAt ?? "1970-01-01T00:00:00.000Z"),
            outputPrices,
          };
          yield* fs.makeDirectory(config.stateDir, { recursive: true });
          yield* fs.writeFileString(`${file}.tmp`, yield* encode(next));
          yield* fs.rename(`${file}.tmp`, file);
          cached = next;
        }
      }
      const overrides = {
        ...DEFAULT_COORDINATION_LIMITS,
        ...Object.fromEntries(
          Object.entries((yield* settings.getSettings).coordinationModelLimits ?? {}).map(
            ([model, limit]) => [coordinationModelKey(model), limit],
          ),
        ),
      };
      const catalog = yield* providers.getProviders;
      const keys = new Set([
        ...Object.keys(overrides),
        ...catalog.flatMap((provider) =>
          provider.models.map((model) => coordinationModelKey(model.slug)),
        ),
      ]);
      const prices = new Map(
        Object.entries(cached.outputPrices).map(([model, price]) => [
          coordinationModelKey(model),
          price,
        ]),
      );
      return {
        updatedAt: cached.updatedAt,
        budgets: [...keys].flatMap((model) => {
          const limit = coordinationLimit(model, prices.get(model), overrides);
          return limit === undefined ? [] : [{ model, limit, used: 0 }];
        }),
      };
    },
    (effect) =>
      lock.withPermit(effect).pipe(
        Effect.mapError(
          (cause) =>
            new CoordinationPolicyError({
              message: "Could not refresh coordination model policy.",
              cause,
            }),
        ),
      ),
  );
  // This only refreshes metadata. Running workflows keep their captured limits and counters.
  yield* forkParked(
    read().pipe(Effect.ignoreCause, Effect.repeat(Schedule.spaced("1 day")), Effect.asVoid),
  );
  return { read };
});

export const layer = Layer.effect(CoordinationPolicy, make);
export const layerTest = Layer.succeed(CoordinationPolicy, {
  read: () =>
    Effect.succeed({
      updatedAt: "2026-09-27T00:00:00.000Z",
      budgets: Object.entries(DEFAULT_COORDINATION_LIMITS).map(([model, limit]) => ({
        model,
        limit,
        used: 0,
      })),
    }),
});
