import { describe, expect, it } from "@effect/vitest";
import {
  coordinationLimit,
  coordinationModelKey,
  DEFAULT_COORDINATION_LIMITS,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { coordinationReviewDir } from "./coordinationIds.ts";

describe("delegate_task turn budget enforcement", () => {
  function checkBudget(input: {
    targetModel: string;
    subagents: ReadonlyArray<{
      origin: "app_owned" | "provider_native";
      model?: string | null;
      modelSelection?: { model: string } | null;
    }>;
    overrides?: Readonly<Record<string, number | null>>;
    isRetry?: boolean;
  }): { allowed: true } | { allowed: false; error: string } {
    if (input.isRetry) return { allowed: true };

    const effectiveOverrides = {
      ...DEFAULT_COORDINATION_LIMITS,
      ...Object.fromEntries(
        Object.entries(input.overrides ?? {}).map(([model, limit]) => [
          coordinationModelKey(model),
          limit,
        ]),
      ),
    };

    const targetModel = input.targetModel;
    const modelKey = coordinationModelKey(targetModel);
    const limit = coordinationLimit(targetModel, undefined, effectiveOverrides);

    if (limit !== undefined && limit !== null) {
      const used = input.subagents.filter((subagent) => {
        if (subagent.origin !== "app_owned") return false;
        const m = subagent.model ?? subagent.modelSelection?.model;
        return m !== null && m !== undefined && coordinationModelKey(m) === modelKey;
      }).length;
      if (used >= limit) {
        return {
          allowed: false,
          error: `Turn budget exceeded for model "${targetModel}". Limit is ${limit} turns.`,
        };
      }
    }
    return { allowed: true };
  }

  it("enforces default limit for gpt-6-astra (1 turn)", () => {
    expect(checkBudget({ targetModel: "gpt-6-astra", subagents: [] })).toEqual({ allowed: true });

    const rejected = checkBudget({
      targetModel: "gpt-6-astra",
      subagents: [{ origin: "app_owned", model: "gpt-6-astra" }],
    });
    expect(rejected).toEqual({
      allowed: false,
      error: 'Turn budget exceeded for model "gpt-6-astra". Limit is 1 turns.',
    });
  });

  it("enforces default limit for gpt-6-sol (2 turns)", () => {
    expect(
      checkBudget({
        targetModel: "gpt-6-sol",
        subagents: [{ origin: "app_owned", model: "gpt-6-sol" }],
      }),
    ).toEqual({ allowed: true });

    const rejected = checkBudget({
      targetModel: "gpt-6-sol",
      subagents: [
        { origin: "app_owned", model: "gpt-6-sol" },
        { origin: "app_owned", model: "openai/gpt-6-sol" },
      ],
    });
    expect(rejected).toEqual({
      allowed: false,
      error: 'Turn budget exceeded for model "gpt-6-sol". Limit is 2 turns.',
    });
  });

  it("ignores provider_native subagents when counting turns", () => {
    const result = checkBudget({
      targetModel: "gpt-6-astra",
      subagents: [
        { origin: "provider_native", model: "gpt-6-astra" },
        { origin: "provider_native", model: "gpt-6-astra" },
      ],
    });
    expect(result).toEqual({ allowed: true });
  });

  it("applies settings overrides over defaults", () => {
    const overridden = checkBudget({
      targetModel: "gpt-6-astra",
      subagents: [{ origin: "app_owned", model: "gpt-6-astra" }],
      overrides: { "gpt-6-astra": 5 },
    });
    expect(overridden).toEqual({ allowed: true });

    const rejectedAtLimit = checkBudget({
      targetModel: "gpt-6-astra",
      subagents: Array.from({ length: 5 }, () => ({
        origin: "app_owned" as const,
        model: "gpt-6-astra",
      })),
      overrides: { "gpt-6-astra": 5 },
    });
    expect(rejectedAtLimit).toEqual({
      allowed: false,
      error: 'Turn budget exceeded for model "gpt-6-astra". Limit is 5 turns.',
    });
  });

  it("allows unlimited models like gpt-6-luna and gemini-3.8-flash", () => {
    const result = checkBudget({
      targetModel: "gpt-6-luna",
      subagents: Array.from({ length: 10 }, () => ({
        origin: "app_owned" as const,
        model: "gpt-6-luna",
      })),
    });
    expect(result).toEqual({ allowed: true });
  });

  it("bypasses budget checks for idempotent retries", () => {
    const retry = checkBudget({
      targetModel: "gpt-6-astra",
      subagents: [{ origin: "app_owned", model: "gpt-6-astra" }],
      isRetry: true,
    });
    expect(retry).toEqual({ allowed: true });
  });
});

describe("read-only review snapshots", () => {
  it("computes the review snapshot directory correctly", () => {
    const config = { worktreesDir: "/tmp/worktrees" };
    const id = ThreadId.make("c8a5146c-c9e1-4560-a292-1cf7bb98da20");
    const pathMock = { join: (...parts: string[]) => parts.join("/") };

    const dir = coordinationReviewDir(config, id, pathMock);
    expect(dir).toBe("/tmp/worktrees/coordination-reviews/c8a5146c-c9e1-4560-a292-1cf7bb98da20");
  });

  interface GitRunMock {
    command: string;
    args: readonly string[];
    cwd: string;
  }

  function simulateReviewSnapshotCreation(input: {
    reviewRef: string;
    revParseExitCode: number;
    revParseStdout: string;
    cloneExitCode?: number;
    checkoutExitCode?: number;
  }) {
    return Effect.gen(function* () {
      const gitCalls: GitRunMock[] = [];
      const cleanedPaths: string[] = [];

      const processRunner = {
        run: (cmd: GitRunMock) =>
          Effect.sync(() => {
            gitCalls.push(cmd);
            if (cmd.args[0] === "rev-parse") {
              return {
                code: input.revParseExitCode,
                stdout: input.revParseStdout,
                stderr: "",
              };
            }
            if (cmd.args[0] === "clone") {
              return {
                code: input.cloneExitCode ?? 0,
                stdout: "",
                stderr: input.cloneExitCode !== 0 ? "clone error" : "",
              };
            }
            if (cmd.args[0] === "checkout") {
              return {
                code: input.checkoutExitCode ?? 0,
                stdout: "",
                stderr: input.checkoutExitCode !== 0 ? "checkout error" : "",
              };
            }
            return { code: 0, stdout: "", stderr: "" };
          }),
      };

      const cwd = "/workspace/project";
      const config = { worktreesDir: "/tmp/worktrees" };
      const path = {
        join: (...p: string[]) => p.join("/"),
        dirname: (p: string) => p.slice(0, p.lastIndexOf("/")),
      };

      const revision = yield* processRunner.run({
        command: "git",
        args: ["rev-parse", "--verify", "--end-of-options", `${input.reviewRef}^{commit}`],
        cwd,
      });
      const resolvedRef = revision.stdout.trim();
      if (revision.code !== 0 || !/^[a-f0-9]{40,64}$/.test(resolvedRef)) {
        return yield* Effect.fail(`The review revision "${input.reviewRef}" is not an existing Git commit.`);
      }

      const snapshotId = ThreadId.make("11111111-2222-3333-4444-555555555555");
      const snapshotPath = coordinationReviewDir(config, snapshotId, path);

      const removeSnapshot = (target: string) =>
        Effect.sync(() => {
          cleanedPaths.push(target);
        });

      yield* Effect.gen(function* () {
        const cloned = yield* processRunner.run({
          command: "git",
          args: ["clone", "--local", "--no-hardlinks", "--no-checkout", "--", cwd, snapshotPath],
          cwd,
        });
        if (cloned.code !== 0) {
          return yield* Effect.fail(`Could not clone the review revision: ${cloned.stderr}`);
        }
        const checkout = yield* processRunner.run({
          command: "git",
          args: ["checkout", "--detach", resolvedRef],
          cwd: snapshotPath,
        });
        if (checkout.code !== 0) {
          return yield* Effect.fail("Could not check out the review revision.");
        }
      }).pipe(
        Effect.onError(() => removeSnapshot(snapshotPath)),
      );

      return { snapshotPath, gitCalls, cleanedPaths };
    });
  }

  it("fails when review revision cannot be parsed as a commit", () => {
    const result = Effect.runSyncExit(
      simulateReviewSnapshotCreation({
        reviewRef: "non-existent-branch",
        revParseExitCode: 128,
        revParseStdout: "",
      }),
    );
    expect(Exit.isFailure(result)).toBe(true);
    if (Exit.isFailure(result)) {
      expect(result.cause.toString()).toContain("is not an existing Git commit.");
    }
  });

  it("clones and detaches checkout for valid commit", () => {
    const validSha = "eacd24e8e3000000000000000000000000000000";
    const result = Effect.runSync(
      simulateReviewSnapshotCreation({
        reviewRef: "HEAD",
        revParseExitCode: 0,
        revParseStdout: `${validSha}\n`,
      }),
    );
    expect(result.snapshotPath).toBe(
      "/tmp/worktrees/coordination-reviews/11111111-2222-3333-4444-555555555555",
    );
    expect(result.gitCalls).toHaveLength(3);
    expect(result.gitCalls[1]?.args).toEqual([
      "clone",
      "--local",
      "--no-hardlinks",
      "--no-checkout",
      "--",
      "/workspace/project",
      result.snapshotPath,
    ]);
    expect(result.gitCalls[2]?.args).toEqual([
      "checkout",
      "--detach",
      validSha,
    ]);
    expect(result.cleanedPaths).toHaveLength(0);
  });

  it("cleans up snapshot directory on checkout failure", () => {
    const validSha = "eacd24e8e3000000000000000000000000000000";
    const result = Effect.runSyncExit(
      simulateReviewSnapshotCreation({
        reviewRef: "HEAD",
        revParseExitCode: 0,
        revParseStdout: `${validSha}\n`,
        checkoutExitCode: 1,
      }),
    );
    expect(Exit.isFailure(result)).toBe(true);
    if (Exit.isFailure(result)) {
      expect(result.cause.toString()).toContain("Could not check out the review revision.");
    }
  });
});
