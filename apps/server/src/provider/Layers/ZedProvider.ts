import {
  type ModelCapabilities,
  type ServerProviderModel,
  type ServerProviderSlashCommand,
  type ZedSettings,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  buildServerProvider,
  COMPACT_SLASH_COMMAND,
  isCommandMissingCause,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import { makeUnavailableUsageLimits } from "../providerUsageLimits.ts";
import { buildZedAcpSpawnInput } from "../acp/ZedAcpSupport.ts";

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

const ZED_ACCOUNT_USAGE_UNAVAILABLE_MESSAGE =
  "Zed account spend is unavailable here. Check the Zed dashboard.";

function unavailableZedAccountUsage(checkedAt: string) {
  return makeUnavailableUsageLimits({
    checkedAt,
    reason: "probeFailed",
    message: ZED_ACCOUNT_USAGE_UNAVAILABLE_MESSAGE,
  });
}

export const ZED_BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "zed.dev/claude-sonnet-5",
    name: "Claude Sonnet 5",
    isCustom: false,
    isDefault: true,
    badge: "new",
    capabilities: EMPTY_CAPABILITIES,
  },
  {
    slug: "zed.dev/gpt-5.6-luna",
    name: "GPT-5.6 Luna",
    isCustom: false,
    badge: "new",
    capabilities: EMPTY_CAPABILITIES,
  },
];

const decodeZedCatalog = Schema.decodeSync(
  Schema.fromJsonString(
    Schema.Array(
      Schema.Struct({
        slug: Schema.String,
        name: Schema.String,
      }),
    ),
  ),
);

export function parseLatestZedModels(output: string): ReadonlyArray<ServerProviderModel> {
  const catalog = decodeZedCatalog(output);
  const families = [
    /^zed\.dev\/claude-sonnet-(\d+(?:[.-]\d+)*)(?:-latest)?$/,
    /^zed\.dev\/gpt-(\d+(?:\.\d+)*)-luna(?:-\d{8})?$/,
  ];
  return families.flatMap((family, familyIndex) => {
    const candidates = catalog.flatMap((entry) => {
      const match = family.exec(entry.slug);
      if (!match?.[1]) return [];
      const version = match[1].split(/[.-]/).map(Number);
      const snapshot = version.at(-1);
      if (snapshot !== undefined && snapshot >= 10_000_000) version.pop();
      return [{ slug: entry.slug, name: entry.name, version }];
    });
    candidates.sort((left, right) => {
      for (let index = 0; index < Math.max(left.version.length, right.version.length); index++) {
        const difference = (right.version[index] ?? 0) - (left.version[index] ?? 0);
        if (difference !== 0) return difference;
      }
      return right.slug.localeCompare(left.slug, undefined, { numeric: true });
    });
    const newest = candidates[0];
    return newest
      ? [
          {
            slug: newest.slug,
            name: newest.name,
            isCustom: false,
            ...(familyIndex === 0 ? { isDefault: true } : {}),
            badge: "new",
            capabilities: EMPTY_CAPABILITIES,
          },
        ]
      : [];
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

export function buildInitialZedProviderSnapshot(
  zedSettings: ZedSettings,
): Effect.Effect<ServerProviderDraft> {
  return Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const models = zedModelsFromSettings(zedSettings.customModels);

    if (!zedSettings.enabled) {
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
          usageLimits: unavailableZedAccountUsage(checkedAt),
        },
      });
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
        usageLimits: unavailableZedAccountUsage(checkedAt),
      },
    });
  });
}

export const checkZedProviderStatus = Effect.fn("checkZedProviderStatus")(function* (
  zedSettings: ZedSettings,
  environment: NodeJS.ProcessEnv = process.env,
  cwd?: string,
  previousModels: ReadonlyArray<ServerProviderModel> = ZED_BUILT_IN_MODELS,
): Effect.fn.Return<ServerProviderDraft, never, ChildProcessSpawner.ChildProcessSpawner> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  let models = zedModelsFromSettings(zedSettings.customModels, previousModels);

  if (!zedSettings.enabled) {
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
        usageLimits: unavailableZedAccountUsage(checkedAt),
      },
    });
  }

  const spawnInput = buildZedAcpSpawnInput(zedSettings, cwd ?? process.cwd(), environment);

  const probeResult = yield* spawnAndCollect(
    spawnInput.command,
    ChildProcess.make(spawnInput.command, ["--help"], {
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
          : "Failed to execute Zed ACP server probe.",
        usageLimits: unavailableZedAccountUsage(checkedAt),
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
        const discovered = parseLatestZedModels(result.stdout);
        if (discovered.length !== 2)
          throw new Error("Zed did not supply both Sonnet and Luna models");
        return discovered;
      }),
    ),
    Effect.timeout("40 seconds"),
    Effect.result,
  );
  if (Result.isSuccess(catalogResult)) {
    models = zedModelsFromSettings(zedSettings.customModels, catalogResult.success);
  }

  return buildServerProvider({
    presentation: ZED_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    slashCommands: ZED_SLASH_COMMANDS,
    probe: {
      installed: true,
      version: "0.1.0",
      status: "ready",
      ...(Result.isFailure(catalogResult)
        ? {
            message:
              "Could not refresh Zed models. Keeping the previous list. Sign in to Zed and use a bridge with --list-models support.",
          }
        : {}),
      auth: { status: "authenticated" },
      usageLimits: unavailableZedAccountUsage(checkedAt),
    },
  });
});
