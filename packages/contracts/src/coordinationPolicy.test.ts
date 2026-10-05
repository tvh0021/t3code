import { describe, expect, it } from "vite-plus/test";
import { isGptModel, resolveChildRuntimeMode } from "./coordinationPolicy.ts";
import type { RuntimeMode } from "./orchestration.ts";

const modes: ReadonlyArray<RuntimeMode> = [
  "auto",
  "full-access",
  "approval-required",
  "auto-accept-edits",
];

describe("coordination child permissions", () => {
  it("recognizes GPT aliases and provider-qualified names", () => {
    for (const model of ["gpt-6-sol", "openai/gpt-6-astra", "6-luna", "gpt-5.6-luna"]) {
      expect(isGptModel(model)).toBe(true);
    }
    expect(isGptModel("gemini-3.8-flash")).toBe(false);
  });
  it.each(modes)(
    "uses full access for every Antigravity model with parent %s",
    (parentRuntimeMode) => {
      for (const mode of ["edit", "review"] as const) {
        for (const childModel of ["gemini-3.8-flash", "native-default", "gpt-custom"]) {
          expect(
            resolveChildRuntimeMode({
              mode,
              parentRuntimeMode,
              childModel,
              childDriver: "antigravity",
            }),
          ).toBe("full-access");
        }
      }
    },
  );
  it.each(modes)("GPT edits and reviews inherit %s", (parentRuntimeMode) => {
    for (const mode of ["edit", "review"] as const) {
      expect(
        resolveChildRuntimeMode({
          mode,
          parentRuntimeMode,
          childModel: "gpt-6-luna",
          childDriver: "codex",
        }),
      ).toBe(parentRuntimeMode);
    }
  });
  it("preserves other providers' edit and review behavior", () => {
    for (const childDriver of ["claudeAgent", "zed", "abacus", "opencode"]) {
      expect(
        resolveChildRuntimeMode({
          mode: "edit",
          parentRuntimeMode: "auto",
          childModel: "claude-sonnet-5",
          childDriver,
        }),
      ).toBe("auto");
      expect(
        resolveChildRuntimeMode({
          mode: "review",
          parentRuntimeMode: "full-access",
          childModel: "claude-sonnet-5",
          childDriver,
        }),
      ).toBe("approval-required");
    }
    expect(
      resolveChildRuntimeMode({
        mode: "edit",
        parentRuntimeMode: "auto",
        childModel: "gemini-custom",
        childDriver: "opencode",
      }),
    ).toBe("auto");
  });
});
