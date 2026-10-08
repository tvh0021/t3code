import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("~/previewStateStore", () => ({
  isPreviewSupportedInRuntime: () => false,
  applyPreviewServerSnapshot: vi.fn(),
  rememberPreviewUrl: vi.fn(),
}));
vi.mock("./browserDefaults", () => ({
  resolveBrowserDefaults: vi.fn(),
  browserDefaultOpenProfileId: vi.fn(),
  browserDefaultOpenViewport: vi.fn(),
}));
vi.mock("~/rightPanelStore", () => ({ useRightPanelStore: { getState: vi.fn() } }));

import { openFileInPreview } from "./openFileInPreview";

function setup(filePath: string, httpBaseUrl = "http://localhost:3773") {
  return {
    threadRef: { environmentId: EnvironmentId.make("env-1"), threadId: ThreadId.make("thread-1") },
    filePath,
    workspaceRoot: "/workspace",
    httpBaseUrl,
    createAssetUrl: vi.fn(async () =>
      AsyncResult.success({ relativeUrl: "/api/assets/signed/report.html", expiresAt: 999999 }),
    ),
    openPreview: vi.fn(),
    openExternal: vi.fn(async (_url: string) => {}),
  };
}

describe("HTML files in the system browser", () => {
  it.each([
    ["/workspace/report.html", "http://localhost:3773", "workspace-file"],
    ["/tmp/report.html", "https://remote.example", "media-file"],
  ])("opens %s from its environment without an integrated browser", async (path, origin, tag) => {
    const input = setup(path, origin);
    const result = await openFileInPreview(input);

    expect(result._tag).toBe("Success");
    expect(input.openExternal).toHaveBeenCalledWith(`${origin}/api/assets/signed/report.html`);
    expect(input.openPreview).not.toHaveBeenCalled();
    expect(input.createAssetUrl).toHaveBeenCalledWith({
      environmentId: input.threadRef.environmentId,
      input: { resource: { _tag: tag, threadId: input.threadRef.threadId, path } },
    });
  });

  it("does not launch a browser when serving the file fails", async () => {
    const input = setup("/workspace/report.html");
    const result = await openFileInPreview({
      ...input,
      createAssetUrl: async () => AsyncResult.failure(Cause.fail(new Error("Missing file"))),
    });

    expect(result._tag).toBe("Failure");
    expect(input.openExternal).not.toHaveBeenCalled();
    expect(input.openPreview).not.toHaveBeenCalled();
  });

  it("propagates a system-browser launch failure", async () => {
    const input = setup("/workspace/report.html");
    input.openExternal.mockRejectedValue(new Error("Launch failed"));

    await expect(openFileInPreview(input)).rejects.toThrow("Launch failed");
    expect(input.openPreview).not.toHaveBeenCalled();
  });
});
