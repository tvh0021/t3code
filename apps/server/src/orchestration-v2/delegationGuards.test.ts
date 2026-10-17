import { describe, expect, it } from "@effect/vitest";

import { turnBudgetExceeded } from "./delegationGuards.ts";

const child = (model: string, origin: "app_owned" | "provider_native" = "app_owned") => ({
  origin,
  model,
});

describe("turnBudgetExceeded", () => {
  const budgets = [
    { model: "gpt-6-sol", limit: 2, used: 0 },
    { model: "gpt-6-luna", limit: null, used: 0 },
  ];

  it("counts app-owned children across provider prefixes", () => {
    expect(turnBudgetExceeded(budgets, [child("gpt-6-sol")], "gpt-6-sol")).toBeNull();
    expect(
      turnBudgetExceeded(budgets, [child("gpt-6-sol"), child("openai/gpt-6-sol")], "gpt-6-sol"),
    ).toContain("2 of 2");
  });

  it("ignores provider-native children and unlimited or unknown models", () => {
    const many = Array.from({ length: 5 }, () => child("gpt-6-sol", "provider_native"));
    expect(turnBudgetExceeded(budgets, many, "gpt-6-sol")).toBeNull();
    expect(turnBudgetExceeded(budgets, [child("gpt-6-luna")], "gpt-6-luna")).toBeNull();
    expect(turnBudgetExceeded(budgets, [child("unpriced")], "unpriced")).toBeNull();
  });
});
