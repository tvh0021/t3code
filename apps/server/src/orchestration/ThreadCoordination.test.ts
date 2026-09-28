import * as Context from "effect/Context";
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  DEFAULT_COORDINATION_LIMITS,
  coordinationLimit,
  coordinationModelKey,
  coordinationRole,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Exit from "effect/Exit";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "@effect/vitest";
import { makeCoordinationTestLayer } from "./testing/coordinationTestLayer.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";
import { planCoordination } from "./coordinationDecider.ts";

const parentId = ThreadId.make("parent");
const projectId = ProjectId.make("project");
const now = "2026-09-27T00:00:00.000Z";
let id = 0;
const commandId = () => CommandId.make(`test:${++id}`);

const system = Effect.fn(function* (database?: string) {
  const scope = yield* Scope.make();
  const context = yield* Layer.buildWithScope(makeCoordinationTestLayer(database), scope);
  const engine = Context.get(context, OrchestrationEngineService);
  const snapshots = Context.get(context, ProjectionSnapshotQuery);
  const dispatch = (command: OrchestrationCommand) =>
    engine.dispatch(command).pipe(Effect.provide(context));
  const coordinate = (
    threadId: ThreadId,
    action: Extract<OrchestrationCommand, { type: "thread.coordination" }>["action"],
  ) =>
    dispatch({
      type: "thread.coordination",
      threadId,
      action,
      commandId: commandId(),
      createdAt: now,
    });
  const read = () => snapshots.getSnapshot();
  const events = () => Stream.runCollect(engine.readEvents(0, 1000));
  const start = Effect.fn(function* (model = "gpt-6-astra", quotaHandoffEnabled = false) {
    yield* dispatch({
      type: "project.create",
      commandId: commandId(),
      projectId,
      title: "Project",
      workspaceRoot: process.cwd(),
      createdAt: now,
    });
    yield* dispatch({
      type: "thread.create",
      commandId: commandId(),
      threadId: parentId,
      projectId,
      title: "Parent",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: "main",
      worktreePath: null,
      createdAt: now,
    });
    yield* coordinate(parentId, {
      type: "start",
      budgets: Object.entries(DEFAULT_COORDINATION_LIMITS).map(([model, limit]) => ({
        model,
        limit,
        used: 0,
      })),
      policyUpdatedAt: now,
      quotaHandoffEnabled,
    });
  });
  const spawn = Effect.fn(function* (name: string, model = "gpt-6-luna", instance = "codex") {
    const threadId = ThreadId.make(name);
    yield* coordinate(parentId, {
      type: "spawn",
      child: {
        type: "thread.create",
        commandId: commandId(),
        threadId,
        projectId,
        title: name,
        modelSelection: { instanceId: ProviderInstanceId.make(instance), model },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: "main",
        worktreePath: null,
        createdAt: now,
      },
      prompt: `Review ${name}`,
      mode: "review",
      reviewRef: "HEAD",
    });
    return threadId;
  });
  const session = (threadId: ThreadId, status: "running" | "idle") =>
    dispatch({
      type: "thread.session.set",
      commandId: commandId(),
      threadId,
      session: {
        threadId,
        status,
        providerName: "codex",
        providerInstanceId: ProviderInstanceId.make("codex"),
        runtimeMode: "full-access",
        activeTurnId: status === "running" ? TurnId.make(`${threadId}:turn`) : null,
        lastError: null,
        updatedAt: now,
      },
      createdAt: now,
    });
  return {
    engine,
    dispatch,
    coordinate,
    read,
    events,
    start,
    spawn,
    session,
    dispose: () => Scope.close(scope, Exit.void),
  };
});

