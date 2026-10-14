// @effect-diagnostics globalDate:off
import {
  CommandId,
  MessageId,
  type OrchestrationV2Command,
  type OrchestrationV2ThreadShell,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  type ServerProvider,
  type ServerSettings as ServerSettingsValue,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as ServerSettings from "../serverSettings.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import {
  limitRecoveryCommand,
  makeSweep,
  ProviderRegistry,
  ThreadManagementService,
} from "./UsageLimitRecoveryWorker.ts";

const quota = (checkedAt: string, resetAt: string, usedPercent = 20) =>
  ({
    checkedAt,
    windows: [
      {
        id: "session",
        kind: "session",
        label: "Session",
        usedPercent,
        resetsAt: resetAt,
      },
    ],
  }) as const;

const makeCandidate = (
  nowIso: string,
  resetIso: string,
  overrides?: Partial<ProjectionStore.ProjectionLimitRecoveryCandidate>,
): ProjectionStore.ProjectionLimitRecoveryCandidate => ({
  id: ThreadId.make("thread-1"),
  status: "failed",
  lastErrorClass: "usage_limit",
  latestRunId: RunId.make("run-1"),
  usageLimitResetAt: resetIso,
  archivedAt: null,
  settledOverride: null,
  pendingRuntimeRequest: null,
  latestRunCompletedAt: DateTime.makeUnsafe(nowIso),
  updatedAt: DateTime.makeUnsafe(nowIso),
  limitRecovery: null,
  snoozedUntil: null,
  ...overrides,
});

const makeShell = (candidate: ProjectionStore.ProjectionLimitRecoveryCandidate): OrchestrationV2ThreadShell =>
  ({
    ...candidate,
    title: "Test Thread",
    createdAt: candidate.updatedAt,
    lastVisitedAt: null,
    markedUnreadAt: null,
    archivedAt: null,
    pinnedAt: null,
    pinOrderKey: null,
    activeOrderKey: null,
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5",
    },
    providerInstanceId: ProviderInstanceId.make("codex"),
  }) as unknown as OrchestrationV2ThreadShell;

const makeProvider = (input: {
  instanceId: string;
  driver?: "codex" | "claude" | "antigravity";
  model: string;
  checkedAt: string;
  resetAt: string;
  usedPercent?: number;
  status?: ServerProvider["status"];
}): ServerProvider => ({
  instanceId: ProviderInstanceId.make(input.instanceId),
  driver: ProviderDriverKind.make(input.driver ?? "codex"),
  enabled: true,
  installed: true,
  version: null,
  status: input.status ?? "ready",
  auth: { status: "authenticated" },
  checkedAt: input.checkedAt,
  slashCommands: [],
  skills: [],
  models: [{ slug: input.model, name: input.model, isCustom: false, capabilities: null }],
  usageLimits: quota(input.checkedAt, input.resetAt, input.usedPercent ?? 20),
});

