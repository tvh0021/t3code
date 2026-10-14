import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { coordinationProviderIssue } from "../provider/coordinationWorkerPolicy.ts";
import { firstEligibleQuotaFallback, quotaWindowVerdict } from "./CoordinationQuotaPolicy.ts";

const now = "2026-09-28T12:00:00.000Z";
const quota = {
  checkedAt: now,
  windows: [
    {
      id: "session",
      kind: "session",
      label: "Session",
      usedPercent: 95,
      resetsAt: "2026-09-28T13:00:00.000Z",
    },
  ],
} as const;

const provider = (input: {
  model: string;
  usageLimits?: ServerProvider["usageLimits"];
  status?: ServerProvider["status"];
  driver?: "codex" | "antigravity";
}): ServerProvider => ({
  instanceId: ProviderInstanceId.make(
    input.driver === "antigravity" ? "gemini" : `instance-${input.model}`,
  ),
  driver: ProviderDriverKind.make(input.driver ?? "codex"),
  enabled: true,
  installed: true,
  version: null,
  status: input.status ?? "ready",
  auth: { status: "authenticated" },
  checkedAt: now,
  slashCommands: [],
  skills: [],
  models: [{ slug: input.model, name: input.model, isCustom: false, capabilities: null }],
  ...(input.usageLimits ? { usageLimits: input.usageLimits } : {}),
});

describe("CoordinationQuotaPolicy", () => {
  it("triggers at the configured percentage and uses the limiting window reset", () => {
    expect(quotaWindowVerdict({ usageLimits: quota, thresholdPercent: 95, now })).toEqual({
      status: "threshold-reached",
      resetAt: "2026-09-28T13:00:00.000Z",
    });
  });

  it("does not treat missing, stale, or unsupported quota as available", () => {
    expect(quotaWindowVerdict({ usageLimits: undefined, thresholdPercent: 95, now }).status).toBe(
      "unknown",
    );
    expect(
      quotaWindowVerdict({
        usageLimits: { ...quota, checkedAt: "2026-09-28T11:00:00.000Z" },
        thresholdPercent: 95,
        now,
      }).status,
    ).toBe("unknown");
    expect(
      quotaWindowVerdict({
        usageLimits: { checkedAt: now, windows: [], unavailable: { reason: "unsupported" } },
        thresholdPercent: 95,
        now,
      }).status,
    ).toBe("unknown");
  });

  it("skips unavailable and unknown-quota models, then picks the first eligible mapping", () => {
    const providers = [
      provider({ model: "opus", usageLimits: { ...quota, windows: [] } }),
      provider({
        model: "fable",
        usageLimits: { ...quota, windows: [{ ...quota.windows[0], usedPercent: 40 }] },
      }),
    ];
    expect(
      firstEligibleQuotaFallback({
        sourceModel: "sol",
        fallbackModels: { sol: ["opus", "fable"] },
        providers,
        thresholdPercent: 95,
        now,
      }),
    ).toEqual({ provider: providers[1], model: "fable" });
  });

  it("skips a mapped model without enough remaining workflow turns", () => {
    const providers = [
      provider({
        model: "opus",
        usageLimits: { ...quota, windows: [{ ...quota.windows[0], usedPercent: 20 }] },
      }),
      provider({
        model: "fable",
        usageLimits: { ...quota, windows: [{ ...quota.windows[0], usedPercent: 30 }] },
      }),
    ];
    expect(
      firstEligibleQuotaFallback({
        sourceModel: "sol",
        fallbackModels: { sol: ["opus", "fable"] },
        providers,
        thresholdPercent: 95,
        now,
        canRunModel: (model) => model === "fable",
      }),
    ).toEqual({ provider: providers[1], model: "fable" });
  });

  it("skips a healthy provider that cannot run the source orchestration role", () => {
    const providers = [
      provider({
        model: "opus",
        usageLimits: { ...quota, windows: [{ ...quota.windows[0], usedPercent: 20 }] },
      }),
    ];
    expect(
      firstEligibleQuotaFallback({
        sourceModel: "sol",
        fallbackModels: { sol: ["opus"] },
        providers,
        thresholdPercent: 95,
        now,
        canRunProviderModel: () => false,
      }),
    ).toBeUndefined();
  });

  it("can route a Luna parent to a healthy Gemini parent", () => {
    const gemini = provider({
      model: "gemini-3.8-flash-high",
      driver: "antigravity",
      usageLimits: { ...quota, windows: [{ ...quota.windows[0], usedPercent: 20 }] },
    });
    expect(
      firstEligibleQuotaFallback({
        sourceModel: "gpt-6-luna",
        fallbackModels: { "gpt-6-luna": ["gemini-3.8-flash-high"] },
        providers: [gemini],
        thresholdPercent: 95,
        now,
        canRunProviderModel: (candidate) =>
          coordinationProviderIssue(candidate.driver, "parent") === undefined,
      }),
    ).toEqual({ provider: gemini, model: "gemini-3.8-flash-high" });
  });
});
