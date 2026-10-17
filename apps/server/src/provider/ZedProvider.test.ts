import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ZedSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

import { writeFakeCli } from "@t3tools/provider-testing/fakeCli";
import {
  buildInitialZedProviderSnapshot,
  checkZedProviderStatus,
  parseZedModels,
} from "./ZedProvider.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const decodeSettings = Schema.decodeSync(ZedSettings);

describe("buildInitialZedProviderSnapshot", () => {
  it.effect("asks for a dashboard session instead of publishing a zeroed bar", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialZedProviderSnapshot(decodeSettings({ enabled: true }));

      expect(snapshot).toMatchObject({
        installed: false,
        status: "warning",
        auth: { status: "unknown" },
      });

      expect(snapshot.usageLimits).toMatchObject({
        windows: [],
        unavailable: {
          reason: "unsupported",
          message: "Add a Zed dashboard session in Zed provider settings to see account spend.",
        },
        externalUsage: { label: "Zed dashboard", url: "https://dashboard.zed.dev" },
      });
    }),
  );

  it.effect("marks spend as pending until the first read when a session is set", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialZedProviderSnapshot(
        decodeSettings({ enabled: true, dashboardSession: "session=abc" }),
      );
      expect(snapshot.usageLimits).toMatchObject({
        windows: [],
        unavailable: { reason: "probeFailed", message: "Zed account spend has not been read yet." },
      });
    }),
  );
});

