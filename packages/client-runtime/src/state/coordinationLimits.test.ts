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

it("builds canonical limits and ordered fallbacks with an inclusive quota threshold", () => {
  for (const threshold of [1, 100]) {
    expect(
      buildCoordinationPolicyPatch({
        limitsText: "openai/gpt-6-sol=2",
        fallbacksText: "gpt-6-sol=claude-opus-5,claude-fable-5-1",
        threshold,
        thresholdError: "threshold error",
      }),
    ).toEqual({
      coordinationModelLimits: { "gpt-sol": 2 },
      coordinationQuotaHandoffFallbacks: { "gpt-6-sol": ["claude-opus-5", "claude-fable-5-1"] },
      coordinationQuotaHandoffThresholdPercent: threshold,
    });
  }
  expect(
    buildCoordinationPolicyPatch({
      limitsText: "",
      fallbacksText: "",
      threshold: 95,
      thresholdError: "threshold error",
    }),
  ).toEqual({
    coordinationModelLimits: {},
    coordinationQuotaHandoffFallbacks: {},
    coordinationQuotaHandoffThresholdPercent: 95,
  });
});

it("preserves each surface's threshold error and validates limits before fallbacks before threshold", () => {
  const input = {
    limitsText: "",
    fallbacksText: "",
    threshold: 95,
    thresholdError: "Choose a threshold from 1 to 100.",
  };
  for (const threshold of [0, 101, 1.5, NaN, Infinity]) {
    expect(() => buildCoordinationPolicyPatch({ ...input, threshold })).toThrow(
      input.thresholdError,
    );
  }
  expect(() =>
    buildCoordinationPolicyPatch({
      ...input,
      threshold: 0,
      thresholdError: "Choose a quota threshold from 1 to 100.",
    }),
  ).toThrow("Choose a quota threshold from 1 to 100.");
  expect(() =>
    buildCoordinationPolicyPatch({
      ...input,
      limitsText: "invalid",
      fallbacksText: "invalid",
      threshold: 0,
    }),
  ).toThrow("use model=attempts or model=unlimited.");
  expect(() =>
    buildCoordinationPolicyPatch({
      ...input,
      fallbacksText: "invalid",
      threshold: 0,
    }),
  ).toThrow("use source-model=target-model,target-model.");
});
