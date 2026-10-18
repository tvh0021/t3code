import { describe, expect, it } from "vite-plus/test";
import { coordinationLimit, coordinationModelKey } from "./coordinationPolicy.ts";

describe("coordination policy", () => {
  it("normalizes aliases and dated provider model names", () => {
    expect(coordinationModelKey("openai/6-sol-latest")).toBe("gpt-sol");
    expect(coordinationModelKey("anthropic/claude-opus-5.5-20261001")).toBe("claude-opus");
    expect(coordinationModelKey("custom_model")).toBe("custom-model");
  });

  it("shares one key across generations of a family", () => {
    for (const model of ["gpt-6.1-sol", "azure/gpt-6-sol-2026-09-22", "gpt-5.6-sol"])
      expect(coordinationModelKey(model)).toBe("gpt-sol");
    for (const model of ["claude-opus-5-5", "claude-opus-5", "claude-3-opus-20240229"])
      expect(coordinationModelKey(model)).toBe("claude-opus");
    expect(coordinationModelKey("gemini-3.7-flash")).toBe("gemini-flash");
    expect(coordinationModelKey("glm-5.3-flash")).toBe("glm-flash");
    expect(coordinationModelKey("gemini-3.1-pro-preview")).toBe("gemini-3.1-pro-preview");
  });

  it("uses model overrides before output pricing", () => {
    expect(coordinationLimit("openai/gpt-6.1-sol", undefined)).toBe(2);
    expect(coordinationLimit("gpt-6-luna", 20)).toBeNull();
    expect(coordinationLimit("custom", undefined, { custom: 3 })).toBe(3);
  });

  it("keeps the price thresholds and unpriced models distinct", () => {
    expect(coordinationLimit("custom", undefined)).toBeUndefined();
    expect(coordinationLimit("custom", NaN)).toBeUndefined();
    expect(coordinationLimit("custom", -1)).toBeUndefined();
    expect(coordinationLimit("custom", 0)).toBeNull();
    expect(coordinationLimit("custom", 1)).toBe(4);
    expect(coordinationLimit("custom", 10)).toBe(4);
    expect(coordinationLimit("custom", 11)).toBe(1);
  });
});
