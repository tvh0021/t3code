import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ProcessRunner from "../processRunner.ts";
import { createReviewSnapshot, turnBudgetExceeded } from "./delegationGuards.ts";

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

describe("createReviewSnapshot", () => {
  const layer = Layer.provideMerge(ProcessRunner.layer, NodeServices.layer);

  const git = (cwd: string, ...args: string[]) =>
    Effect.flatMap(ProcessRunner.ProcessRunner, (runner) =>
      runner.run({ command: "git", args, cwd, timeout: "10 seconds" }),
    );

  const makeRepo = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped();
    const repo = path.join(root, "repo");
    yield* fs.makeDirectory(repo);
    yield* git(repo, "init", "-q");
    yield* fs.writeFileString(path.join(repo, "file.txt"), "first\n");
    yield* git(repo, "add", ".");
    yield* git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "first");
    yield* fs.writeFileString(path.join(repo, "file.txt"), "uncommitted\n");
    return { root, repo, path, fs };
  });

  it.effect("checks out the committed revision, not the working tree", () =>
    Effect.gen(function* () {
      const { root, repo, path, fs } = yield* makeRepo;
      const snapshotPath = path.join(root, "reviews", "snap");
      yield* createReviewSnapshot({ cwd: repo, reviewRef: "HEAD", snapshotPath });
      expect(yield* fs.readFileString(path.join(snapshotPath, "file.txt"))).toBe("first\n");
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("rejects an unknown revision without leaving a snapshot", () =>
    Effect.gen(function* () {
      const { root, repo, path, fs } = yield* makeRepo;
      const snapshotPath = path.join(root, "reviews", "missing");
      const exit = yield* Effect.exit(
        createReviewSnapshot({ cwd: repo, reviewRef: "no-such-ref", snapshotPath }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      expect(yield* fs.exists(snapshotPath)).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );
});
