import {
  type CoordinationBudget,
  coordinationModelKey,
  type OrchestrationV2Subagent,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { CoordinationPolicy } from "./CoordinationPolicy.ts";

type DelegatedChild = Pick<OrchestrationV2Subagent, "origin" | "model" | "modelSelection">;

/**
 * Why `delegate_task` may not start another app-owned child on `targetModel`,
 * or null when the parent's per-model budget still has room. Budgets count every
 * child the parent ever delegated to that canonical model, so a parent cannot
 * reset its spend by waiting for children to finish.
 */
export function turnBudgetExceeded(
  budgets: ReadonlyArray<CoordinationBudget>,
  subagents: ReadonlyArray<DelegatedChild>,
  targetModel: string,
): string | null {
  const key = coordinationModelKey(targetModel);
  const limit = budgets.find((budget) => budget.model === key)?.limit;
  if (limit === undefined || limit === null) return null;
  const used = subagents.filter((subagent) => {
    const model = subagent.model ?? subagent.modelSelection?.model;
    return subagent.origin === "app_owned" && model != null && coordinationModelKey(model) === key;
  }).length;
  return used < limit
    ? null
    : `Turn budget exhausted for ${key}: ${used} of ${limit} delegated turns used.`;
}

/**
 * Personal-fork limit on upstream `delegate_task`: per-model turn budgets.
 * Failures are user-facing messages.
 */
export class DelegationGuards extends Context.Service<
  DelegationGuards,
  {
    readonly checkTurnBudget: (
      subagents: ReadonlyArray<DelegatedChild>,
      targetModel: string,
    ) => Effect.Effect<void, string>;
  }
>()("t3/orchestration-v2/delegationGuards") {}

export const make = Effect.gen(function* () {
  const policy = yield* CoordinationPolicy;
  return DelegationGuards.of({
    checkTurnBudget: (subagents, targetModel) =>
      policy.read().pipe(
        Effect.mapError((error) => error.message),
        Effect.flatMap(({ budgets }) => {
          const exceeded = turnBudgetExceeded(budgets, subagents, targetModel);
          return exceeded === null ? Effect.void : Effect.fail(exceeded);
        }),
      ),
  });
});

export const layer = Layer.effect(DelegationGuards, make);
