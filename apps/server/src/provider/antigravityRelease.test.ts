import { describe, expect, it } from "@effect/vitest";

import { resolveAntigravityReleaseAsset } from "./antigravityRelease.ts";

describe("Antigravity release assets", () => {
  it.each([
    ["darwin", "arm64"],
    ["linux", "x64"],
    ["linux", "arm64"],
    ["win32", "x64"],
    ["win32", "arm64"],
  ] as const)("resolves version 1.3.0 for %s-%s", (platform, arch) => {
    expect(resolveAntigravityReleaseAsset(platform, arch)?.version).toBe("1.3.0");
  });

  it.each([
    ["freebsd", "x64"],
    ["linux", "ia32"],
    ["win32", "ia32"],
  ] as const)("does not resolve an unsupported target %s-%s", (platform, arch) => {
    expect(resolveAntigravityReleaseAsset(platform, arch)).toBeNull();
  });
});
