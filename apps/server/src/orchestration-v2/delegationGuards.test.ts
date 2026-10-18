import { describe, expect, it } from "@effect/vitest";

import { taskAttemptsExceeded } from "./delegationGuards.ts";

const child = (
  model: string,
  task: { title?: string; prompt?: string } = {},
  origin: "app_owned" | "provider_native" = "app_owned",
) => ({
  origin,
  model,
  title: task.title ?? "Review checkout",
  prompt: task.prompt ?? "Review the diff.",
});

const task = (model: string, title: string | null = "Review checkout", prompt = "Round 3.") => ({
  model,
  title,
  prompt,
});

describe("taskAttemptsExceeded", () => {
  const budgets = [
    { model: "gpt-sol", limit: 2, used: 0 },
    { model: "gpt-luna", limit: null, used: 0 },
  ];

  it("counts resubmissions of one titled task across generations, prefixes, and prompts", () => {
    expect(taskAttemptsExceeded(budgets, [child("gpt-6-sol")], task("gpt-6-sol"))).toBeNull();
    expect(
      taskAttemptsExceeded(
        budgets,
        [child("gpt-6.1-sol"), child("openai/gpt-6-sol", { title: " review  CHECKOUT " })],
        task("gpt-5.6-sol"),
      ),
    ).toContain("2 of 2");
  });

  it("lets different tasks on the same model each use the full limit", () => {
    const others = Array.from({ length: 5 }, (_, index) =>
      child("gpt-6-sol", { title: `Task ${index}` }),
    );
    expect(taskAttemptsExceeded(budgets, others, task("gpt-6-sol"))).toBeNull();
  });

  it("identifies untitled tasks by prompt", () => {
    const untitled = [child("gpt-6-sol", { title: "", prompt: "Fix the build." })];
    expect(
      taskAttemptsExceeded(
        budgets,
        [...untitled, ...untitled],
        task("gpt-6-sol", null, "fix the  build."),
      ),
    ).toContain("2 of 2");
    expect(
      taskAttemptsExceeded(
        budgets,
        [...untitled, ...untitled],
        task("gpt-6-sol", null, "Ship it."),
      ),
    ).toBeNull();
  });

  it("ignores provider-native children and unlimited or unknown models", () => {
    const native = Array.from({ length: 5 }, () => child("gpt-6-sol", {}, "provider_native"));
    expect(taskAttemptsExceeded(budgets, native, task("gpt-6-sol"))).toBeNull();
    const luna = [child("gpt-6-luna"), child("gpt-6-luna")];
    expect(taskAttemptsExceeded(budgets, luna, task("gpt-6-luna"))).toBeNull();
    expect(taskAttemptsExceeded(budgets, [child("unpriced")], task("unpriced"))).toBeNull();
  });
});
