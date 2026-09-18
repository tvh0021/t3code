import {
  AbacusSettings,
  ProviderDriverKind,
  TextGenerationError,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as Option from "effect/Option";
import { ServerConfig } from "../../config.ts";
import * as Schema from "effect/Schema";

import { makeAbacusAdapter } from "../Layers/AbacusAdapter.ts";
import { readAbacusUsageLimits } from "../Layers/abacusUsageLimits.ts";
import { defaultProviderContinuationIdentity, type ProviderDriver } from "../ProviderDriver.ts";
import { withInstanceIdentity } from "./instanceIdentity.ts";
import type { ServerProviderShape } from "../Services/ServerProvider.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";
import { applyUsageLimitsUpdate } from "../providerUsageLimits.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance.ts";
import type * as TextGeneration from "../../textGeneration/TextGeneration.ts";

const decodeAbacusSettings = Schema.decodeSync(AbacusSettings);

export const DRIVER_KIND = ProviderDriverKind.make("abacus");

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

export type AbacusDriverEnv = never;

export const AbacusDriver: ProviderDriver<AbacusSettings, AbacusDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "ChatLLM",
    supportsMultipleInstances: true,
  },
  configSchema: AbacusSettings,
  defaultConfig: (): AbacusSettings => decodeAbacusSettings({}),
  create: ({ instanceId, displayName, accentColor, enabled, config, environment }) =>
    Effect.gen(function* () {
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

      const apiKey =
        environment.find((entry) => entry.name === "ABACUS_API_KEY")?.value.trim() ?? "";
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
      const snapshotShape: ServerProviderShape = {
        resolveMaintenance: () => Effect.succeed(MAINTENANCE_CAPABILITIES),
        getSnapshot: Ref.get(snapshotRef),
        refresh: Effect.gen(function* () {
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
          return updated;
        }),
        streamChanges: Stream.fromEffect(Ref.get(snapshotRef)),
        applyUsageLimits: (update) =>
          Ref.update(snapshotRef, (current) => ({
            ...current,
            usageLimits: applyUsageLimitsUpdate({
              previous: current.usageLimits,
              checkedAt: update.checkedAt,
              update,
            }),
          })),
      };

      const serverConfig = yield* Effect.serviceOption(ServerConfig);
      const stateDir = Option.isSome(serverConfig) ? serverConfig.value.stateDir : undefined;

      const adapter = yield* makeAbacusAdapter({
        apiBaseUrl: config.apiBaseUrl || "https://routellm.abacus.ai/v1",
        apiKey,
        defaultModel: "route-llm",
        instanceId,
        stateDir,
      });

      const unsupportedTextGen = (operation: string) =>
        Effect.fail(
          new TextGenerationError({
            operation,
            detail: `${operation} is not supported directly for ChatLLM`,
          }),
        );

      const textGeneration: TextGeneration.TextGeneration["Service"] = {
        generateCommitMessage: () => unsupportedTextGen("generateCommitMessage"),
        generatePrContent: () => unsupportedTextGen("generatePrContent"),
        generateBranchName: () => unsupportedTextGen("generateBranchName"),
        generateThreadTitle: () => unsupportedTextGen("generateThreadTitle"),
      };

      return {
        instanceId,
        driverKind: DRIVER_KIND,
        continuationIdentity,
        displayName: resolvedDisplayName,
        accentColor,
        enabled,
        snapshot: snapshotShape,
        adapter,
        textGeneration,
      };
    }),
};
