import { expect, it } from "vite-plus/test";
import { getProviderRuntimeModes, resolveProviderRuntimeMode } from "./providerRuntimeMode.ts";

it("preserves the preference across provider switches while enforcing Antigravity full access", () => {
  for (const preferredMode of getProviderRuntimeModes("codex")) {
    expect(resolveProviderRuntimeMode("codex", preferredMode)).toBe(preferredMode);
    expect(resolveProviderRuntimeMode("antigravity", preferredMode)).toBe("full-access");
    expect(resolveProviderRuntimeMode("codex", preferredMode)).toBe(preferredMode);
    for (const driver of ["claudeAgent", "zed", "abacus", "opencode", undefined]) {
      expect(resolveProviderRuntimeMode(driver, preferredMode)).toBe(preferredMode);
    }
  }
  expect(getProviderRuntimeModes("antigravity")).toEqual(["full-access"]);
});
