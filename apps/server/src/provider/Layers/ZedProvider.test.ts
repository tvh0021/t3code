import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ZedSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

import { writeFakeCli } from "../../testUtils/fakeCli.ts";
import { buildInitialZedProviderSnapshot, checkZedProviderStatus } from "./ZedProvider.ts";

const decodeSettings = Schema.decodeSync(ZedSettings);

describe("buildInitialZedProviderSnapshot", () => {
  it.effect("reports dashboard-only usage as unavailable instead of publishing a zeroed bar", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialZedProviderSnapshot(decodeSettings({ enabled: true }));

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
