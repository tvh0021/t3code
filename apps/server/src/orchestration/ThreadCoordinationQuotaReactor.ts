import {
  CommandId,
  ThreadId,
  coordinationModelKey,
  type OrchestrationThreadShell,
  type ServerProvider,
  type ServerSettings as ServerSettingsValue,
  type ThreadCoordination,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as ServerSettings from "../serverSettings.ts";
import { coordinationProviderIssue } from "../provider/coordinationWorkerPolicy.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";
import { firstEligibleQuotaFallback, quotaWindowVerdict } from "./CoordinationQuotaPolicy.ts";

type Parent = Extract<ThreadCoordination, { role: "parent" }>;

export class ThreadCoordinationQuotaReactor extends Context.Service<
  ThreadCoordinationQuotaReactor,
  { readonly start: () => Effect.Effect<void, never, Scope.Scope> }
>()("t3/orchestration/ThreadCoordinationQuotaReactor") {}

const isRunning = (thread: OrchestrationThreadShell): boolean =>
  thread.latestTurn?.state === "running" ||
  thread.session?.status === "starting" ||
  thread.session?.status === "running";

const isSettled = (thread: OrchestrationThreadShell): boolean =>
  thread.latestTurn?.state !== "running" &&
  thread.session?.status !== "starting" &&
  thread.session?.status !== "running";

const hasBudget = (state: Parent, model: string, requiredTurns: number): boolean => {
  const budget = state.budgets.find((entry) => entry.model === coordinationModelKey(model));
  return Boolean(budget && (budget.limit === null || budget.limit - budget.used >= requiredTurns));
};

const isProviderReadyForHandoff = (provider: ServerProvider | undefined): boolean =>
  Boolean(
    provider?.enabled &&
    provider.installed &&
    provider.status === "ready" &&
    provider.availability !== "unavailable" &&
    provider.auth.status === "authenticated",
  );

export const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const providers = yield* ProviderRegistry;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const crypto = yield* Crypto.Crypto;

  const dispatchWait = Effect.fn("ThreadCoordinationQuotaReactor.wait")(function* (input: {
    readonly parentId: ThreadId;
    readonly source: OrchestrationThreadShell;
    readonly resetAt?: string;
    readonly reason: string;
  }) {
    yield* engine.dispatch({
      type: "thread.coordination",
      threadId: input.parentId,
      commandId: CommandId.make(`quota:wait:${yield* crypto.randomUUIDv4}`),
      action: {
        type: "quota-wait",
        affectedThreadId: input.source.id,
        ...(input.resetAt ? { resetAt: input.resetAt } : {}),
        reason: input.reason,
      },
      createdAt: DateTime.formatIso(yield* DateTime.now),
    });
  });

  const dispatchHandoff = Effect.fn("ThreadCoordinationQuotaReactor.handoff")(function* (input: {
    readonly parent: OrchestrationThreadShell;
    readonly state: Parent;
    readonly source: OrchestrationThreadShell;
    readonly destination: Pick<ServerProvider, "instanceId">;
    readonly model: string;
    readonly switchProvider: boolean;
  }) {
    const destinationBudget = input.state.budgets.find(
      (budget) => budget.model === coordinationModelKey(input.model),
    );
    const destinationThreadId = ThreadId.make(yield* crypto.randomUUIDv4);
    yield* engine.dispatch({
      type: "thread.coordination",
      threadId: input.parent.id,
      commandId: CommandId.make(`quota:handoff:${destinationThreadId}`),
      action: {
        type: "quota-trigger",
        affectedThreadId: input.source.id,
        destinationThreadId,
        destinationModelSelection: {
          instanceId: input.destination.instanceId,
          model: input.model,
          ...(!input.switchProvider && input.source.modelSelection.options
            ? { options: input.source.modelSelection.options }
            : {}),
        },
        ...(destinationBudget ? { destinationBudgetLimit: destinationBudget.limit } : {}),
        switchProvider: input.switchProvider,
      },
      createdAt: DateTime.formatIso(yield* DateTime.now),
    });
  });

  const freshProvider = Effect.fn("ThreadCoordinationQuotaReactor.freshProvider")(function* (
    instanceId: ServerProvider["instanceId"],
    force: boolean,
    now: string,
  ) {
    let current = yield* providers.getProviders;
    let provider = current.find((entry) => entry.instanceId === instanceId);
    const checkedAt = provider?.usageLimits?.checkedAt;
    const stale =
      !checkedAt ||
      !Number.isFinite(Date.parse(checkedAt)) ||
      Date.parse(now) - Date.parse(checkedAt) > 60_000;
    if (provider && (force || stale)) {
      current = yield* providers
        .refreshInstance(instanceId)
        .pipe(Effect.catchCause(() => Effect.succeed(current)));
      provider = current.find((entry) => entry.instanceId === instanceId);
    }
    return { provider, providers: current };
  });

  const inspectWaitingReset = Effect.fn("ThreadCoordinationQuotaReactor.inspectWaitingReset")(
    function* (
      parent: OrchestrationThreadShell,
      state: Parent,
      source: OrchestrationThreadShell,
      settings: ServerSettingsValue,
      now: string,
    ) {
      const quota = state.quotaHandoff!;
      if (quota.resetAt && Date.parse(quota.resetAt) > Date.parse(now)) return;
      const { provider } = yield* freshProvider(source.modelSelection.instanceId, true, now);
      if (!isProviderReadyForHandoff(provider)) {
        yield* dispatchWait({
          parentId: parent.id,
          source,
          reason:
            "The source provider is no longer ready. Resume this orchestration layer manually after reconnecting it.",
        });
        return;
      }
      const verdict = quotaWindowVerdict({
        usageLimits: provider?.usageLimits,
        thresholdPercent: settings.coordinationQuotaHandoffThresholdPercent,
        now,
      });
      if (verdict.status === "below-threshold") {
        if (!hasBudget(state, source.modelSelection.model, 1)) {
          yield* dispatchWait({
            parentId: parent.id,
            source,
            reason: `Quota reset, but the orchestration layer has no remaining automatic turn for ${coordinationModelKey(source.modelSelection.model)}. Resume it manually after adjusting the model budget.`,
          });
          return;
        }
        yield* dispatchHandoff({
          parent,
          state,
          source,
          destination: { instanceId: source.modelSelection.instanceId },
          model: source.modelSelection.model,
          switchProvider: false,
        });
        return;
      }
      if (verdict.status === "threshold-reached" && verdict.resetAt) {
        yield* dispatchWait({
          parentId: parent.id,
          source,
          resetAt: verdict.resetAt,
          reason: `A quota window is still at the configured threshold. Waiting for the next reset at ${verdict.resetAt}.`,
        });
        return;
      }
      yield* dispatchWait({
        parentId: parent.id,
        source,
        reason:
          verdict.status === "unknown"
            ? `Cannot resume automatically because ${verdict.reason.toLowerCase()}`
            : "The provider reported no usable reset time. Resume this orchestration layer manually when quota is available.",
      });
    },
  );

  const inspectRunning = Effect.fn("ThreadCoordinationQuotaReactor.inspectRunning")(function* (
    parent: OrchestrationThreadShell,
    state: Parent,
    source: OrchestrationThreadShell,
    forceProbe: boolean,
    settings: ServerSettingsValue,
    now: string,
  ) {
    const { provider: sourceProvider, providers: currentProviders } = yield* freshProvider(
      source.modelSelection.instanceId,
      forceProbe,
      now,
    );
    const verdict = quotaWindowVerdict({
      usageLimits: sourceProvider?.usageLimits,
      thresholdPercent: settings.coordinationQuotaHandoffThresholdPercent,
      now,
    });
    if (verdict.status === "below-threshold") return false;
    if (verdict.status === "unknown") {
      yield* dispatchWait({
        parentId: parent.id,
        source,
        reason: `Automatic quota handoff paused: ${verdict.reason}`,
      });
      return true;
    }

    const fallbackMappings = Object.fromEntries(
      Object.entries(settings.coordinationQuotaHandoffFallbacks).map(([model, models]) => [
        coordinationModelKey(model),
        models,
      ]),
    );
    let fallbackProviders = currentProviders;
    if (state.quotaHandoff?.switchCount === 0) {
      const mappedModels =
        fallbackMappings[coordinationModelKey(source.modelSelection.model)] ?? [];
      const instances = new Set(
        fallbackProviders
          .filter((provider) =>
            mappedModels.some((model) => provider.models.some((entry) => entry.slug === model)),
          )
          .map((provider) => provider.instanceId),
      );
      for (const instanceId of instances) {
        fallbackProviders = yield* providers
          .refreshInstance(instanceId)
          .pipe(Effect.catchCause(() => Effect.succeed(fallbackProviders)));
      }
    }
    const fallback =
      state.quotaHandoff?.switchCount === 0
        ? firstEligibleQuotaFallback({
            sourceModel: coordinationModelKey(source.modelSelection.model),
            fallbackModels: fallbackMappings,
            providers: fallbackProviders,
            thresholdPercent: settings.coordinationQuotaHandoffThresholdPercent,
            now,
            canRunModel: (model) => hasBudget(state, model, 1),
            canRunProviderModel: (provider) =>
              coordinationProviderIssue(
                provider.driver,
                source.id === parent.id ? "parent" : "child",
              ) === undefined,
          })
        : undefined;
    if (fallback) {
      yield* dispatchHandoff({
        parent,
        state,
        source,
        destination: fallback.provider,
        model: fallback.model,
        switchProvider: true,
      });
      return true;
    }
    const needsAdditionalBudget =
      state.quotaHandoff?.switchCount === 0 &&
      (fallbackMappings[coordinationModelKey(source.modelSelection.model)] ?? []).some(
        (model) => !hasBudget(state, model, 1),
      );
    const budgetMessage = needsAdditionalBudget
      ? " A mapped fallback needs one remaining orchestration turn for the task continuation."
      : "";
    const resetAt = verdict.resetAt;
    yield* dispatchWait({
      parentId: parent.id,
      source,
      ...(resetAt ? { resetAt } : {}),
      reason: resetAt
        ? `Quota reached the configured threshold. No mapped fallback has a fresh usable quota and enough workflow budget. Waiting for reset at ${resetAt}.${budgetMessage}`
        : `Quota reached the configured threshold, but the provider reported no reset time. Automatic work is paused.${budgetMessage}`,
    });
    return true;
  });

  const settleHandoffs = Effect.fn("ThreadCoordinationQuotaReactor.settleHandoffs")(function* (
    threads: ReadonlyArray<OrchestrationThreadShell>,
  ) {
    for (const parent of threads) {
      const state = parent.coordination;
      if (
        state?.role !== "parent" ||
        state.quotaHandoff?.status !== "handing-off" ||
        !state.quotaHandoff.affectedThreadId ||
        !state.quotaHandoff.destinationThreadId
      )
        continue;
      const source = threads.find((thread) => thread.id === state.quotaHandoff!.affectedThreadId);
      if (!source || !isSettled(source)) continue;
      const targetId =
        state.quotaHandoff.sourceThreadId === source.id
          ? state.quotaHandoff.destinationThreadId
          : parent.id;
      yield* engine.dispatch({
        type: "thread.coordination",
        threadId: targetId,
        commandId: CommandId.make(`quota:settle:${targetId}:${yield* crypto.randomUUIDv4}`),
        action: {
          type: "quota-settle",
          destinationThreadId: state.quotaHandoff.destinationThreadId,
        },
        createdAt: DateTime.formatIso(yield* DateTime.now),
      });
    }
  });

  const scan = Effect.fn("ThreadCoordinationQuotaReactor.scan")(function* (forceProbe: boolean) {
    const settings = yield* settingsService.getSettings;
    const snapshot = yield* snapshots.getShellSnapshot();
    const now = DateTime.formatIso(yield* DateTime.now);
    yield* settleHandoffs(snapshot.threads);
    for (const parent of snapshot.threads) {
      const state = parent.coordination;
      const quota = state?.role === "parent" ? state.quotaHandoff : undefined;
      if (!state || state.role !== "parent" || !quota?.enabled) continue;
      if (state.status === "completed" || state.status === "cancelled") continue;
      if (quota.status === "handing-off") continue;
      if (quota.status === "waiting-reset") {
        const source = snapshot.threads.find((thread) => thread.id === quota.affectedThreadId);
        if (source) yield* inspectWaitingReset(parent, state, source, settings, now);
        continue;
      }
      if (
        (quota.status !== "watching" && quota.status !== "summarizing") ||
        state.status !== "active"
      )
        continue;
      const members = snapshot.threads.filter(
        (thread) =>
          thread.id === parent.id ||
          (thread.coordination?.role === "child" && thread.coordination.parentId === parent.id),
      );
      for (const source of members) {
        if (
          isRunning(source) &&
          (yield* inspectRunning(parent, state, source, forceProbe, settings, now))
        )
          break;
      }
    }
  });

  const worker = yield* makeDrainableWorker((forceProbe: boolean) =>
    scan(forceProbe).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logWarning("T3 orchestration layer quota check failed", {
              cause: Cause.pretty(cause),
            }),
      ),
    ),
  );

  const start = Effect.fn("ThreadCoordinationQuotaReactor.start")(function* () {
    const events = yield* engine.subscribeDomainEvents;
    yield* Stream.runForEach(events, (event) =>
      event.aggregateKind === "thread" &&
      (event.type === "thread.coordination-updated" ||
        event.type === "thread.session-set" ||
        event.type === "thread.turn-start-requested")
        ? worker.enqueue(false)
        : Effect.void,
    ).pipe(Effect.forkScoped);
    yield* providers.streamChanges.pipe(
      Stream.runForEach(() => worker.enqueue(false)),
      Effect.forkScoped,
    );
    yield* settingsService.streamChanges.pipe(
      Stream.runForEach(() => worker.enqueue(false)),
      Effect.forkScoped,
    );
    yield* worker.enqueue(true);
    yield* Effect.repeat(worker.enqueue(true), Schedule.spaced("1 minute")).pipe(
      Effect.asVoid,
      Effect.forkScoped,
    );
  });

  return { start };
});

export const layer = Layer.effect(ThreadCoordinationQuotaReactor, make);
