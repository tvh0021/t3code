import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { mergeProviderSnapshot } from "./Layers/ProviderRegistry.ts";
import * as FileSystem from "effect/FileSystem";
import * as Logger from "effect/Logger";

import {
  hydrateCachedProvider,
  isCachedProviderCorrelated,
  readProviderStatusCache,
  resolveProviderStatusCachePath,
  writeProviderStatusCache,
} from "./providerStatusCache.ts";

const emptyCapabilities = createModelCapabilities({ optionDescriptors: [] });
const CODEX_DRIVER = ProviderDriverKind.make("codex");
const CLAUDE_AGENT_DRIVER = ProviderDriverKind.make("claudeAgent");
const OPENCODE_DRIVER = ProviderDriverKind.make("opencode");

const makeProvider = (
  provider: ProviderDriverKind,
  overrides?: Partial<ServerProvider>,
): ServerProvider => ({
  instanceId: defaultInstanceIdForDriver(provider),
  driver: provider,
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-04-11T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
  ...overrides,
});

it.layer(NodeServices.layer)("providerStatusCache", (it) => {
  it.effect("logs structural diagnostics without retaining invalid cache contents", () => {
    const messages: Array<unknown> = [];
    const logger = Logger.make<unknown, void>((options) => {
      if (Array.isArray(options.message)) {
        messages.push(...options.message);
      } else {
        messages.push(options.message);
      }
    });

    return Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-provider-cache-invalid-" });
      const cachePath = `${tempDir}/provider.json`;
      const secretCacheValue = "secret-cache-value";
      yield* fs.writeFileString(cachePath, `{ "token": "${secretCacheValue}" }`);

      const result = yield* readProviderStatusCache(cachePath);

      assert.strictEqual(result, undefined);
      const failure = messages.find(
        (message): message is Record<string, unknown> =>
          typeof message === "object" && message !== null && "path" in message,
      );
      assert.exists(failure);
      assert.strictEqual(failure.path, cachePath);
      assert.strictEqual(typeof failure.errorTag, "string");
      assert.ok(!("cause" in failure));
      assert.ok(!("issues" in failure));
      assert.ok(!Object.values(failure).map(String).join("\n").includes(secretCacheValue));
    }).pipe(Effect.provide(Logger.layer([logger], { mergeWithExisting: false })));
  });

  it.effect("writes and reads provider status snapshots", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-provider-cache-" });
      const codexProvider = makeProvider(CODEX_DRIVER);
      const claudeProvider = makeProvider(CLAUDE_AGENT_DRIVER, {
        status: "warning",
        auth: { status: "unknown" },
      });
      const openCodeProvider = makeProvider(OPENCODE_DRIVER, {
        status: "warning",
        auth: { status: "unknown", type: "opencode" },
      });
      const codexPath = yield* resolveProviderStatusCachePath({
        cacheDir: tempDir,
        instanceId: defaultInstanceIdForDriver(ProviderDriverKind.make("codex")),
      });
      const claudePath = yield* resolveProviderStatusCachePath({
        cacheDir: tempDir,
        instanceId: defaultInstanceIdForDriver(ProviderDriverKind.make("claudeAgent")),
      });
      const openCodePath = yield* resolveProviderStatusCachePath({
        cacheDir: tempDir,
        instanceId: defaultInstanceIdForDriver(ProviderDriverKind.make("opencode")),
      });

      yield* writeProviderStatusCache({
        filePath: codexPath,
        provider: codexProvider,
      });
      yield* writeProviderStatusCache({
        filePath: claudePath,
        provider: claudeProvider,
      });
      yield* writeProviderStatusCache({
        filePath: openCodePath,
        provider: openCodeProvider,
      });

      assert.deepStrictEqual(yield* readProviderStatusCache(codexPath), codexProvider);
      assert.deepStrictEqual(yield* readProviderStatusCache(claudePath), claudeProvider);
      assert.deepStrictEqual(yield* readProviderStatusCache(openCodePath), openCodeProvider);
    }),
  );

  it("hydrates cached provider status while preserving current settings-derived models", () => {
    const cachedCodex = makeProvider(CODEX_DRIVER, {
      checkedAt: "2026-04-10T12:00:00.000Z",
      models: [
        {
          slug: "gpt-5-mini",
          name: "GPT-5 Mini",
          isCustom: false,
          capabilities: emptyCapabilities,
        },
      ],
      message: "Cached message",
      skills: [
        {
          name: "github:gh-fix-ci",
          path: "/tmp/skills/gh-fix-ci/SKILL.md",
          enabled: true,
          displayName: "CI Debug",
        },
      ],
    });
    const fallbackCodex = makeProvider(CODEX_DRIVER, {
      models: [
        {
          slug: "gpt-5.4",
          name: "GPT-5.4",
          isCustom: false,
          capabilities: emptyCapabilities,
        },
      ],
      message: "Pending refresh",
    });

    assert.deepStrictEqual(
      hydrateCachedProvider({
        cachedProvider: cachedCodex,
        fallbackProvider: fallbackCodex,
      }),
      {
        ...fallbackCodex,
        models: [
          ...fallbackCodex.models,
          {
            slug: "gpt-5-mini",
            name: "GPT-5 Mini",
            isCustom: false,
            capabilities: emptyCapabilities,
          },
        ],
        installed: cachedCodex.installed,
        version: cachedCodex.version,
        status: cachedCodex.status,
        auth: cachedCodex.auth,
        checkedAt: cachedCodex.checkedAt,
        slashCommands: cachedCodex.slashCommands,
        skills: cachedCodex.skills,
        message: cachedCodex.message,
      },
    );
  });

  it("does not resurrect cached custom models that settings no longer declare", () => {
    const builtIn = {
      slug: "gpt-5.4",
      name: "GPT-5.4",
      isCustom: false,
      capabilities: emptyCapabilities,
    } as const;
    const cachedCodex = makeProvider(CODEX_DRIVER, {
      models: [
        builtIn,
        {
          slug: "removed-custom",
          name: "removed-custom",
          isCustom: true,
          capabilities: emptyCapabilities,
        },
      ],
    });
    const fallbackCodex = makeProvider(CODEX_DRIVER, { models: [builtIn] });

    assert.deepStrictEqual(
      hydrateCachedProvider({
        cachedProvider: cachedCodex,
        fallbackProvider: fallbackCodex,
      }).models,
      [builtIn],
    );
  });

  it("ignores stale cached enabled state when the provider is now disabled", () => {
    const cachedCodex = makeProvider(CODEX_DRIVER, {
      checkedAt: "2026-04-10T12:00:00.000Z",
      message: "Cached ready status",
    });
    const disabledFallback = makeProvider(CODEX_DRIVER, {
      enabled: false,
      installed: false,
      version: null,
      status: "disabled",
      auth: { status: "unknown" },
      message: "Codex is disabled in T3 Code settings.",
    });

    assert.deepStrictEqual(
      hydrateCachedProvider({
        cachedProvider: cachedCodex,
        fallbackProvider: disabledFallback,
      }),
      disabledFallback,
    );
  });

  it("rejects cached snapshots that are not correlated to the fallback instance", () => {
    const fallbackCodex = makeProvider(CODEX_DRIVER, {
      models: [
        {
          slug: "gpt-5.4",
          name: "GPT-5.4",
          isCustom: false,
          capabilities: emptyCapabilities,
        },
      ],
    });
    const legacyCachedCodex = {
      provider: ProviderDriverKind.make("codex"),
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-04-10T12:00:00.000Z",
      models: [
        {
          slug: "cached-legacy-model",
          name: "Cached Legacy Model",
          isCustom: false,
          capabilities: emptyCapabilities,
        },
      ],
      slashCommands: [],
      skills: [],
    } as unknown as ServerProvider;
    const mismatchedCachedCodex = makeProvider(CODEX_DRIVER, {
      instanceId: ProviderInstanceId.make("codex_personal"),
    });

    assert.strictEqual(
      isCachedProviderCorrelated({
        cachedProvider: legacyCachedCodex,
        fallbackProvider: fallbackCodex,
      }),
      false,
    );
    assert.deepStrictEqual(
      hydrateCachedProvider({
        cachedProvider: legacyCachedCodex,
        fallbackProvider: fallbackCodex,
      }),
      fallbackCodex,
    );
    assert.strictEqual(
      isCachedProviderCorrelated({
        cachedProvider: mismatchedCachedCodex,
        fallbackProvider: fallbackCodex,
      }),
      false,
    );
    assert.deepStrictEqual(
      hydrateCachedProvider({
        cachedProvider: mismatchedCachedCodex,
        fallbackProvider: fallbackCodex,
      }),
      fallbackCodex,
    );
  });
});

