import { describe, expect, it } from "vite-plus/test";
import { coordinationLimit, coordinationModelKey } from "./coordinationPolicy.ts";

describe("coordination policy", () => {
  it("normalizes aliases and dated provider model names", () => {
    expect(coordinationModelKey("openai/6-sol-latest")).toBe("gpt-6-sol");
    expect(coordinationModelKey("anthropic/claude-opus-5.5-20261001")).toBe("claude-opus-5.5");
    expect(coordinationModelKey("custom_model")).toBe("custom-model");
  });

  it("uses model overrides before output pricing", () => {
    expect(coordinationLimit("openai/gpt-6-sol", undefined)).toBe(2);
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
