import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import {
  CommandId,
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationThreadShell,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";
import { ThreadCoordinationQuotaReactor, make } from "./ThreadCoordinationQuotaReactor.ts";

const sourceThreadId = ThreadId.make("quota-parent");
const projectId = ProjectId.make("quota-project");
const sourceInstanceId = ProviderInstanceId.make("codex");
const fallbackInstanceId = ProviderInstanceId.make("claude");

const provider = (input: {
  readonly instanceId: ProviderInstanceId;
  readonly driver: "codex" | "claudeAgent";
  readonly model: string;
  readonly usedPercent: number;
  readonly checkedAt: string;
}): ServerProvider => ({
  instanceId: input.instanceId,
  driver: ProviderDriverKind.make(input.driver),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: input.checkedAt,
  slashCommands: [],
  skills: [],
  models: [{ slug: input.model, name: input.model, isCustom: false, capabilities: null }],
  usageLimits: {
    checkedAt: input.checkedAt,
    windows: [
      {
        id: "session",
        kind: "session",
        label: "Session",
        usedPercent: input.usedPercent,
        resetsAt: "2099-01-01T00:00:00.000Z",
      },
    ],
  },
});

const testCrypto = Crypto.make({
  randomBytes: (size) => new Uint8Array(size).fill(1),
  digest: (_algorithm, data) => Effect.succeed(data),
});

describe("ThreadCoordinationQuotaReactor", () => {
  it.effect("probes the source and routes to the first fresh, eligible fallback", () =>
    Effect.gen(function* () {
      const now = DateTime.formatIso(yield* DateTime.now);
      const sourceProvider = provider({
        instanceId: sourceInstanceId,
        driver: "codex",
        model: "gpt-6-sol",
        usedPercent: 95,
        checkedAt: now,
      });
      const fallbackProvider = provider({
        instanceId: fallbackInstanceId,
        driver: "claudeAgent",
        model: "claude-opus-5",
        usedPercent: 30,
        checkedAt: now,
      });
      const allProviders = [sourceProvider, fallbackProvider];
      const quotaSettings = {
        ...DEFAULT_SERVER_SETTINGS,
        coordinationQuotaHandoffThresholdPercent: 95,
        coordinationQuotaHandoffFallbacks: { "gpt-6-sol": ["claude-opus-5"] },
      };
      const parent = {
        id: sourceThreadId,
        title: "Parent",
        projectId,
        deletedAt: null,
        modelSelection: { instanceId: sourceInstanceId, model: "gpt-6-sol" },
        latestTurn: { state: "running" },
        session: { status: "running" },
        coordination: {
          role: "parent",
          status: "active",
          waiting: false,
          maxChildren: 4,
          budgets: [
            { model: "gpt-6-sol", limit: 2, used: 1 },
            { model: "claude-opus-5", limit: 1, used: 0 },
          ],
          quotaHandoff: { enabled: true, switchCount: 0, status: "watching" },
          policyUpdatedAt: now,
          blockedReason: null,
        },
      } as unknown as OrchestrationThreadShell;
      const commands: OrchestrationCommand[] = [];
      const refreshedInstances: ProviderInstanceId[] = [];
      const scope = yield* Scope.make();
      const routed = yield* Deferred.make<void>();
      const engine = {
        dispatch: (command: OrchestrationCommand) =>
          Effect.sync(() => {
            commands.push(command);
            return { sequence: commands.length };
          }).pipe(
            Effect.tap(() => Deferred.succeed(routed, undefined)),
            Effect.asVoid,
          ),
        subscribeDomainEvents: Effect.succeed(Stream.empty),
      } as unknown as OrchestrationEngineService["Service"];
      const snapshots = {
        getShellSnapshot: () => Effect.succeed({ projects: [], threads: [parent] }),
      } as unknown as ProjectionSnapshotQuery["Service"];
      const providerRegistry = {
        getProviders: Effect.succeed(allProviders),
        refreshInstance: (instanceId: ProviderInstanceId) =>
          Effect.sync(() => {
            refreshedInstances.push(instanceId);
            return allProviders;
          }),
        streamChanges: Stream.empty,
      } as unknown as ProviderRegistry["Service"];
      const settings = {
        getSettings: Effect.succeed(quotaSettings),
        streamChanges: Stream.empty,
      } as unknown as ServerSettingsService["Service"];
      const dependencies = Layer.mergeAll(
        Layer.succeed(OrchestrationEngineService, engine),
        Layer.succeed(ProjectionSnapshotQuery, snapshots),
        Layer.succeed(ProviderRegistry, providerRegistry),
        Layer.succeed(ServerSettingsService, settings),
        Layer.succeed(Crypto.Crypto, testCrypto),
      );
      const reactorLayer = Layer.effect(ThreadCoordinationQuotaReactor, make).pipe(
        Layer.provideMerge(dependencies),
      );

      try {
        const context = yield* Layer.buildWithScope(reactorLayer, scope);
        const reactor = Context.get(context, ThreadCoordinationQuotaReactor);
        yield* reactor.start().pipe(Effect.provide(context), Scope.provide(scope));
        yield* Deferred.await(routed);

        const route = commands.find(
          (command) =>
            command.type === "thread.coordination" && command.action.type === "quota-trigger",
        );
        expect(route).toMatchObject({
          threadId: sourceThreadId,
          action: {
            type: "quota-trigger",
            affectedThreadId: sourceThreadId,
            destinationModelSelection: {
              instanceId: fallbackInstanceId,
              model: "claude-opus-5",
            },
            switchProvider: true,
          },
        });
        expect(refreshedInstances).toContain(sourceInstanceId);
        expect(refreshedInstances).toContain(fallbackInstanceId);
      } finally {
        yield* Scope.close(scope, Exit.void);
      }
    }),
  );
});
