import { expect, it } from "vite-plus/test";
import { formatCoordinationLimits, parseCoordinationLimits } from "./coordinationLimits.ts";

it("accepts zero, unlimited, and provider aliases while rejecting duplicate model budgets", () => {
  expect(parseCoordinationLimits("openai/gpt-6-sol=2\nGLM-5.3-Flash=unlimited\nunknown=0")).toEqual(
    { "gpt-6-sol": 2, "glm-5.3-flash": null, unknown: 0 },
  );
  expect(() => parseCoordinationLimits("gpt-6-sol=2\nopenai/gpt-6-sol=4")).toThrow(
    "already has a limit",
  );
  expect(() => parseCoordinationLimits("new=-1")).toThrow("Line 1");
  expect(() => parseCoordinationLimits("new=1.5")).toThrow("Line 1");
  expect(() => parseCoordinationLimits("new=9007199254740992")).toThrow("whole number");
  expect(parseCoordinationLimits(" \n")).toEqual({});
});

it("keeps overrides when editing a saved policy", () => {
  const saved = { "claude-sonnet-5": 1, "gpt-6-sol": 2, "glm-5.3-flash": null };
  expect(parseCoordinationLimits(formatCoordinationLimits(saved))).toEqual(saved);
});
