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
  const start = Effect.fn(function* (model = "gpt-6-astra") {
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

describe("flat thread coordination", () => {
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
