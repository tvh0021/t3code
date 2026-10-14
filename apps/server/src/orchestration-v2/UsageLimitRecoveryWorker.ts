// @effect-diagnostics deterministicKeys:off
import {
  CommandId,
  coordinationModelKey,
  MessageId,
  type ModelSelection,
  type OrchestrationV2Command,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as ServerSettings from "../serverSettings.ts";
import { firstEligibleQuotaFallback } from "./CoordinationQuotaPolicy.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

export interface ProviderRegistryShape {
  readonly getProviders: Effect.Effect<ReadonlyArray<ServerProvider>>;
  readonly refreshInstance: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ReadonlyArray<ServerProvider>>;
}

export class ProviderRegistry extends Context.Service<
  ProviderRegistry,
  ProviderRegistryShape
>()("t3/provider/ProviderRegistry") {}

export interface ThreadManagementServiceShape {
  readonly dispatch: (
    command: OrchestrationV2Command,
  ) => Effect.Effect<unknown, never>;
}

export class ThreadManagementService extends Context.Service<
  ThreadManagementService,
  ThreadManagementServiceShape
>()("t3/orchestration-v2/ThreadManagementService") {}

/** The persisted run and reset form the identity of one recovery opportunity. */
export function limitRecoveryCommand(
  thread: ProjectionStore.ProjectionLimitRecoveryCandidate,
  autoResume: boolean,
  nowMs: number,
  snooze = false,
  fallback?: { readonly provider: Pick<ServerProvider, "instanceId">; readonly model: string } | null,
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
  const threads = yield* ThreadManagementService;
  const settings = yield* ServerSettings.ServerSettingsService;
  const providerRegistry = yield* Effect.serviceOption(ProviderRegistry);

  return Effect.fn("UsageLimitRecoveryWorker.sweep")(function* () {
    const preferences = yield* settings.getSettings;
    const now = yield* DateTime.now;
    const candidates = yield* projections.getLimitRecoveryCandidates({
      now,
      autoResume: preferences.autoResumeLimitedThreads,
      snooze: preferences.snoozeLimitedThreads,
    });
    const nowMs = DateTime.toEpochMillis(now);
    const nowIso = DateTime.formatIso(now);
    const providers = Option.isSome(providerRegistry)
      ? yield* providerRegistry.value.getProviders
      : [];

    for (const thread of candidates) {
      let modelSelection: ModelSelection | undefined;
      let providerInstanceId: ProviderInstanceId | undefined;

      if (providers.length > 0) {
        const shell = yield* projections.getThreadShell(thread.id).pipe(
          Effect.option,
          Effect.orElseSucceed(() => Option.none()),
        );
        if (Option.isSome(shell) && shell.value) {
          modelSelection = shell.value.modelSelection;
          providerInstanceId = shell.value.providerInstanceId;
        }
      }

      let fallback =
        modelSelection && providers.length > 0
          ? firstEligibleQuotaFallback({
              sourceModel: modelSelection.model,
              sourceInstanceId: modelSelection.instanceId ?? providerInstanceId,
              fallbackModels: preferences.coordinationQuotaHandoffFallbacks,
              providers,
              thresholdPercent: preferences.coordinationQuotaHandoffThresholdPercent,
              now: nowIso,
            })
          : undefined;

      if (!fallback && Option.isSome(providerRegistry) && modelSelection) {
        const mappedModels =
          preferences.coordinationQuotaHandoffFallbacks[modelSelection.model] ??
          preferences.coordinationQuotaHandoffFallbacks[coordinationModelKey(modelSelection.model)] ??
          preferences.coordinationQuotaHandoffFallbacks[modelSelection.instanceId] ??
          [];

        const candidateInstances = new Set(
          providers
            .filter(
              (p) =>
                p.instanceId !== (modelSelection?.instanceId ?? providerInstanceId) &&
                mappedModels.some((m) => p.models.some((entry) => entry.slug === m)),
            )
            .map((p) => p.instanceId),
        );

        let refreshedProviders = providers;
        for (const instanceId of candidateInstances) {
          refreshedProviders = yield* providerRegistry.value
            .refreshInstance(instanceId)
            .pipe(Effect.catchCause(() => Effect.succeed(refreshedProviders)));
        }

        if (candidateInstances.size > 0) {
          fallback = firstEligibleQuotaFallback({
            sourceModel: modelSelection.model,
            sourceInstanceId: modelSelection.instanceId ?? providerInstanceId,
            fallbackModels: preferences.coordinationQuotaHandoffFallbacks,
            providers: refreshedProviders,
            thresholdPercent: preferences.coordinationQuotaHandoffThresholdPercent,
            now: nowIso,
          });
        }
      }

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

// The shared scheduler derives due work from persisted failures and recovery
// choices, so restarts need no timer restoration or connected client.
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const sweep = yield* makeSweep;
    const scheduler = yield* Scheduler.Scheduler;
    yield* scheduler.register("usage-limit-recovery", sweep());
  }),
);
