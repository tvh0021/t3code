import { describe, expect, it } from "vite-plus/test";

import { buildZedAcpSpawnInput } from "./ZedAcpSupport.ts";

describe("buildZedAcpSpawnInput", () => {
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
