import {
  type CoordinationBudget,
  coordinationModelKey,
  type OrchestrationV2Subagent,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { CoordinationPolicy } from "./CoordinationPolicy.ts";

type DelegatedChild = Pick<
  OrchestrationV2Subagent,
  "origin" | "model" | "modelSelection" | "title" | "prompt"
>;

export interface DelegatedTask {
  readonly model: string;
  readonly title: string | null;
  readonly prompt: string;
}

/**
 * The title names the task; review rounds resend it with new findings in the
 * prompt, so the prompt only identifies untitled tasks.
 */
function taskKey(task: Pick<DelegatedChild, "title" | "prompt">): string {
  const normalize = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
  const title = task.title === null ? "" : normalize(task.title);
  return title === "" ? `prompt:${normalize(task.prompt)}` : `title:${title}`;
}

/**
 * Why `delegate_task` may not resubmit this task to `task.model`, or null when
 * it has attempts left. The limit stops a parent from re-delegating one task
 * that is going nowhere; different tasks on the same model don't share it.
 * Finished attempts still count, so waiting doesn't restore them.
 */
export function taskAttemptsExceeded(
  budgets: ReadonlyArray<CoordinationBudget>,
  subagents: ReadonlyArray<DelegatedChild>,
  task: DelegatedTask,
): string | null {
  const model = coordinationModelKey(task.model);
  const limit = budgets.find((budget) => budget.model === model)?.limit;
  if (limit === undefined || limit === null) return null;
  const key = taskKey(task);
  const used = subagents.filter((subagent) => {
    const childModel = subagent.model ?? subagent.modelSelection?.model;
    return (
      subagent.origin === "app_owned" &&
      childModel != null &&
      coordinationModelKey(childModel) === model &&
      taskKey(subagent) === key
    );
  }).length;
  return used < limit
    ? null
    : `This task already ran ${used} of ${limit} times on ${model}, which includes its earlier generations. Stop resubmitting it: change the approach, use the latest generation of another model family, or report the blocker to the user.`;
}

/**
 * Personal-fork limit on upstream `delegate_task`: per-model attempts at one
 * task. Failures are user-facing messages.
 */
export class DelegationGuards extends Context.Service<
  DelegationGuards,
  {
    readonly checkTaskAttempts: (
      subagents: ReadonlyArray<DelegatedChild>,
      task: DelegatedTask,
    ) => Effect.Effect<void, string>;
  }
>()("t3/orchestration-v2/delegationGuards") {}

export const make = Effect.gen(function* () {
  const policy = yield* CoordinationPolicy;
  return DelegationGuards.of({
    checkTaskAttempts: (subagents, task) =>
      policy.read().pipe(
        Effect.mapError((error) => error.message),
        Effect.flatMap(({ budgets }) => {
          const exceeded = taskAttemptsExceeded(budgets, subagents, task);
          return exceeded === null ? Effect.void : Effect.fail(exceeded);
        }),
      ),
  });
});

export const layer = Layer.effect(DelegationGuards, make);
