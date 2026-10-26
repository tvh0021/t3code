import {
  type ModelCapabilities,
  type ServerProviderModel,
  type ServerProviderSlashCommand,
  type ServerProviderUsageLimits,
  type ZedSettings,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import {
  buildServerProvider,
  COMPACT_SLASH_COMMAND,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "@t3tools/provider-core/server/snapshotProbe";
import { buildZedAcpSpawnInput } from "./acp/ZedAcpSupport.ts";
import { zedUsageNotYetRead, zedUsageWithoutSession } from "./zedAccountUsage.ts";

export const ZED_PRESENTATION = {
  displayName: "Zed",
  supportsConversationRollback: false,
  badgeLabel: "Preview",
  showInteractionModeToggle: false,
  reportsContextWindow: true,
} as const;

const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

export const ZED_BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "zed.dev/claude-sonnet-5-5",
    name: "Claude Sonnet 5.5",
    subProvider: "Anthropic",
    isCustom: false,
    isDefault: true,
    capabilities: EMPTY_CAPABILITIES,
  },
  {
    slug: "zed.dev/gpt-6-luna",
    name: "GPT-6 Luna",
    subProvider: "OpenAI",
    isCustom: false,
    capabilities: EMPTY_CAPABILITIES,
  },
];

const decodeZedCatalog = Schema.decodeSync(
  Schema.fromJsonString(
    Schema.Array(
      Schema.Struct({
        slug: Schema.String,
        name: Schema.String,
        provider: Schema.optional(Schema.String),
        isDefault: Schema.optional(Schema.Boolean),
        effortLevels: Schema.optional(
          Schema.Array(
            Schema.Struct({
              value: Schema.String,
              name: Schema.String,
              isDefault: Schema.Boolean,
            }),
          ),
        ),
      }),
    ),
  ),
);

export function parseZedModels(output: string): ReadonlyArray<ServerProviderModel> {
  const catalog = decodeZedCatalog(output);
  // Bridges before aa2e090c03 mark no default; Zed lists its preferred model first.
  const hasDefault = catalog.some((entry) => entry.isDefault);
  return catalog.map((entry, index) => {
    const levels = entry.effortLevels ?? [];
    const defaultValue = levels.find((level) => level.isDefault)?.value;
    const capabilities = createModelCapabilities({
      optionDescriptors:
        levels.length > 0
          ? [
              {
                id: "thinking_effort",
                label: "Thinking effort",
                type: "select",
                ...(defaultValue ? { currentValue: defaultValue } : {}),
                options: levels.map((level) => ({
                  id: level.value,
                  label: level.name,
                  isDefault: level.isDefault,
                })),
              },
            ]
          : [],
    });
    return {
      slug: entry.slug,
      name: entry.name,
      ...(entry.provider ? { subProvider: entry.provider } : {}),
      isCustom: false,
      ...((hasDefault ? entry.isDefault : index === 0) ? { isDefault: true } : {}),
      capabilities,
    };
  });
}

export const ZED_SLASH_COMMANDS: ReadonlyArray<ServerProviderSlashCommand> = [
  COMPACT_SLASH_COMMAND,
];

function zedModelsFromSettings(
  customModels: ZedSettings["customModels"],
  builtInModels: ReadonlyArray<ServerProviderModel> = ZED_BUILT_IN_MODELS,
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings(builtInModels, customModels, EMPTY_CAPABILITIES);
}

function buildDisabledZedProviderSnapshot(
  checkedAt: string,
  models: ReadonlyArray<ServerProviderModel>,
): ServerProviderDraft {
  return buildServerProvider({
    presentation: ZED_PRESENTATION,
    enabled: false,
    checkedAt,
    models,
    slashCommands: ZED_SLASH_COMMANDS,
    probe: {
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "Zed is disabled in T3 Code settings.",
    },
  });
}

export const buildInitialZedProviderSnapshot: (
  zedSettings: ZedSettings,
) => Effect.Effect<ServerProviderDraft> = Effect.fn("buildInitialZedProviderSnapshot")(function* (
  zedSettings: ZedSettings,
) {
  const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
  const models = zedModelsFromSettings(zedSettings.customModels);

  if (!zedSettings.enabled) {
    return buildDisabledZedProviderSnapshot(checkedAt, models);
  }

  return buildServerProvider({
    presentation: ZED_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    slashCommands: ZED_SLASH_COMMANDS,
    probe: {
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "Zed discovery has not completed yet.",
      usageLimits: zedSettings.dashboardSession
        ? zedUsageNotYetRead(checkedAt)
        : zedUsageWithoutSession(checkedAt),
    },
  });
});

