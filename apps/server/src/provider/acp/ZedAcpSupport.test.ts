import { describe, expect, it } from "vite-plus/test";

import { buildZedAcpSpawnInput } from "./ZedAcpSupport.ts";

describe("buildZedAcpSpawnInput", () => {
  it("requests an explicit native worker policy before starting a review", () => {
    const spawn = buildZedAcpSpawnInput(
      {
        binaryPath: "/tmp/zed-acp-server",
        dataDir: "/tmp/isolated-data",
        model: "glm/glm-5.3-flash",
      },
      "/tmp/project",
      {},
      "review",
    );
    expect(spawn.args.slice(0, 2)).toEqual(["--worker-mode", "review"]);
    expect(spawn.args).toContain("/tmp/isolated-data");
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
