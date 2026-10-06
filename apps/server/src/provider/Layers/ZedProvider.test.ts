import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ZedSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

import { writeFakeCli } from "../../testUtils/fakeCli.ts";
import {
  buildInitialZedProviderSnapshot,
  checkZedProviderStatus,
  parseLatestZedModels,
} from "./ZedProvider.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const decodeSettings = Schema.decodeSync(ZedSettings);

describe("buildInitialZedProviderSnapshot", () => {
  it.effect("reports dashboard-only usage as unavailable instead of publishing a zeroed bar", () =>
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
          reason: "probeFailed",
          message: "Zed account spend is unavailable here. Check the Zed dashboard.",
        },
      });
    }),
  );
});

describe("checkZedProviderStatus", () => {
  for (const exitCode of [0, 1]) {
    it.effect(`keeps account spend unavailable after a probe exits ${exitCode}`, () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped();
        const binaryPath = writeFakeCli({
          directory,
          name: "zed-acp-server",
          source: `process.exit(${exitCode});`,
        });
        const snapshot = yield* checkZedProviderStatus(
          decodeSettings({ enabled: true, binaryPath }),
        );

        expect(snapshot.status).toBe(exitCode === 0 ? "ready" : "error");
        expect(snapshot.usageLimits).toMatchObject({
          checkedAt: snapshot.checkedAt,
          windows: [],
          unavailable: { reason: "probeFailed" },
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    );
  }
});

describe("Zed model discovery", () => {
  const catalog = [
    { slug: "zed.dev/claude-sonnet-5", name: "Sonnet 5" },
    { slug: "zed.dev/claude-sonnet-5-5-20260901", name: "Sonnet 5.5" },
    { slug: "zed.dev/claude-sonnet-5-10", name: "Sonnet 5.10" },
    { slug: "zed.dev/claude-opus-9", name: "Opus" },
    { slug: "zed.dev/gpt-5.6-luna", name: "Luna 5.6" },
    { slug: "zed.dev/gpt-6.1-luna", name: "Luna 6.1" },
    { slug: "zed.dev/gpt-9-sol", name: "Sol" },
    { slug: "other/gpt-10-luna", name: "Other Luna" },
    { slug: "zed.dev/gpt-10-luna-preview", name: "Preview" },
  ];

  it("selects one newest version per supplied family regardless of catalog order", () => {
    for (const entries of [catalog, catalog.toReversed()]) {
      expect(parseLatestZedModels(encodeJson(entries)).map((model) => model.slug)).toEqual([
        "zed.dev/claude-sonnet-5-10",
        "zed.dev/gpt-6.1-luna",
      ]);
    }
  });

  it.effect("refreshes from the bridge and retains custom models", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped();
      const binaryPath = writeFakeCli({
        directory,
        name: "zed-acp-server",
        source: `if (process.argv.includes("--list-models")) console.log(${encodeJson(encodeJson(catalog))});`,
      });
      const snapshot = yield* checkZedProviderStatus(
        decodeSettings({
          enabled: true,
          binaryPath,
          customModels: ["zed.dev/custom"],
        }),
      );
      expect(snapshot.models.map((model) => model.slug)).toEqual([
        "zed.dev/claude-sonnet-5-10",
        "zed.dev/gpt-6.1-luna",
        "zed.dev/custom",
      ]);
      expect(snapshot.message).toBeUndefined();
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
      expect(snapshot.models).toEqual(parseLatestZedModels(encodeJson(catalog)));
      expect(snapshot.message).toBeUndefined();
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("retains discovered and custom models when the bridge exits unsuccessfully", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped();
      const binaryPath = writeFakeCli({
        directory,
        name: "zed-acp-server",
        source: `if (process.argv.includes("--list-models")) process.exit(1);`,
      });
      const previous = parseLatestZedModels(encodeJson(catalog));
      const snapshot = yield* checkZedProviderStatus(
        decodeSettings({ enabled: true, binaryPath, customModels: ["zed.dev/custom"] }),
        undefined,
        undefined,
        previous,
      );
      expect(snapshot.models.slice(0, 2)).toEqual(previous);
      expect(snapshot.models[2]).toMatchObject({ slug: "zed.dev/custom", isCustom: true });
      expect(snapshot.message).toContain("Keeping the previous list");
      expect(snapshot.status).toBe("ready");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  for (const output of ["invalid JSON", "[]", encodeJson(catalog.slice(0, 1))]) {
    it.effect(`retains the last catalog on failed or incomplete discovery: ${output}`, () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped();
        const binaryPath = writeFakeCli({
          directory,
          name: "zed-acp-server",
          source: `if (process.argv.includes("--list-models")) console.log(${encodeJson(output)});`,
        });
        const previous = parseLatestZedModels(encodeJson(catalog));
        const snapshot = yield* checkZedProviderStatus(
          decodeSettings({ enabled: true, binaryPath }),
          undefined,
          undefined,
          previous,
        );
        expect(snapshot.models).toEqual(previous);
        expect(snapshot.message).toContain("Keeping the previous list");
        expect(snapshot.status).toBe("ready");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    );
  }
});