describe("T3 orchestration layer coordination", () => {
  it.effect("interrupts a limited child and continues through a linked summary handoff", () =>
    Effect.gen(function* () {
      const app = yield* system();
      try {
        yield* app.start("gpt-6-sol", true);
        const sourceId = yield* app.spawn("limited-child", "gpt-6-sol");
        yield* app.coordinate(parentId, { type: "advance" });
        const sourceState = (yield* app.read()).threads.find(
          (thread) => thread.id === sourceId,
        )?.coordination;
        if (sourceState?.role !== "child") throw new Error("Missing source assignment");
        yield* app.dispatch({
          type: "thread.message.user.append",
          commandId: commandId(),
          threadId: sourceId,
          message: {
            messageId: MessageId.make("partial-assignment-history"),
            text: "The provider started editing the parser, then hit its quota.",
            attachments: [],
          },
          createdAt: now,
        });
        yield* app.session(sourceId, "running");
        const destinationId = ThreadId.make("fallback-child");
        yield* app.coordinate(parentId, {
          type: "quota-trigger",
          affectedThreadId: sourceId,
          destinationThreadId: destinationId,
          destinationModelSelection: {
            instanceId: ProviderInstanceId.make("claude"),
            model: "claude-opus-5",
          },
          destinationBudgetLimit: 1,
          switchProvider: true,
        });
        expect(
          (yield* app.read()).threads.find((thread) => thread.id === parentId)?.coordination,
        ).toMatchObject({
          role: "parent",
          status: "paused",
          quotaHandoff: {
            status: "handing-off",
            switchCount: 1,
            destinationThreadId: destinationId,
          },
        });
        expect(
          (yield* app.read()).threads.find((thread) => thread.id === sourceId)?.coordination,
        ).toMatchObject({ role: "child", phase: "cancelled" });
        expect(
          (yield* app.events()).some((event) => event.type === "thread.turn-interrupt-requested"),
        ).toBe(true);
        yield* app.dispatch({
          type: "thread.coordination.control",
          threadId: parentId,
          commandId: commandId(),
          action: "disable-quota-handoff",
          createdAt: now,
        });
        expect(
          (yield* app.read()).threads.find((thread) => thread.id === parentId)?.coordination,
        ).toMatchObject({
          role: "parent",
          quotaHandoff: { enabled: false, status: "handing-off" },
        });

        yield* app.session(sourceId, "idle");
        yield* app.coordinate(parentId, {
          type: "quota-settle",
          destinationThreadId: destinationId,
        });
        expect(
          (yield* app.read()).threads.find((thread) => thread.id === destinationId)?.coordination,
        ).toMatchObject({
          role: "child",
          phase: "queued",
          handoffFromThreadId: sourceId,
          handoffContext: expect.stringContaining("hit its quota"),
        });
        expect(
          (yield* app.read()).threads.find((thread) => thread.id === parentId)?.coordination,
        ).toMatchObject({ role: "parent", quotaHandoff: { enabled: false, status: "watching" } });

        yield* app.coordinate(parentId, { type: "advance" });
        const beforeContinuation = (yield* app.read()).threads.find(
          (thread) => thread.id === parentId,
        )?.coordination;
        if (beforeContinuation?.role !== "parent") throw new Error("Missing parent budget");
        expect(
          beforeContinuation.budgets.find((budget) => budget.model === "claude-opus-5"),
        ).toEqual({
          model: "claude-opus-5",
          limit: 1,
          used: 0,
        });
        yield* app.coordinate(destinationId, {
          type: "handoff-summary-complete",
          text: "The parser edit is partial; inspect the changed files and finish the parser.",
        });
        expect(
          (yield* app.read()).threads.find((thread) => thread.id === destinationId)?.coordination,
        ).toMatchObject({ role: "child", phase: "queued", handoffStage: "continue" });

        const snapshot = yield* app.read();
        const continuationPlan = planCoordination(
          {
            type: "thread.coordination",
            threadId: parentId,
            action: { type: "advance" },
            commandId: commandId(),
            createdAt: now,
          },
          snapshot.threads,
          () => false,
          () => false,
        );
        if (typeof continuationPlan === "string") throw new Error(continuationPlan);
        const continuationStart = continuationPlan.find(
          (command) => command.type === "thread.turn.start" && command.threadId === destinationId,
        );
        expect(continuationStart).toBeDefined();
        const afterContinuation = continuationPlan.find(
          (command) => command.type === "thread.coordination.set" && command.threadId === parentId,
        );
        if (
          afterContinuation?.type !== "thread.coordination.set" ||
          afterContinuation.coordination.role !== "parent"
        )
          throw new Error("Missing parent budget update");
        expect(
          afterContinuation.coordination.budgets.find((budget) => budget.model === "claude-opus-5"),
        ).toEqual({
          model: "claude-opus-5",
          limit: 1,
          used: 1,
        });
      } finally {
        yield* app.dispose();
      }
    }),
  );

  it.effect("manual parent activity cancels a pending quota reset", () =>
    Effect.gen(function* () {
      const app = yield* system();
      try {
        yield* app.start("gpt-6-sol", true);
        const sourceId = yield* app.spawn("waiting-child", "gpt-6-sol");
        yield* app.coordinate(parentId, { type: "advance" });
        yield* app.session(sourceId, "running");
        yield* app.coordinate(parentId, {
          type: "quota-wait",
          affectedThreadId: sourceId,
          resetAt: "2026-09-27T01:00:00.000Z",
          reason: "Waiting for the source quota reset.",
        });
        yield* app.dispatch({
          type: "thread.turn.start",
          commandId: commandId(),
          threadId: parentId,
          message: {
            messageId: MessageId.make("manual-quota-override"),
            role: "user",
            text: "Take over from here manually.",
            attachments: [],
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          createdAt: now,
        });
        expect(
          (yield* app.read()).threads.find((thread) => thread.id === parentId)?.coordination,
        ).toMatchObject({
          role: "parent",
          status: "paused",
          quotaHandoff: { status: "paused", reason: "Canceled by user activity." },
        });
      } finally {
        yield* app.dispose();
      }
    }),
  );

  it.effect("wakes a waiting Luna child with its XHigh option and clears the old reset state", () =>
    Effect.gen(function* () {
      const app = yield* system();
      try {
        yield* app.start("gpt-6-luna", true);
        const sourceId = yield* app.spawn("waiting-luna", "gpt-6-luna");
        yield* app.coordinate(parentId, { type: "advance" });
        yield* app.session(sourceId, "running");
        yield* app.coordinate(parentId, {
          type: "quota-wait",
          affectedThreadId: sourceId,
          resetAt: "2026-09-27T01:00:00.000Z",
          reason: "Waiting for the source quota reset.",
        });
        const destinationId = ThreadId.make("resumed-luna");
        yield* app.coordinate(parentId, {
          type: "quota-trigger",
          affectedThreadId: sourceId,
          destinationThreadId: destinationId,
          destinationModelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-6-luna",
            options: [{ id: "reasoningEffort", value: "xhigh" }],
          },
          switchProvider: false,
        });
        const snapshot = yield* app.read();
        expect(
          snapshot.threads.find((thread) => thread.id === destinationId)?.modelSelection,
        ).toMatchObject({
          model: "gpt-6-luna",
          options: [{ id: "reasoningEffort", value: "xhigh" }],
        });
        const coordination = snapshot.threads.find(
          (thread) => thread.id === parentId,
        )?.coordination;
        expect(coordination).toMatchObject({
          role: "parent",
          quotaHandoff: { status: "handing-off", switchCount: 0 },
        });
        if (coordination?.role !== "parent") throw new Error("Missing parent coordination");
        expect(coordination.quotaHandoff?.resetAt).toBeUndefined();
        expect(coordination.quotaHandoff?.reason).toBeUndefined();
      } finally {
        yield* app.dispose();
      }
    }),
  );

  it.effect("manual parent interrupt cancels a pending quota reset", () =>
    Effect.gen(function* () {
      const app = yield* system();
      try {
        yield* app.start("gpt-6-sol", true);
        const childId = yield* app.spawn("interruptible-child", "gpt-6-sol");
        yield* app.coordinate(parentId, { type: "advance" });
        yield* app.coordinate(parentId, {
          type: "quota-wait",
          affectedThreadId: childId,
          resetAt: "2026-09-27T01:00:00.000Z",
          reason: "Waiting for the source quota reset.",
        });
        yield* app.dispatch({
          type: "thread.turn.interrupt",
          commandId: commandId(),
          threadId: parentId,
          createdAt: now,
        });
        expect(
          (yield* app.read()).threads.find((thread) => thread.id === parentId)?.coordination,
        ).toMatchObject({
          role: "parent",
          status: "paused",
          quotaHandoff: { status: "paused", reason: "Canceled by user activity." },
        });
      } finally {
        yield* app.dispose();
      }
    }),
  );

  it.effect("creates a linked parent handoff and summarizes the settled source history", () =>
    Effect.gen(function* () {
      const app = yield* system();
      const destinationId = ThreadId.make("parent-handoff");
      try {
        yield* app.start("gpt-6-sol", true);
        yield* app.dispatch({
          type: "thread.message.user.append",
          commandId: commandId(),
          threadId: parentId,
          message: {
            messageId: MessageId.make("parent-task-history"),
            text: "Finish migrating the parser and preserve the partial edit.",
            attachments: [],
          },
          createdAt: now,
        });
        yield* app.session(parentId, "running");
        yield* app.coordinate(parentId, {
          type: "quota-trigger",
          affectedThreadId: parentId,
          destinationThreadId: destinationId,
          destinationModelSelection: {
            instanceId: ProviderInstanceId.make("claude"),
            model: "claude-opus-5",
          },
          destinationBudgetLimit: 1,
          switchProvider: true,
        });
        expect(
          (yield* app.read()).threads.find((thread) => thread.id === parentId)?.coordination,
        ).toMatchObject({
          role: "parent",
          status: "completed",
          quotaHandoff: { status: "handed-off", destinationThreadId: destinationId },
        });
        yield* app.session(parentId, "idle");
        yield* app.coordinate(destinationId, {
          type: "quota-settle",
          destinationThreadId: destinationId,
        });
        const destination = (yield* app.read()).threads.find(
          (thread) => thread.id === destinationId,
        );
        expect(destination?.coordination).toMatchObject({
          role: "parent",
          status: "active",
          quotaHandoff: { status: "summarizing", sourceThreadId: parentId },
        });
        expect(
          destination?.messages.some((message) =>
            message.text.includes("Finish migrating the parser"),
          ),
        ).toBe(true);

        const summaryText = "The parser migration is partial and needs completion.";
        const summarySnapshot = yield* app.read();
        const continuationPlan = planCoordination(
          {
            type: "thread.coordination",
            threadId: destinationId,
            action: { type: "handoff-summary-complete", text: summaryText },
            commandId: commandId(),
            createdAt: now,
          },
          summarySnapshot.threads,
          () => false,
          () => false,
        );
        if (typeof continuationPlan === "string") throw new Error(continuationPlan);
        const continuationStart = continuationPlan.find(
          (command) => command.type === "thread.turn.start" && command.threadId === destinationId,
        );
        expect(
          continuationStart?.type === "thread.turn.start" ? continuationStart.message.text : "",
        ).toContain(summaryText);
        yield* app.coordinate(destinationId, {
          type: "handoff-summary-complete",
          text: summaryText,
        });
        const continued = (yield* app.read()).threads.find((thread) => thread.id === destinationId);
        expect(continued?.coordination).toMatchObject({
          role: "parent",
          budgets: expect.arrayContaining([{ model: "claude-opus-5", limit: 1, used: 1 }]),
        });
      } finally {
        yield* app.dispose();
      }
    }),
  );

  it.effect("protects active members from archive, deletion, and budget-changing metadata", () =>
    Effect.gen(function* () {
      const app = yield* system();
      try {
        yield* app.start("gpt-6-sol");
        const child = yield* app.spawn("owned");
        for (const threadId of [parentId, child]) {
          expect(
            (yield* app
              .dispatch({ type: "thread.archive", threadId, commandId: commandId() })
              .pipe(Effect.exit))._tag,
          ).toBe("Failure");
        }
        expect(
          (yield* app
            .dispatch({ type: "thread.delete", threadId: child, commandId: commandId() })
            .pipe(Effect.exit))._tag,
        ).toBe("Failure");
        yield* app.dispatch({
          type: "thread.coordination.control",
          threadId: parentId,
          commandId: commandId(),
          action: "cancel",
          createdAt: now,
        });
        const ended = (yield* app.read()).threads.find(
          (thread) => thread.id === parentId,
        )?.coordination;
        expect(coordinationRole(ended)).toBeUndefined();
        yield* app.dispatch({ type: "thread.archive", threadId: child, commandId: commandId() });
      } finally {
        yield* app.dispose();
      }
    }),
  );

  it.effect("queues beyond four active children and serializes concurrent advance commands", () =>
    Effect.gen(function* () {
      const app = yield* system();
      try {
        yield* app.start();
        for (let i = 0; i < 6; i++) yield* app.spawn(`child${i}`);
        yield* Effect.all(
          [
            app.coordinate(parentId, { type: "advance" }),
            app.coordinate(parentId, { type: "advance" }),
          ],
          { concurrency: "unbounded" },
        );
        const snapshot = yield* app.read();
        expect(
          snapshot.threads.filter(
            (thread) =>
              thread.coordination?.role === "child" && thread.coordination.phase === "running",
          ),
        ).toHaveLength(4);
        expect(
          snapshot.threads.filter(
            (thread) =>
              thread.coordination?.role === "child" && thread.coordination.phase === "queued",
          ),
        ).toHaveLength(2);
        const starts = (yield* app.events()).filter(
          (event) => event.type === "thread.turn-start-requested",
        );
        expect(starts).toHaveLength(4);
        expect(new Set(starts.map((event) => event.commandId)).size).toBe(4);
        expect(
          snapshot.threads.find((thread) => thread.id === parentId)?.coordination,
        ).toMatchObject({
          budgets: expect.arrayContaining([
            { model: "gpt-6-luna", limit: null, used: 4 },
            { model: "gpt-6-astra", limit: 1, used: 0 },
          ]),
        });
      } finally {
        yield* app.dispose();
      }
    }),
  );

  it.effect(
    "keeps reports while busy, wakes on an individual report, and leaves later reports after Astra's limit",
    () =>
      Effect.gen(function* () {
        const app = yield* system();
        try {
          yield* app.start();
          const a = yield* app.spawn("a");
          const b = yield* app.spawn("b");
          yield* app.coordinate(parentId, { type: "advance" });
          yield* app.session(parentId, "running");
          const assignment = (yield* app.read()).threads.find(
            (thread) => thread.id === a,
          )?.coordination;
          if (assignment?.role !== "child") throw new Error("Missing child");
          const report = {
            type: "report",
            assignmentId: assignment.assignmentId,
            text: "A found a race",
          } as const;
          yield* app.coordinate(a, report);
          yield* app.coordinate(a, report);
          yield* app.coordinate(parentId, { type: "advance" });
          expect(
            (yield* app.events()).filter(
              (event) =>
                event.type === "thread.turn-start-requested" && event.payload.threadId === parentId,
            ),
          ).toHaveLength(0);
          yield* app.session(parentId, "idle");
          yield* app.coordinate(parentId, { type: "advance" });
          expect(
            (yield* app.events()).filter(
              (event) =>
                event.type === "thread.turn-start-requested" && event.payload.threadId === parentId,
            ),
          ).toHaveLength(1);
          yield* app.session(parentId, "running");
          yield* app.session(parentId, "idle");
          const other = (yield* app.read()).threads.find((thread) => thread.id === b)?.coordination;
          if (other?.role !== "child") throw new Error("Missing child");
          yield* app.coordinate(b, {
            type: "report",
            assignmentId: other.assignmentId,
            text: "B finished",
          });
          yield* app.coordinate(parentId, { type: "advance" });
          expect(
            (yield* app.read()).threads.find((thread) => thread.id === b)?.coordination,
          ).toMatchObject({ adopted: false, report: { text: "B finished" } });
          expect(
            (yield* app.events()).filter(
              (event) =>
                event.type === "thread.turn-start-requested" && event.payload.threadId === parentId,
            ),
          ).toHaveLength(1);
        } finally {
          yield* app.dispose();
        }
      }),
  );

  it.effect(
    "shares Sol's two turns across provider instances and persists counters and command receipts",
    () =>
      Effect.gen(function* () {
        const directory = yield* Effect.promise(() =>
          NodeFSP.mkdtemp("/private/tmp/t3-coordination-test-"),
        );
        const database = NodePath.join(directory, "state.sqlite");
        let app = yield* system(database);
        try {
          yield* app.start("gpt-6-luna");
          yield* app.spawn("a", "gpt-6-sol", "personal");
          yield* app.spawn("b", "openai/gpt-6-sol", "work");
          yield* app.spawn("c", "gpt-6-sol", "third");
          const advance: OrchestrationCommand = {
            type: "thread.coordination",
            commandId: commandId(),
            threadId: parentId,
            action: { type: "advance" },
            createdAt: now,
          };
          const receipt = yield* app.dispatch(advance);
          expect(yield* app.dispatch(advance)).toEqual(receipt);
          yield* app.dispose();
          app = yield* system(database);
          expect(yield* app.dispatch(advance)).toEqual(receipt);
          yield* app.coordinate(parentId, { type: "advance" });
          const snapshot = yield* app.read();
          expect(
            snapshot.threads.find((thread) => thread.id === ThreadId.make("c"))?.coordination,
          ).toMatchObject({ phase: "queued" });
          expect(
            snapshot.threads.find((thread) => thread.id === parentId)?.coordination,
          ).toMatchObject({
            budgets: expect.arrayContaining([{ model: "gpt-6-sol", limit: 2, used: 2 }]),
          });
        } finally {
          yield* app.dispose();
          yield* Effect.promise(() => NodeFSP.rm(directory, { recursive: true, force: true }));
        }
      }),
  );

  it.effect(
    "blocks grandchildren and direct child turns, and completes without waking for late reports",
    () =>
      Effect.gen(function* () {
        const app = yield* system();
        try {
          yield* app.start("gpt-6-sol");
          const child = yield* app.spawn("child");
          yield* app.coordinate(parentId, { type: "advance" });
          expect(
            (yield* app
              .coordinate(child, { type: "start", budgets: [], policyUpdatedAt: now })
              .pipe(Effect.exit))._tag,
          ).toBe("Failure");
          expect(
            (yield* app
              .dispatch({
                type: "thread.turn.start",
                threadId: child,
                commandId: commandId(),
                message: {
                  messageId: MessageId.make("manual"),
                  role: "user",
                  text: "Bypass",
                  attachments: [],
                },
                runtimeMode: "full-access",
                interactionMode: "default",
                createdAt: now,
              })
              .pipe(Effect.exit))._tag,
          ).toBe("Failure");
          yield* app.dispatch({
            type: "thread.coordination.control",
            commandId: commandId(),
            threadId: parentId,
            action: "complete",
            createdAt: now,
          });
          const assignment = (yield* app.read()).threads.find(
            (thread) => thread.id === child,
          )?.coordination;
          if (assignment?.role !== "child") throw new Error("Missing child");
          yield* app.coordinate(child, {
            type: "report",
            assignmentId: assignment.assignmentId,
            text: "Late result",
          });
          yield* app.coordinate(parentId, { type: "advance" });
          expect(
            (yield* app.events()).filter(
              (event) =>
                event.type === "thread.turn-start-requested" && event.payload.threadId === parentId,
            ),
          ).toHaveLength(0);
          expect(
            (yield* app.read()).threads.find((thread) => thread.id === child)?.coordination,
          ).toMatchObject({ report: { text: "Late result" }, adopted: false });
        } finally {
          yield* app.dispose();
        }
      }),
  );
});

it("uses explicit limits and exact price boundaries for new models", () => {
  expect(coordinationModelKey("anthropic/claude-opus-5-5-20260926")).toBe("claude-opus-5.5");
  expect(coordinationLimit("claude-sonnet-5", 0.5)).toBe(1);
  expect(coordinationLimit("glm-5.3-flash", 12)).toBeNull();
  expect(coordinationLimit("new", 0.99)).toBeNull();
  expect(coordinationLimit("new", 1)).toBe(4);
  expect(coordinationLimit("new", 10)).toBe(4);
  expect(coordinationLimit("new", 10.01)).toBe(1);
  expect(coordinationLimit("unpriced", undefined)).toBeUndefined();
});
