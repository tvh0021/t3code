import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  canUseMarkdownFileShellActions,
  shouldUseMarkdownFileBrowserPrimaryAction,
} from "./ChatMarkdown";

describe("canUseMarkdownFileShellActions", () => {
  const environmentId = EnvironmentId.make("environment-1");

  it("allows editor and file manager actions only for resolved local environments", () => {
    expect(canUseMarkdownFileShellActions(environmentId, "local-exec", true)).toBe(true);
    expect(canUseMarkdownFileShellActions(environmentId, "local-exec", false)).toBe(false);
    expect(canUseMarkdownFileShellActions(environmentId, "remote-links", true)).toBe(false);
    expect(canUseMarkdownFileShellActions(environmentId, "remote-unavailable", true)).toBe(false);
    expect(canUseMarkdownFileShellActions(null, "local-exec", true)).toBe(false);
  });
});

describe("shouldUseMarkdownFileBrowserPrimaryAction", () => {
  const markdown = { iconPath: "/tmp/report.md", canOpenInBrowser: true };

  it("uses the browser for markdown only when it is the sole action", () => {
    expect(
      shouldUseMarkdownFileBrowserPrimaryAction({
        ...markdown,
        canOpenInEditor: false,
        canOpenInPanel: false,
      }),
    ).toBe(true);
    expect(
      shouldUseMarkdownFileBrowserPrimaryAction({
        ...markdown,
        canOpenInEditor: true,
        canOpenInPanel: false,
      }),
    ).toBe(false);
    expect(
      shouldUseMarkdownFileBrowserPrimaryAction({
        ...markdown,
        canOpenInEditor: false,
        canOpenInPanel: true,
      }),
    ).toBe(false);
  });

  it.each(["pdf", "html", "htm"])(
    "opens %s in the browser ahead of editor and panel actions",
    (extension) => {
      expect(
        shouldUseMarkdownFileBrowserPrimaryAction({
          iconPath: `/tmp/report.${extension}`,
          canOpenInEditor: true,
          canOpenInBrowser: true,
          canOpenInPanel: true,
        }),
      ).toBe(true);
    },
  );
});
