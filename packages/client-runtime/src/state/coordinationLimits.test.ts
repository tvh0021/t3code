import { expect, it } from "vite-plus/test";
import {
  buildCoordinationPolicyPatch,
  formatCoordinationLimits,
  parseCoordinationLimits,
} from "./coordinationLimits.ts";

it("accepts zero, unlimited, and provider aliases while rejecting duplicate model budgets", () => {
  expect(parseCoordinationLimits("openai/gpt-6-sol=2\nGLM-5.3-Flash=unlimited\nunknown=0")).toEqual(
    { "gpt-sol": 2, "glm-flash": null, unknown: 0 },
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
  const saved = { "claude-sonnet": 1, "gpt-sol": 2, "glm-flash": null };
  expect(parseCoordinationLimits(formatCoordinationLimits(saved))).toEqual(saved);
});

it("builds canonical limits from the editor text", () => {
  expect(buildCoordinationPolicyPatch({ limitsText: "openai/gpt-6-sol=2" })).toEqual({
    coordinationModelLimits: { "gpt-sol": 2 },
  });
  expect(buildCoordinationPolicyPatch({ limitsText: "" })).toEqual({
    coordinationModelLimits: {},
  });
  expect(() => buildCoordinationPolicyPatch({ limitsText: "invalid" })).toThrow(
    "use model=attempts or model=unlimited.",
  );
});