describe("UsageLimitRecoveryWorker limitRecoveryCommand", () => {
  const now = "2026-09-28T12:00:00.000Z";
  const nowMs = Date.parse(now);
  const resetAt = "2026-09-28T13:00:00.000Z";
  const resetMs = Date.parse(resetAt);

  it("arms the thread to wait for reset when no fallback is available", () => {
    const candidate = makeCandidate(now, resetAt);
    const command = limitRecoveryCommand(candidate, true, nowMs, false, null);
    expect(command).toEqual({
      type: "thread.metadata.update",
      commandId: CommandId.make(`limit-arm:thread-1:run-1:${resetMs}`),
      threadId: candidate.id,
      limitRecovery: {
        runId: candidate.latestRunId,
        resetAt,
        autoResume: true,
        snooze: false,
      },
    });
  });

  it("does not resume before reset time when armed and no fallback is available", () => {
    const candidate = makeCandidate(now, resetAt, {
      limitRecovery: {
        runId: RunId.make("run-1"),
        resetAt,
        autoResume: true,
        snooze: false,
      },
    });
    const command = limitRecoveryCommand(candidate, true, nowMs, false, null);
    expect(command).toBeNull();
  });

  it("resumes after reset time when armed and no fallback is available", () => {
    const candidate = makeCandidate(now, resetAt, {
      limitRecovery: {
        requestId: CommandId.make("req-123"),
        runId: RunId.make("run-1"),
        resetAt,
        autoResume: true,
        snooze: false,
      },
    });
    const afterResetMs = resetMs + 1000;
    const command = limitRecoveryCommand(candidate, true, afterResetMs, false, null);
    expect(command).toEqual({
      type: "message.dispatch",
      commandId: CommandId.make(`limit-resume:thread-1:run-1:${resetMs}:req-123`),
      messageId: MessageId.make(`limit-resume:thread-1:run-1:${resetMs}:req-123`),
      threadId: candidate.id,
      usageLimitContinuationOfRunId: candidate.latestRunId,
      usageLimitRecoveryRequestId: CommandId.make("req-123"),
      text: "Continue where you left off.",
      attachments: [],
      dispatchMode: { type: "start_immediately" },
      createdBy: "user",
      creationSource: "server",
    });
  });

  it("dispatches immediately to fallback provider when fallback is available and autoResume is enabled", () => {
    const candidate = makeCandidate(now, resetAt);
    const fallback = {
      provider: { instanceId: ProviderInstanceId.make("claude") },
      model: "claude-sonnet-4-6",
    };
    const command = limitRecoveryCommand(candidate, true, nowMs, false, fallback);
    expect(command).toEqual({
      type: "message.dispatch",
      commandId: CommandId.make(`limit-fallback:thread-1:run-1:${resetMs}:fallback:claude:claude-sonnet-4-6`),
      messageId: MessageId.make(`limit-fallback:thread-1:run-1:${resetMs}:fallback:claude:claude-sonnet-4-6`),
      threadId: candidate.id,
      usageLimitContinuationOfRunId: candidate.latestRunId,
      modelSelection: {
        instanceId: ProviderInstanceId.make("claude"),
        model: "claude-sonnet-4-6",
      },
      text: "Continue where you left off.",
      attachments: [],
      dispatchMode: { type: "start_immediately" },
      createdBy: "user",
      creationSource: "server",
    });
  });

  it("does not auto-dispatch fallback when autoResume is false", () => {
    const candidate = makeCandidate(now, resetAt);
    const fallback = {
      provider: { instanceId: ProviderInstanceId.make("claude") },
      model: "claude-sonnet-4-6",
    };
    const command = limitRecoveryCommand(candidate, false, nowMs, false, fallback);
    expect(command).toBeNull();
  });
});