describe("checkZedProviderStatus", () => {
  it.effect.each([0, 1])("keeps account spend unavailable after a probe exits %i", (exitCode) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped();
      const binaryPath = writeFakeCli({
        directory,
        name: "zed-acp-server",
        source: `process.exit(${exitCode});`,
      });
      const snapshot = yield* checkZedProviderStatus(decodeSettings({ enabled: true, binaryPath }));

      // Exit 0 still lists no models, so discovery fails with a warning.
      expect(snapshot.status).toBe(exitCode === 0 ? "warning" : "error");
      expect(snapshot.usageLimits).toMatchObject({
        checkedAt: snapshot.checkedAt,
        windows: [],
        unavailable: { reason: "unsupported" },
        externalUsage: { label: "Zed dashboard", url: "https://dashboard.zed.dev" },
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("Zed model discovery", () => {
  it("exposes the bridge's supported thinking efforts and default", () => {
    const models = parseZedModels(
      encodeJson([
        {
          slug: "zed.dev/gpt-6.1-luna",
          name: "Luna",
          effortLevels: [
            { value: "low", name: "Low", isDefault: false },
            { value: "high", name: "High", isDefault: true },
          ],
        },
      ]),
    );
    expect(models[0]?.capabilities?.optionDescriptors).toEqual([
      {
        id: "thinking_effort",
        label: "Thinking effort",
        type: "select",
        currentValue: "high",
        options: [
          { id: "low", label: "Low", isDefault: false },
          { id: "high", label: "High", isDefault: true },
        ],
      },
    ]);
  });

  const catalog = [
    { slug: "zed.dev/claude-sonnet-5-5", name: "Claude Sonnet 5.5", provider: "Anthropic" },
    { slug: "zed.dev/gpt-6-luna", name: "GPT-6 Luna", provider: "OpenAI", isDefault: true },
    { slug: "zed.dev/gemini-4-argon", name: "Gemini 4 Argon", provider: "Google AI" },
  ];

  it("keeps every model in bridge order with its provider and default", () => {
    expect(parseZedModels(encodeJson(catalog))).toEqual([
      {
        slug: "zed.dev/claude-sonnet-5-5",
        name: "Claude Sonnet 5.5",
        subProvider: "Anthropic",
        isCustom: false,
        capabilities: expect.objectContaining({ optionDescriptors: [] }),
      },
      {
        slug: "zed.dev/gpt-6-luna",
        name: "GPT-6 Luna",
        subProvider: "OpenAI",
        isCustom: false,
        isDefault: true,
        capabilities: expect.objectContaining({ optionDescriptors: [] }),
      },
      {
        slug: "zed.dev/gemini-4-argon",
        name: "Gemini 4 Argon",
        subProvider: "Google AI",
        isCustom: false,
        capabilities: expect.objectContaining({ optionDescriptors: [] }),
      },
    ]);
  });

  it("defaults to the first model from bridges that mark no default", () => {
    const models = parseZedModels(encodeJson(catalog.map(({ slug, name }) => ({ slug, name }))));
    expect(models.map((model) => model.isDefault ?? false)).toEqual([true, false, false]);
    expect(models.every((model) => model.subProvider === undefined)).toBe(true);
  });

  it.effect("refreshes from the bridge and retains custom models", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped();
      const binaryPath = writeFakeCli({
        directory,
        name: "zed-acp-server",
        source: `if (process.argv.includes("--version")) console.log("zed-acp-server 0.2.1");
if (process.argv.includes("--list-models")) console.log(${encodeJson(encodeJson(catalog))});`,
      });
      const snapshot = yield* checkZedProviderStatus(
        decodeSettings({
          enabled: true,
          binaryPath,
          customModels: ["zed.dev/custom"],
        }),
      );
      expect(snapshot.models.map((model) => model.slug)).toEqual([
        ...catalog.map((entry) => entry.slug),
        "zed.dev/custom",
      ]);
      expect(snapshot.status).toBe("ready");
      expect(snapshot.message).toBeUndefined();
      expect(snapshot.version).toBe("0.2.1");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("discovers capabilities for custom hosted models as well", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped();
      const entries = [
        ...catalog,
        {
          slug: "zed.dev/custom",
          name: "Custom",
          effortLevels: [{ value: "medium", name: "Medium", isDefault: true }],
        },
      ];
      const binaryPath = writeFakeCli({
        directory,
        name: "zed",
        source: `if (process.argv.includes("--list-models")) console.log(${encodeJson(encodeJson(entries))});`,
      });
      const snapshot = yield* checkZedProviderStatus(
        decodeSettings({ enabled: true, binaryPath, customModels: ["zed.dev/custom"] }),
      );
      expect(
        snapshot.models.find((model) => model.slug === "zed.dev/custom")?.capabilities
          ?.optionDescriptors,
      ).toMatchObject([
        {
          id: "thinking_effort",
          currentValue: "medium",
          options: [{ id: "medium", isDefault: true }],
        },
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("uses the configured data directory for discovery", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped();
      const dataDir = `${directory}/custom Zed data`;
      const binaryPath = writeFakeCli({
        directory,
        name: "zed-acp-server",
        source: `if (process.argv.includes("--list-models")) {
          if (process.argv[process.argv.indexOf("--data-dir") + 1] !== ${encodeJson(dataDir)}) process.exit(1);
          console.log(${encodeJson(encodeJson(catalog))});
        }`,
      });
      const snapshot = yield* checkZedProviderStatus(
        decodeSettings({ enabled: true, binaryPath, dataDir }),
      );
      expect(snapshot.models).toEqual(parseZedModels(encodeJson(catalog)));
      expect(snapshot.message).toBeUndefined();
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect.each(["exit 1", "invalid JSON", "[]"])(
    "keeps the previous catalog and warns on failed discovery: %s",
    (output) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped();
        const binaryPath = writeFakeCli({
          directory,
          name: "zed-acp-server",
          source: `if (process.argv.includes("--list-models")) ${
            output === "exit 1" ? "process.exit(1)" : `console.log(${encodeJson(output)})`
          };`,
        });
        const previous = parseZedModels(encodeJson(catalog));
        const snapshot = yield* checkZedProviderStatus(
          decodeSettings({ enabled: true, binaryPath, customModels: ["zed.dev/custom"] }),
          undefined,
          undefined,
          previous,
        );
        expect(snapshot.models.slice(0, previous.length)).toEqual(previous);
        expect(snapshot.models.at(-1)).toMatchObject({ slug: "zed.dev/custom", isCustom: true });
        expect(snapshot.message).toContain("Keeping the previous list");
        expect(snapshot.status).toBe("warning");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
