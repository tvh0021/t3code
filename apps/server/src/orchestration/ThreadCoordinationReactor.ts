import { CommandId, type OrchestrationEvent, type ThreadId } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";

import { ProjectionThreadActivityRepository } from "../persistence/Services/ProjectionThreadActivities.ts";
import { ProjectionThreadActivityRepositoryLive } from "../persistence/Layers/ProjectionThreadActivities.ts";

export class ThreadCoordinationReactor extends Context.Service<
  ThreadCoordinationReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drainThrough: (sequence: number) => Effect.Effect<void>;
  }
>()("t3/orchestration/ThreadCoordinationReactor") {}

export const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const activities = yield* ProjectionThreadActivityRepository;
  const crypto = yield* Crypto.Crypto;
  const advance = Effect.fn("ThreadCoordinationReactor.advance")(function* (threadId: ThreadId) {
    yield* engine.dispatch({
      type: "thread.coordination",
      threadId,
      commandId: CommandId.make(`coordination:${yield* crypto.randomUUIDv4.pipe(Effect.orDie)}`),
      action: { type: "advance" },
      createdAt: DateTime.formatIso(yield* DateTime.now),
    });
  });
  const reconcile = Effect.fn("ThreadCoordinationReactor.reconcile")(function* (
    threadId: ThreadId,
  ) {
    const runtime = yield* snapshots.getThreadRuntimeContext(threadId);
    const workerState = Option.isSome(runtime) ? runtime.value.coordination : null;
    if (workerState?.role === "child" && workerState.phase === "running" && workerState.turnId) {
      const observations = yield* activities.listByThreadId({
        threadId,
        activityKinds: ["coordination.turn.finished"],
      });
      const terminal = observations.findLast(
        (activity) =>
          activity.turnId === workerState.turnId &&
          typeof activity.payload === "object" &&
          activity.payload !== null &&
          "assignmentId" in activity.payload &&
          activity.payload.assignmentId === workerState.assignmentId,
      );
      if (
        terminal &&
        typeof terminal.payload === "object" &&
        terminal.payload !== null &&
        "text" in terminal.payload &&
        typeof terminal.payload.text === "string"
      ) {
        yield* engine.dispatch({
          type: "thread.coordination",
          threadId,
          commandId: CommandId.make(
            `coordination:${workerState.handoffStage === "summarize" ? "summary" : "finish"}:${workerState.assignmentId}`,
          ),
          action:
            workerState.handoffStage === "summarize"
              ? { type: "handoff-summary-complete", text: terminal.payload.text }
              : {
                  type: "finish",
                  assignmentId: workerState.assignmentId,
                  text: terminal.payload.text,
                },
          createdAt: DateTime.formatIso(yield* DateTime.now),
        });
      }
    }
  });
  const completeParentSummary = Effect.fn("ThreadCoordinationReactor.completeParentSummary")(
    function* (threadId: ThreadId) {
      const shell = yield* snapshots.getThreadShellById(threadId);
      if (Option.isNone(shell)) return;
      const state = shell.value.coordination;
      const latestTurn = shell.value.latestTurn;
      if (
        state?.role !== "parent" ||
        state.quotaHandoff?.status !== "summarizing" ||
        !latestTurn ||
        latestTurn.state === "running" ||
        latestTurn.state === "interrupted" ||
        shell.value.session?.status === "starting" ||
        shell.value.session?.status === "running"
      )
        return;
      const detail = yield* snapshots
        .getThreadDetailById(threadId)
        .pipe(Effect.map(Option.getOrUndefined));
      const summary = detail?.messages
        .filter((message) => message.role === "assistant" && message.turnId === latestTurn.turnId)
        .map((message) => message.text)
        .join("\n\n")
        .trim()
        .slice(0, 8_000);
      yield* engine.dispatch({
        type: "thread.coordination",
        threadId,
        commandId: CommandId.make(
          `coordination:quota-summary-complete:${threadId}:${latestTurn.turnId}`,
        ),
        action: {
          type: "handoff-summary-complete",
          text:
            summary ||
            `The destination summary turn ended with ${latestTurn.state} and produced no summary text. Inspect the linked source thread and current workspace before continuing.`,
        },
        createdAt: DateTime.formatIso(yield* DateTime.now),
      });
    },
  );
  const process = Effect.fn("ThreadCoordinationReactor.process")(function* (
    event: OrchestrationEvent,
  ) {
    if (event.aggregateKind !== "thread") return;
    const threadId = event.aggregateId as ThreadId;
    const shell = yield* snapshots.getThreadShellById(threadId);
    if (Option.isNone(shell) || !shell.value.coordination) return;
    const state = shell.value.coordination;
    if (
      state.role === "parent" &&
      (event.type === "thread.coordination-updated" ||
        event.type === "thread.session-set" ||
        event.type === "thread.activity-appended")
    )
      yield* completeParentSummary(threadId);
    if (
      state.role === "child" &&
      state.phase === "running" &&
      event.type === "thread.activity-appended" &&
      event.payload.activity.kind === "provider.turn.start.failed"
    ) {
      const payload = event.payload.activity.payload;
      if (
        typeof payload === "object" &&
        payload !== null &&
        "requestId" in payload &&
        payload.requestId === `coordination:${state.assignmentId}`
      ) {
        yield* engine.dispatch({
          type: "thread.coordination",
          threadId,
          commandId: CommandId.make(`coordination:finish:${state.assignmentId}`),
          action: {
            type: "finish",
            assignmentId: state.assignmentId,
            text: `Assignment could not start: ${"detail" in payload ? String(payload.detail).slice(0, 7_000) : event.payload.activity.summary}`,
          },
          createdAt: event.occurredAt,
        });
      }
    }
    if (
      state.role === "child" &&
      state.phase === "running" &&
      (event.type === "thread.coordination-updated" ||
        (event.type === "thread.activity-appended" &&
          event.payload.activity.kind === "coordination.turn.finished"))
    ) {
      yield* reconcile(threadId);
    }
    yield* advance(state.role === "child" ? state.parentId : threadId);
  });
  const recovered = yield* Deferred.make<void>();
  const worker = yield* makeDrainableWorker((event: OrchestrationEvent) =>
    Deferred.await(recovered).pipe(
      Effect.andThen(process(event)),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logWarning("Thread coordination could not process an event", {
              sequence: event.sequence,
              cause: Cause.pretty(cause),
            }),
      ),
    ),
  );
  const seen = yield* SubscriptionRef.make(0);
  const start = Effect.fn("ThreadCoordinationReactor.start")(function* () {
    // Subscribe before recovery so reports cannot land between the snapshot and subscription.
    const events = yield* engine.subscribeDomainEvents;
    yield* SubscriptionRef.set(seen, yield* engine.latestSequence);
    yield* Stream.runForEach(events, (event) =>
      (event.type === "thread.coordination-updated" ||
      event.type === "thread.session-set" ||
      event.type === "thread.activity-appended" ||
      event.type === "thread.deleted"
        ? worker.enqueue(event)
        : Effect.void
      ).pipe(Effect.andThen(SubscriptionRef.set(seen, event.sequence))),
    ).pipe(Effect.forkScoped);
    const snapshot = yield* snapshots.getShellSnapshot().pipe(Effect.orDie);
    for (const thread of snapshot.threads) {
      if (thread.coordination?.role !== "parent" || thread.coordination.status !== "active")
        continue;
      // Native acceptance may have happened just before a crash. Never replay a paid turn.
      yield* engine
        .dispatch({
          type: "thread.coordination.control",
          threadId: thread.id,
          commandId: CommandId.make(
            `coordination:recovery:${yield* crypto.randomUUIDv4.pipe(Effect.orDie)}`,
          ),
          action: "pause",
          createdAt: DateTime.formatIso(yield* DateTime.now),
        })
        .pipe(Effect.orDie);
    }
    // Pause all parents before settling receipts: recovery must never launch paid work.
    for (const thread of snapshot.threads) {
      if (thread.coordination?.role === "child" && thread.coordination.phase === "running")
        yield* reconcile(thread.id).pipe(Effect.orDie);
    }
    for (const thread of snapshot.threads) {
      if (
        thread.coordination?.role === "parent" &&
        thread.coordination.quotaHandoff?.status === "summarizing"
      )
        yield* completeParentSummary(thread.id).pipe(Effect.orDie);
    }
    yield* Deferred.succeed(recovered, undefined);
  });
  const drainThrough = Effect.fn("ThreadCoordinationReactor.drainThrough")(function* (
    sequence: number,
  ) {
    yield* SubscriptionRef.changes(seen).pipe(
      Stream.filter((value) => value >= sequence),
      Stream.runHead,
    );
    yield* worker.drain;
  });
  return { start, drainThrough };
});

export const layer = Layer.effect(ThreadCoordinationReactor, make).pipe(
  Layer.provide(ProjectionThreadActivityRepositoryLive),
);
