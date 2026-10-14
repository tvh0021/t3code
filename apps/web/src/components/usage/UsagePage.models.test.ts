import type { ModelTotals } from "@t3tools/shared/usageMerge";
import { describe, expect, it } from "vite-plus/test";

import { organizeUsageModels } from "./UsagePage";

const makeModel = (overrides: Partial<ModelTotals> & { model: string }): ModelTotals => ({
  model: overrides.model,
  provider: overrides.provider ?? "codex",
  costUsd: overrides.costUsd ?? 0,
  totalTokens: overrides.totalTokens ?? 0,
  tokens: overrides.tokens ?? {
    uncachedInputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  },
  records: overrides.records ?? 1,
  unpricedRecords: overrides.unpricedRecords ?? 0,
  unpricedTokens: overrides.unpricedTokens ?? 0,
  costShare: overrides.costShare ?? 0,
  tokenShare: overrides.tokenShare ?? 0,
  ...(overrides.isCreditBased !== undefined ? { isCreditBased: overrides.isCreditBased } : {}),
  ...(overrides.credits !== undefined ? { credits: overrides.credits } : {}),
});

describe("organizeUsageModels", () => {
  it("sorts models by cost descending and breaks ties by total tokens", () => {
    const models: ModelTotals[] = [
      makeModel({ model: "low-cost", costUsd: 1.0, totalTokens: 100 }),
      makeModel({ model: "high-cost", costUsd: 10.0, totalTokens: 50 }),
      makeModel({ model: "mid-cost-more-tokens", costUsd: 5.0, totalTokens: 500 }),
      makeModel({ model: "mid-cost-fewer-tokens", costUsd: 5.0, totalTokens: 200 }),
    ];

    const { subscriptionModels } = organizeUsageModels(models);

    expect(subscriptionModels.map((m) => m.model)).toEqual([
      "high-cost",
      "mid-cost-more-tokens",
      "mid-cost-fewer-tokens",
      "low-cost",
    ]);
  });

  it("splits models into subscription and credit-based groups while preserving ordering", () => {
    const models: ModelTotals[] = [
      makeModel({ model: "gpt-5.6-sol", costUsd: 12.0, isCreditBased: false }),
      makeModel({ model: "chatllm-fast", costUsd: 8.0, isCreditBased: true, credits: 200 }),
      makeModel({ model: "claude-sonnet-5-5", costUsd: 4.0, isCreditBased: false }),
      makeModel({ model: "chatllm-smart", costUsd: 15.0, isCreditBased: true, credits: 375 }),
    ];

    const { subscriptionModels, creditModels } = organizeUsageModels(models);

    expect(subscriptionModels.map((m) => m.model)).toEqual([
      "gpt-5.6-sol",
      "claude-sonnet-5-5",
    ]);
    expect(creditModels.map((m) => m.model)).toEqual([
      "chatllm-smart",
      "chatllm-fast",
    ]);
  });
});
