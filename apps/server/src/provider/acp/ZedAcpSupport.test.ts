import { describe, expect, it } from "vite-plus/test";

import { buildZedAcpSpawnInput } from "./ZedAcpSupport.ts";

describe("buildZedAcpSpawnInput", () => {
  it("starts discovery with the thread's selected model instead of the provider default", () => {
    const spawn = buildZedAcpSpawnInput(
      { binaryPath: "/tmp/zed-acp-server", dataDir: "", model: "zed.dev/gpt-6-luna" },
      "/tmp/project",
      undefined,
      "zed.dev/claude-sonnet-5-5",
    );
    expect(spawn.args).toEqual([
      "--worktree",
      "/tmp/project",
      "--model",
      "zed.dev/claude-sonnet-5-5",
    ]);
  });

  it("isolates the Zed server in the configured data directory", () => {
    const spawn = buildZedAcpSpawnInput(
      { binaryPath: "/tmp/zed-acp-server", dataDir: "/tmp/isolated-data", model: "" },
      "/tmp/project",
    );
    expect(spawn.args).toEqual(["--worktree", "/tmp/project", "--data-dir", "/tmp/isolated-data"]);
  });

  it("passes the configured model to the headless Zed server", () => {
    const spawn = buildZedAcpSpawnInput(
      {
        binaryPath: "/tmp/zed-acp-server",
        dataDir: "/tmp/zed-data",
        model: "anthropic/claude-sonnet-4-6",
      },
      "/tmp/project",
    );

    expect(spawn.args).toEqual([
      "--worktree",
      "/tmp/project",
      "--data-dir",
      "/tmp/zed-data",
      "--model",
      "anthropic/claude-sonnet-4-6",
    ]);
  });
});
