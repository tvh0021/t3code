import { describe, expect, it } from "@effect/vitest";

import { normalizeUsageModel } from "./usage.ts";

describe("normalizeUsageModel", () => {
  it.each([
    "gpt-6.1-sol",
    "claude-sonnet-5-5",
    "claude-opus-5-5",
    "gemini-3.8-flash",
    "gemini-3.1-pro",
  ])("combines efforts for %s", (model) => {
    for (const effort of [
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultra",
      "ultrathink",
      "thinking",
      "tiered",
    ]) {
      expect(normalizeUsageModel(` ${model}-${effort} `)).toBe(model);
    }
  });

  it("combines Antigravity's Pro High alias with Pro Low", () => {
    expect(normalizeUsageModel("gemini-pro-agent")).toBe("gemini-3.1-pro");
    expect(normalizeUsageModel("gemini-3.1-pro-low")).toBe("gemini-3.1-pro");
  });

  it("preserves provider, context and intrinsic model variants", () => {
    expect(normalizeUsageModel("vendor/claude-sonnet-5-5-high[1m]")).toBe(
      "vendor/claude-sonnet-5-5[1m]",
    );
    for (const model of [
      "gpt-5.1-codex-max",
      "vendor/gpt-5.1-codex-max",
      "gemini-3.8-flash-lite",
      "custom-model-high",
      "gemini-3.8-flash-high-speed",
    ]) {
      expect(normalizeUsageModel(model)).toBe(model);
    }
    expect(normalizeUsageModel("gpt-5.1-codex-max-high")).toBe("gpt-5.1-codex-max");
  });
});
