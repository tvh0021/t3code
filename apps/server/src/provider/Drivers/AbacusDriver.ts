import {
  AbacusSettings,
  ABACUS_DEFAULT_API_BASE_URL,
  ProviderDriverKind,
  TextGenerationError,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";

import type { ProviderTextGeneration } from "@t3tools/provider-core/server/textGeneration";
import { readAbacusModels } from "../abacusModels.ts";
import { readAbacusUsageLimits } from "../abacusUsageLimits.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "@t3tools/provider-core/server/driver";
import { ProviderDriverError } from "../Errors.ts";
import { withInstanceIdentity } from "@t3tools/provider-core/server/instanceIdentity";
import type { ManagedServerProvider } from "@t3tools/provider-core/server/snapshot";
import type { ServerProviderDraft } from "@t3tools/provider-core/server/snapshotProbe";
import { applyUsageLimitsUpdate } from "@t3tools/provider-core/server/usageLimits";
import { makeManualOnlyProviderMaintenanceCapabilities } from "@t3tools/provider-core/server/maintenanceResolver";
import {
  AbacusAdapterV2Driver,
  type AbacusAdapterV2DriverEnv,
} from "../../orchestration-v2/Adapters/AbacusAdapterV2.ts";

const decodeAbacusSettings = Schema.decodeSync(AbacusSettings);

const DRIVER_KIND = ProviderDriverKind.make("abacus");

export const ABACUS_BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "route-llm",
    name: "route-llm",
    isDefault: true,
    isCustom: false,
    capabilities: createModelCapabilities({ optionDescriptors: [] }),
  },
];

const MAINTENANCE_CAPABILITIES = makeManualOnlyProviderMaintenanceCapabilities({
  provider: DRIVER_KIND,
  packageName: null,
});
const MODEL_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1_000;
const MODEL_REFRESH_CHECK_INTERVAL = "1 hour";

export type AbacusDriverEnv = never;