describe("UsageLimitRecoveryWorker makeSweep", () => {
  const getDynamicTimes = () => {
    const nowTime = Date.now();
    const nowIso = new Date(nowTime).toISOString();
    const resetTime = nowTime + 3600_000;
    const resetIso = new Date(resetTime).toISOString();
    return { nowIso, resetIso, resetMs: resetTime };
  };

  const defaultSettings = {
    autoResumeLimitedThreads: true,
    snoozeLimitedThreads: false,
    coordinationQuotaHandoffThresholdPercent: 80,
    coordinationQuotaHandoffFallbacks: {
      "gpt-5": ["claude-sonnet-4-6"],
    },
  } as unknown as ServerSettingsValue;

  const runSweepTest = (params: {
    candidates: ReadonlyArray<ProjectionStore.ProjectionLimitRecoveryCandidate>;
    providers: ReadonlyArray<ServerProvider>;
    settings?: Partial<ServerSettingsValue>;
    onRefreshInstance?: (instanceId: ProviderInstanceId) => ReadonlyArray<ServerProvider>;
  }) =>
    Effect.gen(function* () {
      const dispatchedCommands = yield* Ref.make<Array<OrchestrationV2Command>>([]);
      const refreshedInstances = yield* Ref.make<Array<ProviderInstanceId>>([]);

      const mockSettings = Layer.succeed(ServerSettings.ServerSettingsService, {
        getSettings: Effect.succeed({ ...defaultSettings, ...params.settings }),
        updateSettings: () => Effect.die(new Error("not implemented")),
      } as unknown as ServerSettings.ServerSettingsService["Service"]);

      const mockProjections = Layer.succeed(ProjectionStore.ProjectionStoreV2, {
        getLimitRecoveryCandidates: () => Effect.succeed(params.candidates),
        getThreadShell: (threadId: ThreadId) => {
          const cand = params.candidates.find((c) => c.id === threadId);
          return Effect.succeed(cand ? makeShell(cand) : null);
        },
        getThread: () => Effect.succeed(null),
      } as unknown as ProjectionStore.ProjectionStoreV2["Service"]);

      const mockThreadManagement = Layer.succeed(
        ThreadManagementService,
        {
          dispatch: (cmd: OrchestrationV2Command) =>
            Ref.update(dispatchedCommands, (prev) => [...prev, cmd]).pipe(
              Effect.as({} as any),
            ),
        },
      );

      let currentProviders = [...params.providers];
      const mockProviderRegistry = Layer.succeed(ProviderRegistry, {
        getProviders: Effect.sync(() => currentProviders),
        refreshInstance: (instanceId: ProviderInstanceId) =>
          Ref.update(refreshedInstances, (prev) => [...prev, instanceId]).pipe(
            Effect.map(() => {
              if (params.onRefreshInstance) {
                currentProviders = [...params.onRefreshInstance(instanceId)];
              }
              return currentProviders;
            }),
          ),
      });

      const sweep = yield* makeSweep.pipe(
        Effect.provide(
          Layer.mergeAll(
            mockSettings,
            mockProjections,
            mockThreadManagement,
            mockProviderRegistry,
          ),
        ),
      );

      yield* sweep();

      const commands = yield* Ref.get(dispatchedCommands);
      const refreshes = yield* Ref.get(refreshedInstances);
      return { commands, refreshes };
    }).pipe(Effect.runPromise);

  it("dispatches fallback handoff when eligible fallback exists", async () => {
    const { nowIso, resetIso } = getDynamicTimes();
    const candidate = makeCandidate(nowIso, resetIso);

    const codexProvider = makeProvider({
      instanceId: "codex",
      driver: "codex",
      model: "gpt-5",
      checkedAt: nowIso,
      resetAt: resetIso,
      usedPercent: 100,
    });

    const claudeProvider = makeProvider({
      instanceId: "claude",
      driver: "claude",
      model: "claude-sonnet-4-6",
      checkedAt: nowIso,
      resetAt: resetIso,
      usedPercent: 20,
    });

    const result = await runSweepTest({
      candidates: [candidate],
      providers: [codexProvider, claudeProvider],
    });

    expect(result.commands).toHaveLength(1);
    expect(result.commands[0]).toMatchObject({
      type: "message.dispatch",
      threadId: candidate.id,
      modelSelection: {
        instanceId: ProviderInstanceId.make("claude"),
        model: "claude-sonnet-4-6",
      },
    });
  });

  it("falls back to waiting for reset when fallback usage exceeds quota threshold", async () => {
    const { nowIso, resetIso, resetMs } = getDynamicTimes();
    const candidate = makeCandidate(nowIso, resetIso);

    const codexProvider = makeProvider({
      instanceId: "codex",
      driver: "codex",
      model: "gpt-5",
      checkedAt: nowIso,
      resetAt: resetIso,
      usedPercent: 100,
    });

    const claudeProvider = makeProvider({
      instanceId: "claude",
      driver: "claude",
      model: "claude-sonnet-4-6",
      checkedAt: nowIso,
      resetAt: resetIso,
      usedPercent: 95, // Above threshold of 80%
    });

    const result = await runSweepTest({
      candidates: [candidate],
      providers: [codexProvider, claudeProvider],
      settings: {
        coordinationQuotaHandoffThresholdPercent: 80,
      },
    });

    expect(result.commands).toHaveLength(1);
    expect(result.commands[0]).toMatchObject({
      type: "thread.metadata.update",
      commandId: CommandId.make(`limit-arm:thread-1:run-1:${resetMs}`),
      threadId: candidate.id,
    });
  });

  it("refreshes provider instance when candidate fallback instance is known", async () => {
    const { nowIso, resetIso } = getDynamicTimes();
    const candidate = makeCandidate(nowIso, resetIso);

    const codexProvider = makeProvider({
      instanceId: "codex",
      driver: "codex",
      model: "gpt-5",
      checkedAt: nowIso,
      resetAt: resetIso,
      usedPercent: 100,
    });

    const claudeProviderStale = makeProvider({
      instanceId: "claude",
      driver: "claude",
      model: "claude-sonnet-4-6",
      checkedAt: nowIso,
      resetAt: resetIso,
      usedPercent: 90, // initially above threshold
    });

    const claudeProviderRefreshed = makeProvider({
      instanceId: "claude",
      driver: "claude",
      model: "claude-sonnet-4-6",
      checkedAt: nowIso,
      resetAt: resetIso,
      usedPercent: 10, // refreshed below threshold
    });

    const result = await runSweepTest({
      candidates: [candidate],
      providers: [codexProvider, claudeProviderStale],
      onRefreshInstance: () => [codexProvider, claudeProviderRefreshed],
    });

    expect(result.refreshes).toContainEqual(ProviderInstanceId.make("claude"));
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0]).toMatchObject({
      type: "message.dispatch",
      modelSelection: {
        instanceId: ProviderInstanceId.make("claude"),
        model: "claude-sonnet-4-6",
      },
    });
  });
});