export const checkZedProviderStatus = Effect.fn("checkZedProviderStatus")(function* (
  zedSettings: ZedSettings,
  environment: NodeJS.ProcessEnv = process.env,
  cwd?: string,
  previousModels: ReadonlyArray<ServerProviderModel> = ZED_BUILT_IN_MODELS,
  // The driver's last dashboard read; probes run on a timer and must not fetch it.
  accountUsage: Effect.Effect<ServerProviderUsageLimits> = Effect.map(DateTime.now, (now) =>
    zedUsageWithoutSession(DateTime.formatIso(now)),
  ),
): Effect.fn.Return<ServerProviderDraft, never, ChildProcessSpawner.ChildProcessSpawner> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  let models = zedModelsFromSettings(zedSettings.customModels, previousModels);

  if (!zedSettings.enabled) {
    return buildDisabledZedProviderSnapshot(checkedAt, models);
  }

  const spawnInput = buildZedAcpSpawnInput(zedSettings, cwd ?? process.cwd(), environment);

  const probeResult = yield* spawnAndCollect(
    spawnInput.command,
    ChildProcess.make(spawnInput.command, ["--version"], {
      cwd: spawnInput.cwd,
      env: spawnInput.env,
      extendEnv: true,
    }),
  ).pipe(Effect.result);

  if (Result.isFailure(probeResult) || probeResult.success.code !== 0) {
    const commandMissing =
      Result.isFailure(probeResult) && isCommandMissingCause(probeResult.failure);
    return buildServerProvider({
      presentation: ZED_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      slashCommands: ZED_SLASH_COMMANDS,
      probe: {
        installed: !commandMissing,
        version: null,
        status: commandMissing ? "warning" : "error",
        auth: { status: "unknown" },
        message: commandMissing
          ? `Zed ACP server binary '${spawnInput.command}' was not found. Configure binaryPath in Zed settings.`
          : "Failed to execute Zed ACP server probe. T3 Code needs zed-acp-server 0.2.1 or later.",
        usageLimits: yield* accountUsage,
      },
    });
  }

  const catalogResult = yield* spawnAndCollect(
    spawnInput.command,
    ChildProcess.make(
      spawnInput.command,
      [
        "--list-models",
        ...(zedSettings.dataDir?.trim() ? ["--data-dir", zedSettings.dataDir.trim()] : []),
      ],
      {
        cwd: spawnInput.cwd,
        env: spawnInput.env,
        extendEnv: true,
      },
    ),
  ).pipe(
    Effect.flatMap((result) =>
      Effect.try(() => {
        if (result.code !== 0) throw new Error("Zed model discovery failed");
        const discovered = parseZedModels(result.stdout);
        if (discovered.length === 0) throw new Error("Zed supplied no models");
        return discovered;
      }),
    ),
    Effect.timeout("40 seconds"),
    Effect.result,
  );
  if (Result.isSuccess(catalogResult)) {
    models = zedModelsFromSettings(zedSettings.customModels, catalogResult.success).map((model) => {
      const authored = zedSettings.customModels.find(
        (entry) => typeof entry !== "string" && entry.slug === model.slug,
      );
      if (!model.isCustom || (typeof authored !== "string" && authored?.capabilities)) return model;
      const discovered = catalogResult.success.find((entry) => entry.slug === model.slug);
      return discovered ? { ...model, capabilities: discovered.capabilities } : model;
    });
  }

  return buildServerProvider({
    presentation: ZED_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    slashCommands: ZED_SLASH_COMMANDS,
    probe: {
      installed: true,
      version: parseGenericCliVersion(probeResult.success.stdout),
      // A warning tells the registry to keep the last discovered catalog.
      status: Result.isFailure(catalogResult) ? "warning" : "ready",
      ...(Result.isFailure(catalogResult)
        ? {
            message:
              "Could not refresh Zed models. Keeping the previous list. Sign in to Zed and use a bridge with --list-models support.",
          }
        : {}),
      auth: { status: "authenticated" },
      usageLimits: yield* accountUsage,
    },
  });
});