const zedModels = (slugs: string[]) =>
  slugs.map((slug) => ({
    slug,
    name: slug,
    isCustom: false,
    capabilities: emptyCapabilities,
  }));

it("replaces superseded Zed models after hosted discovery", () => {
  const previous = makeProvider(ProviderDriverKind.make("zed"), {
    models: zedModels(["zed.dev/claude-sonnet-5", "zed.dev/gpt-5.6-luna"]),
  });
  const refreshed = {
    ...previous,
    models: zedModels(["zed.dev/claude-sonnet-5-5", "zed.dev/gpt-6-luna"]),
  };
  assert.deepStrictEqual(mergeProviderSnapshot(previous, refreshed).models, refreshed.models);
});

it("hydrates the discovered Zed catalog without resurrecting seed models", () => {
  const fallback = makeProvider(ProviderDriverKind.make("zed"), {
    models: zedModels(["zed.dev/claude-sonnet-5", "zed.dev/gpt-5.6-luna"]),
  });
  const cached = {
    ...fallback,
    models: zedModels(["zed.dev/claude-sonnet-5-5", "zed.dev/gpt-6-luna"]),
  };
  assert.deepStrictEqual(
    hydrateCachedProvider({ fallbackProvider: fallback, cachedProvider: cached }).models,
    cached.models,
  );
});