export const AbacusDriver: ProviderDriver<AbacusSettings, AbacusDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "ChatLLM",
    supportsMultipleInstances: true,
  },
  configSchema: AbacusSettings,
  defaultConfig: (): AbacusSettings => decodeAbacusSettings({}),
  create: Effect.fn("AbacusDriver.create")(function* (input) {
    const { instanceId, displayName, accentColor, enabled, config, environment } = input;
    const resolvedDisplayName =
      displayName && displayName.trim().toLowerCase() !== "abacus" ? displayName : "ChatLLM";
    const continuationIdentity = defaultProviderContinuationIdentity({
      driverKind: DRIVER_KIND,
      instanceId,
    });
    const stampIdentity = withInstanceIdentity({
      instanceId,
      driverKind: DRIVER_KIND,
      displayName: resolvedDisplayName,
      accentColor,
      continuationGroupKey: continuationIdentity.continuationKey,
    });

    const customModelEntries: ServerProviderModel[] = (config.customModels ?? [])
      .map((entry) => (typeof entry === "string" ? { slug: entry, name: entry } : entry))
      .filter((entry) => !ABACUS_BUILT_IN_MODELS.some((m) => m.slug === entry.slug))
      .map((entry) => ({
        slug: entry.slug,
        name: entry.name || entry.slug,
        isCustom: true,
        capabilities: createModelCapabilities({ optionDescriptors: [] }),
      }));
    const models = [...ABACUS_BUILT_IN_MODELS, ...customModelEntries];

    const apiKey = environment.find((entry) => entry.name === "ABACUS_API_KEY")?.value.trim() ?? "";
    const sessionCookie =
      config.sessionCookie?.trim() ||
      environment.find((entry) => entry.name === "ABACUS_SESSION_COOKIE")?.value.trim() ||
      "";

    const now = yield* DateTime.now;
    const checkedAt = DateTime.formatIso(now);

    const usageLimits =
      apiKey || sessionCookie
        ? yield* readAbacusUsageLimits({
            apiKey,
            sessionCookie,
          }).pipe(Effect.orElseSucceed(() => undefined))
        : undefined;

    const draft: ServerProviderDraft = {
      enabled,
      status: "ready",
      installed: true,
      auth: { status: "unknown" },
      models,
      checkedAt,
      slashCommands: [],
      skills: [],
      version: null,
      supportsTextGeneration: true,
      ...(usageLimits ? { usageLimits } : {}),
    };

    const rawSnapshot: ServerProvider = stampIdentity(draft);

    const snapshotRef = yield* Ref.make(rawSnapshot);
    const changes = yield* PubSub.unbounded<ServerProvider>();
    const lastModelRefreshAt = yield* Ref.make<number | null>(null);
    const refreshModels = Effect.fn("AbacusDriver.refreshModels")(function* () {
      if (!apiKey) return;
      const discovered = yield* readAbacusModels({
        apiBaseUrl: config.apiBaseUrl || ABACUS_DEFAULT_API_BASE_URL,
        apiKey,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: "Could not refresh ChatLLM models. The previous model list is unchanged.",
              cause,
            }),
        ),
      );
      const discoveredSlugs = new Set(discovered.map((model) => model.slug));
      const updated = yield* Ref.updateAndGet(snapshotRef, (current) => ({
        ...current,
        models: [
          ...ABACUS_BUILT_IN_MODELS,
          ...discovered.filter(
            (model) => !ABACUS_BUILT_IN_MODELS.some((builtIn) => builtIn.slug === model.slug),
          ),
          ...customModelEntries.filter((model) => !discoveredSlugs.has(model.slug)),
        ],
      }));
      yield* PubSub.publish(changes, updated);
      const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
      yield* Ref.set(lastModelRefreshAt, nowMs);
    });
    const refreshModelsIfDue = Effect.gen(function* () {
      const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
      const lastRefreshMs = yield* Ref.get(lastModelRefreshAt);
      if (
        enabled &&
        apiKey &&
        (lastRefreshMs === null || nowMs - lastRefreshMs >= MODEL_REFRESH_INTERVAL_MS)
      ) {
        yield* Ref.set(lastModelRefreshAt, nowMs);
        yield* refreshModels().pipe(Effect.orElseSucceed(() => undefined));
      }
    });
    if (enabled && apiKey) {
      yield* Effect.gen(function* () {
        yield* Effect.sleep("1 minute");
        yield* refreshModelsIfDue;
        return yield* Effect.forever(
          Effect.sleep(MODEL_REFRESH_CHECK_INTERVAL).pipe(Effect.andThen(refreshModelsIfDue)),
        );
      }).pipe(Effect.forkScoped);
    }
    const snapshotShape: ManagedServerProvider = {
      resolveMaintenance: () => Effect.succeed(MAINTENANCE_CAPABILITIES),
      getSnapshot: Ref.get(snapshotRef),
      refresh: Effect.gen(function* () {
        yield* refreshModelsIfDue;
        const current = yield* Ref.get(snapshotRef);
        if (!apiKey && !sessionCookie) {
          return current;
        }
        const freshLimits = yield* readAbacusUsageLimits({
          apiKey,
          sessionCookie,
        }).pipe(Effect.orElseSucceed(() => current.usageLimits));
        const updated: ServerProvider = {
          ...current,
          usageLimits: freshLimits,
        };
        yield* Ref.set(snapshotRef, updated);
        yield* PubSub.publish(changes, updated);
        return updated;
      }),
      get streamChanges() {
        return Stream.concat(Stream.fromEffect(Ref.get(snapshotRef)), Stream.fromPubSub(changes));
      },
      applyUsageLimits: Effect.fn("AbacusDriver.applyUsageLimits")(function* (update) {
        const updated = yield* Ref.updateAndGet(snapshotRef, (current) => ({
          ...current,
          usageLimits: applyUsageLimitsUpdate({
            previous: current.usageLimits,
            checkedAt: update.checkedAt,
            update,
          }),
        }));
        yield* PubSub.publish(changes, updated);
      }),
    };

    const orchestrationAdapter = yield* AbacusAdapterV2Driver.create(input).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderDriverError({
            driver: DRIVER_KIND,
            instanceId,
            detail: `Failed to create ChatLLM adapter: ${cause.message ?? String(cause)}`,
            cause,
          }),
      ),
    );

    const unsupportedTextGen = (operation: string) =>
      Effect.fail(
        new TextGenerationError({
          operation,
          detail: `${operation} is not supported directly for ChatLLM`,
        }),
      );

    const textGeneration: ProviderTextGeneration = {
      generateCommitMessage: () => unsupportedTextGen("generateCommitMessage"),
      generatePrContent: () => unsupportedTextGen("generatePrContent"),
      generateBranchName: () => unsupportedTextGen("generateBranchName"),
      generateThreadTitle: () => unsupportedTextGen("generateThreadTitle"),
      generateReviewGuide: () => unsupportedTextGen("generateReviewGuide"),
    };

    return {
      instanceId,
      driverKind: DRIVER_KIND,
      continuationIdentity,
      displayName: resolvedDisplayName,
      accentColor,
      enabled,
      snapshot: snapshotShape,
      refreshModels,
      orchestrationAdapter,
      textGeneration,
    } satisfies ProviderInstance;
  }),
};
