import {
  type CoordinationBudget,
  coordinationModelKey,
  type OrchestrationV2Subagent,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { ServerConfig } from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
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
 * Clones `cwd` into `snapshotPath` detached at `reviewRef`, so a reviewer reads a
 * fixed commit instead of the parent's changing files. A local clone keeps its
 * own objects without inheriting hooks or config. StorageCleanup removes
 * snapshots no thread references; a failed clone is removed here.
 */
export const createReviewSnapshot = Effect.fn("createReviewSnapshot")(function* (input: {
  readonly cwd: string;
  readonly reviewRef: string;
  readonly snapshotPath: string;
}) {
  const processes = yield* ProcessRunner.ProcessRunner;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const revision = yield* processes.run({
    command: "git",
    args: ["rev-parse", "--verify", "--end-of-options", `${input.reviewRef}^{commit}`],
    cwd: input.cwd,
    timeout: "10 seconds",
  });
  const commit = revision.stdout.trim();
  if (revision.code !== 0 || !/^[a-f0-9]{40,64}$/.test(commit))
    return yield* Effect.fail(
      `The review revision "${input.reviewRef}" is not an existing Git commit.`,
    );
  yield* fs.makeDirectory(path.dirname(input.snapshotPath), { recursive: true });
  yield* Effect.gen(function* () {
    const cloned = yield* processes.run({
      command: "git",
      args: [
        "clone",
        "--local",
        "--no-hardlinks",
        "--no-checkout",
        "--",
        input.cwd,
        input.snapshotPath,
      ],
      cwd: input.cwd,
      timeout: "30 seconds",
    });
    if (cloned.code !== 0)
      return yield* Effect.fail(
        `Could not clone the review revision: ${cloned.stderr.slice(0, 500)}`,
      );
    const checkout = yield* processes.run({
      command: "git",
      args: ["checkout", "--detach", commit],
      cwd: input.snapshotPath,
      timeout: "30 seconds",
    });
    if (checkout.code !== 0) return yield* Effect.fail("Could not check out the review revision.");
  }).pipe(
    Effect.onError(() => fs.remove(input.snapshotPath, { recursive: true }).pipe(Effect.ignore)),
  );
  return commit;
});

/**
 * Personal-fork limits on upstream `delegate_task`: per-model turn budgets and
 * read-only review snapshots. Failures are user-facing messages.
 */
export class DelegationGuards extends Context.Service<
  DelegationGuards,
  {
    readonly checkTurnBudget: (
      subagents: ReadonlyArray<DelegatedChild>,
      targetModel: string,
    ) => Effect.Effect<void, string>;
    /** Returns the snapshot directory to use as the child's worktree. */
    readonly prepareReviewSnapshot: (
      cwd: string,
      reviewRef: string,
    ) => Effect.Effect<string, string>;
    readonly removeReviewSnapshot: (snapshotPath: string) => Effect.Effect<void>;
  }
>()("t3/orchestration-v2/delegationGuards") {}

export const make = Effect.gen(function* () {
  const policy = yield* CoordinationPolicy;
  const config = yield* ServerConfig;
  const crypto = yield* Crypto.Crypto;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const processes = yield* ProcessRunner.ProcessRunner;
  return DelegationGuards.of({
    checkTurnBudget: (subagents, targetModel) =>
      policy.read().pipe(
        Effect.mapError((error) => error.message),
        Effect.flatMap(({ budgets }) => {
          const exceeded = turnBudgetExceeded(budgets, subagents, targetModel);
          return exceeded === null ? Effect.void : Effect.fail(exceeded);
        }),
      ),
    prepareReviewSnapshot: (cwd, reviewRef) =>
      Effect.gen(function* () {
        const id = ThreadId.make(yield* crypto.randomUUIDv4.pipe(Effect.orDie));
        const snapshotPath = path.join(config.worktreesDir, "coordination-reviews", id);
        yield* createReviewSnapshot({ cwd, reviewRef, snapshotPath });
        return snapshotPath;
      }).pipe(
        Effect.provideService(ProcessRunner.ProcessRunner, processes),
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
        Effect.mapError((error) =>
          typeof error === "string"
            ? error
            : `Could not prepare the review snapshot: ${error.message}`,
        ),
      ),
    removeReviewSnapshot: (snapshotPath) =>
      fs.remove(snapshotPath, { recursive: true }).pipe(Effect.ignore),
  });
});

export const layer = Layer.effect(DelegationGuards, make).pipe(Layer.provide(ProcessRunner.layer));
