import {
  CommandId,
  MessageId,
  type OrchestrationV2Command,
  type ServerProvider,
  type ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { ProviderRegistry } from "../provider/ProviderRegistry.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as ServerSettings from "../serverSettings.ts";
import { firstEligibleQuotaFallback } from "./CoordinationQuotaPolicy.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

export function limitRecoveryCommand(
  thread: ProjectionStore.ProjectionLimitRecoveryCandidate,
  autoResume: boolean,
  nowMs: number,
  snooze = false,
  fallback?: {
    readonly provider: Pick<ServerProvider, "instanceId">;
    readonly model: string;
  } | null,
): OrchestrationV2Command | null {
  if (
    thread.status !== "failed" ||
    thread.lastErrorClass !== "usage_limit" ||
    !thread.latestRunId ||
    !thread.usageLimitResetAt ||
    thread.archivedAt !== null ||
    thread.settledOverride === "settled" ||
    thread.pendingRuntimeRequest !== null
  )
    return null;
  const resetMs = Date.parse(thread.usageLimitResetAt);
  // An already-expired window reported with a fresh failure cannot start a retry loop.
  if (
    !Number.isFinite(resetMs) ||
    resetMs <= DateTime.toEpochMillis(thread.latestRunCompletedAt ?? thread.updatedAt)
  )
    return null;
  const identity = `${thread.id}:${thread.latestRunId}:${resetMs}`;
  const recovery = thread.limitRecovery;

  if (fallback && autoResume) {
    const deliveryIdentity = `${identity}:fallback:${fallback.provider.instanceId}:${fallback.model}`;
    return {
      type: "message.dispatch",
      commandId: CommandId.make(`limit-fallback:${deliveryIdentity}`),
      messageId: MessageId.make(`limit-fallback:${deliveryIdentity}`),
      threadId: thread.id,
      usageLimitContinuationOfRunId: thread.latestRunId,
      ...(recovery?.requestId === undefined
        ? {}
        : { usageLimitRecoveryRequestId: recovery.requestId }),
      modelSelection: {
        instanceId: fallback.provider.instanceId,
        model: fallback.model,
      },
      text: "Continue where you left off.",
      attachments: [],
      dispatchMode: { type: "start_immediately" },
      createdBy: "user",
      creationSource: "server",
    };
  }

  if (recovery?.runId !== thread.latestRunId || recovery.resetAt !== thread.usageLimitResetAt) {
    if (!autoResume && (!snooze || resetMs <= nowMs)) return null;
    return {
      type: "thread.metadata.update",
      commandId: CommandId.make(`limit-arm:${identity}`),
      threadId: thread.id,
      limitRecovery: {
        runId: thread.latestRunId,
        resetAt: thread.usageLimitResetAt,
        autoResume,
        snooze: snooze && resetMs > nowMs,
      },
    };
  }
  if (
    !recovery.autoResume ||
    resetMs > nowMs ||
    (thread.snoozedUntil != null && DateTime.toEpochMillis(thread.snoozedUntil) > nowMs)
  )
    return null;
  const deliveryIdentity = `${identity}:${recovery.requestId ?? "legacy"}`;
  return {
    type: "message.dispatch",
    commandId: CommandId.make(`limit-resume:${deliveryIdentity}`),
    messageId: MessageId.make(`limit-resume:${deliveryIdentity}`),
    threadId: thread.id,
    usageLimitContinuationOfRunId: thread.latestRunId,
    ...(recovery.requestId === undefined
      ? {}
      : { usageLimitRecoveryRequestId: recovery.requestId }),
    text: "Continue where you left off.",
    attachments: [],
    dispatchMode: { type: "start_immediately" },
    createdBy: "user",
    creationSource: "server",
  };
}

export const makeSweep = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const settings = yield* ServerSettings.ServerSettingsService;
  // Personal fork: the server always provides this; upstream's tests do not.
  const providerRegistry = yield* Effect.serviceOption(ProviderRegistry);

  /** A mapped fallback with quota to spare; stale snapshots are refreshed once before giving up. */
  const findFallback = Effect.fn("UsageLimitRecoveryWorker.findFallback")(function* (
    threadId: ThreadId,
    fallbackModels: Readonly<Record<string, ReadonlyArray<string>>>,
    thresholdPercent: number,
    now: string,
  ) {
    if (Option.isNone(providerRegistry)) return undefined;
    const registry = providerRegistry.value;
    const shell = yield* projections.getThreadShell(threadId).pipe(Effect.option);
    if (Option.isNone(shell) || !shell.value) return undefined;
    const { modelSelection } = shell.value;
    const resolve = (providers: ReadonlyArray<ServerProvider>) =>
      firstEligibleQuotaFallback({
        sourceModel: modelSelection.model,
        sourceInstanceId: modelSelection.instanceId,
        fallbackModels,
        providers,
        thresholdPercent,
        now,
      });
    const providers = yield* registry.getProviders;
    const cached = resolve(providers);
    if (cached) return cached;
    const mapped = new Set(Object.values(fallbackModels).flat());
    let refreshed = providers;
    for (const provider of providers) {
      if (provider.instanceId === modelSelection.instanceId) continue;
      if (!provider.models.some((entry) => mapped.has(entry.slug))) continue;
      refreshed = yield* registry
        .refreshInstance(provider.instanceId)
        .pipe(Effect.orElseSucceed(() => refreshed));
    }
    return resolve(refreshed);
  });

  return Effect.fn("UsageLimitRecoveryWorker.sweep")(function* () {
    const preferences = yield* settings.getSettings;
    const now = yield* DateTime.now;
    const candidates = yield* projections.getLimitRecoveryCandidates({
      now,
      autoResume: preferences.autoResumeLimitedThreads,
      snooze: preferences.snoozeLimitedThreads,
    });
    const nowMs = DateTime.toEpochMillis(now);
    const handoffEnabled =
      preferences.autoResumeLimitedThreads &&
      Object.keys(preferences.coordinationQuotaHandoffFallbacks).length > 0;
    for (const thread of candidates) {
      const fallback = handoffEnabled
        ? yield* findFallback(
            thread.id,
            preferences.coordinationQuotaHandoffFallbacks,
            preferences.coordinationQuotaHandoffThresholdPercent,
            DateTime.formatIso(now),
          )
        : undefined;
      const command = limitRecoveryCommand(
        thread,
        preferences.autoResumeLimitedThreads,
        nowMs,
        preferences.snoozeLimitedThreads,
        fallback,
      );
      if (command === null) continue;
      yield* threads.dispatch(command).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("orchestration-v2.limit-recovery.dispatch-failed", {
            threadId: thread.id,
            cause,
          }),
        ),
      );
    }
  });
});

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const sweep = yield* makeSweep;
    const scheduler = yield* Scheduler.Scheduler;
    yield* scheduler.register("usage-limit-recovery", sweep());
  }),
);
