import { ZedSettings, ProviderDriverKind, TextGenerationError } from "@t3tools/contracts";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as DateTime from "effect/DateTime";
import { HttpClient } from "effect/http";

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
  endedZedPeriod,
  readZedAccountUsage,
  zedUsageNotYetRead,
  zedUsageWithoutSession,
} from "../zedAccountUsage.ts";
import {
  createZedAdapterV2,
  type ZedAdapterV2DriverEnv,
} from "../../orchestration-v2/Adapters/ZedAdapterV2.ts";

const decodeZedSettings = Schema.decodeSync(ZedSettings);

const DRIVER_KIND = ProviderDriverKind.make("zed");
const MAINTENANCE_CAPABILITIES = makeManualOnlyProviderMaintenanceCapabilities({
  provider: DRIVER_KIND,
  packageName: null,
});

export type ZedDriverEnv = ZedAdapterV2DriverEnv | HttpClient.HttpClient;

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
      const httpClient = yield* HttpClient.HttpClient;
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

      // Account spend is read at startup, after Zed prompts, and once when the
      // cached billing period has ended. The periodic status probe otherwise
      // reuses the cached value, so Zed's billing routes see real usage only.
      const dashboardSession = effectiveConfig.dashboardSession;
      const startedAt = DateTime.formatIso(yield* DateTime.now);
      const accountUsage = yield* Ref.make(
        dashboardSession ? zedUsageNotYetRead(startedAt) : zedUsageWithoutSession(startedAt),
      );
      let latestModels = ZED_BUILT_IN_MODELS;
      // Assigned once the snapshot exists; the probe below is built before it.
      let refreshAfterPeriodEnd: Effect.Effect<void> = Effect.void;
      let refreshedForPeriodEnd: string | undefined;
      const refreshIfPeriodEnded = Effect.gen(function* () {
        const ended = endedZedPeriod(
          yield* Ref.get(accountUsage),
          DateTime.toEpochMillis(yield* DateTime.now),
        );
        // Once per period end, so a dashboard that keeps reporting the old
        // period cannot turn the status probe into a poll.
        if (ended === undefined || ended === refreshedForPeriodEnd) return;
        refreshedForPeriodEnd = ended;
        yield* refreshAfterPeriodEnd;
      });
      const checkZed = (workspaceCwd: string) =>
        Effect.suspend(() =>
          checkZedProviderStatus(
            effectiveConfig,
            process.env,
            workspaceCwd,
            latestModels,
            Ref.get(accountUsage),
          ),
        ).pipe(
          Effect.tap((draft) =>
            Effect.sync(() => {
              latestModels = draft.models.filter((model) => !model.isCustom);
            }),
          ),
          Effect.tap(() => refreshIfPeriodEnded),
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

      const readSemaphore = yield* Semaphore.make(1);
      const refreshAccountUsage = readSemaphore.withPermits(1)(
        readZedAccountUsage(dashboardSession).pipe(
          Effect.provideService(HttpClient.HttpClient, httpClient),
          Effect.tap((usage) => Ref.set(accountUsage, usage)),
          Effect.flatMap(snapshot.replaceUsageLimits),
        ),
      );
      const scope = yield* Effect.scope;
      const refreshAccountUsageInBackground = refreshAccountUsage.pipe(
        Effect.forkIn(scope),
        Effect.asVoid,
      );
      if (effectiveConfig.enabled && dashboardSession) {
        refreshAfterPeriodEnd = refreshAccountUsageInBackground;
        yield* refreshAccountUsageInBackground;
      }

      const orchestrationAdapter = yield* createZedAdapterV2(
        input,
        dashboardSession ? { onPromptSettled: refreshAccountUsageInBackground } : {},
      ).pipe(
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