it("preserves Zed custom settings and the previous catalog when refresh fails", () => {
  const discovered = makeProvider(ProviderDriverKind.make("zed"), {
    models: zedModels(["zed.dev/claude-sonnet-5-5", "zed.dev/gpt-6-luna"]),
  });
  const custom = { ...zedModels(["custom"])[0]!, isCustom: true };
  const fallback = { ...discovered, models: [...zedModels(["seed"]), custom] };
  assert.deepStrictEqual(
    hydrateCachedProvider({ fallbackProvider: fallback, cachedProvider: discovered }).models,
    [...discovered.models, custom],
  );
  const failed = { ...discovered, status: "error" as const, models: [] };
  assert.deepStrictEqual(mergeProviderSnapshot(discovered, failed).models, discovered.models);
});

it("keeps cached Zed discovery through boot seeding and a failed initial probe", () => {
  const cached = makeProvider(ProviderDriverKind.make("zed"), {
    models: zedModels(["zed.dev/claude-sonnet-5-5", "zed.dev/gpt-6-luna"]),
  });
  const custom = { ...zedModels(["custom"])[0]!, isCustom: true };
  const pending = {
    ...cached,
    installed: false,
    status: "warning" as const,
    models: [...zedModels(["seed"]), custom],
  };
  const hydrated = hydrateCachedProvider({ fallbackProvider: pending, cachedProvider: cached });
  const seeded = mergeProviderSnapshot(hydrated, pending);
  assert.deepStrictEqual(seeded.models, [...cached.models, custom]);
  const failed = { ...pending, installed: true, status: "error" as const };
  assert.deepStrictEqual(mergeProviderSnapshot(seeded, failed).models, [...cached.models, custom]);
  assert.deepStrictEqual(
    mergeProviderSnapshot(seeded, { ...failed, models: zedModels(["seed"]) }).models,
    cached.models,
  );
});
