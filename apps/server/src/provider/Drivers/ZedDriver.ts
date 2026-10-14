import { ZedSettings, ProviderDriverKind, TextGenerationError } from "@t3tools/contracts";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import type { ProviderTextGeneration } from "@t3tools/provider-core/server/textGeneration";
import { makeManagedServerProvider } from "@t3tools/provider-core/server/managedProvider";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "@t3tools/provider-core/server/snapshotSettings";
import { makeManualOnlyProviderMaintenanceCapabilities } from "@t3tools/provider-core/server/maintenanceResolver";
import { withInstanceIdentity } from "@t3tools/provider-core/server/instanceIdentity";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "@t3tools/provider-core/server/driver";
import { ProviderDriverError } from "../Errors.ts";
import {
  buildInitialZedProviderSnapshot,
  checkZedProviderStatus,
  ZED_BUILT_IN_MODELS,
} from "../ZedProvider.ts";
import {
  ZedAdapterV2Driver,
  type ZedAdapterV2DriverEnv,
} from "../../orchestration-v2/Adapters/ZedAdapterV2.ts";

const decodeZedSettings = Schema.decodeSync(ZedSettings);

const DRIVER_KIND = ProviderDriverKind.make("zed");
const MAINTENANCE_CAPABILITIES = makeManualOnlyProviderMaintenanceCapabilities({
  provider: DRIVER_KIND,
  packageName: null,
});

export type ZedDriverEnv = ZedAdapterV2DriverEnv;

export const ZedDriver: ProviderDriver<ZedSettings, ZedDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Zed",
    supportsMultipleInstances: true,
  },
  configSchema: ZedSettings,
  defaultConfig: (): ZedSettings => decodeZedSettings({}),
  create: (input) =>
    Effect.gen(function* () {
      const { instanceId, displayName, accentColor, enabled, config } = input;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const host = yield* ProviderHost.ProviderHost;
      const { cwd } = host.paths;

      const continuationIdentity = defaultProviderContinuationIdentity({
        driverKind: DRIVER_KIND,
        instanceId,
      });
      const stampIdentity = withInstanceIdentity({
        instanceId,
        driverKind: DRIVER_KIND,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
      });
      const effectiveConfig = { ...config, enabled } satisfies ZedSettings;

      const orchestrationAdapter = yield* ZedAdapterV2Driver.create(input).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to create Zed adapter: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );

      const unsupportedTextGen = (operation: string) =>
        Effect.fail(
          new TextGenerationError({
            operation,
            detail: `${operation} is not supported directly for Zed`,
          }),
        );

      const textGeneration: ProviderTextGeneration = {
        generateCommitMessage: () => unsupportedTextGen("generateCommitMessage"),
        generatePrContent: () => unsupportedTextGen("generatePrContent"),
        generateBranchName: () => unsupportedTextGen("generateBranchName"),
        generateThreadTitle: () => unsupportedTextGen("generateThreadTitle"),
        generateReviewGuide: () => unsupportedTextGen("generateReviewGuide"),
      };

      let latestModels = ZED_BUILT_IN_MODELS;
      const checkZed = (workspaceCwd: string) =>
        Effect.suspend(() =>
          checkZedProviderStatus(effectiveConfig, process.env, workspaceCwd, latestModels),
        ).pipe(
          Effect.tap((draft) =>
            Effect.sync(() => {
              latestModels = draft.models.filter((model) => !model.isCustom);
            }),
          ),
        );
      const checkProvider = checkZed(cwd).pipe(
        Effect.map(stampIdentity),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );

      const snapshotSettings = yield* makeProviderSnapshotSettingsSource(effectiveConfig);
      const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<ZedSettings>>({
        resolveMaintenance: () => Effect.succeed(MAINTENANCE_CAPABILITIES),
        getSettings: snapshotSettings.getSettings,
        streamSettings: snapshotSettings.streamSettings,
        haveSettingsChanged: haveProviderSnapshotSettingsChanged,
        initialSnapshot: (settings) =>
          buildInitialZedProviderSnapshot(settings.provider).pipe(Effect.map(stampIdentity)),
        checkProvider,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build Zed snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );

      const snapshotForCwd = (workspaceCwd: string) =>
        !effectiveConfig.enabled
          ? snapshot.getSnapshot
          : checkZed(workspaceCwd).pipe(
              Effect.map(stampIdentity),
              Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
            );

      return {
        instanceId,
        driverKind: DRIVER_KIND,
        continuationIdentity,
        displayName,
        accentColor,
        enabled,
        snapshot,
        snapshotForCwd,
        orchestrationAdapter,
        textGeneration,
      } satisfies ProviderInstance;
    }),
};
