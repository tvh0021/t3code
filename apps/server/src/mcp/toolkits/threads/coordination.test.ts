import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { ServerConfig } from "../../../config.ts";
import { ProcessRunner, layer as ProcessRunnerLayer } from "../../../processRunner.ts";
import * as Option from "effect/Option";
// @effect-diagnostics globalDate:off
import { expect, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  EventId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Context from "effect/Context";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { McpSchema, McpServer } from "effect/unstable/ai";
import { ThreadsToolkitRegistrationLive } from "../../McpHttpServer.ts";
import { McpInvocationContext } from "../../McpInvocationContext.ts";
import { ThreadCreatedResult } from "./tools.ts";
import * as CoordinationPolicy from "../../../orchestration/CoordinationPolicy.ts";
import * as CoordinationReactor from "../../../orchestration/ThreadCoordinationReactor.ts";
import { makeCoordinationTestLayer } from "../../../orchestration/testing/coordinationTestLayer.ts";
import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ThreadDeletionReactor } from "../../../orchestration/Services/ThreadDeletionReactor.ts";
import { ProviderRegistry } from "../../../provider/Services/ProviderRegistry.ts";
import { ServerRuntimeStartup } from "../../../serverRuntimeStartup.ts";

const parentId = ThreadId.make("parent");
const projectId = ProjectId.make("project");
const instanceId = ProviderInstanceId.make("codex");
const client = McpSchema.McpServerClient.of({
  clientId: 1,
  clientCapabilities: {},
  clientInfo: { name: "workflow-test", version: "1" },
  protocolVersion: "2025-06-18",
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "workflow-test", version: "1" },
  },
  getClient: Effect.die("unused"),
});
const encodeUnknownJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeCreatedThread = Schema.decodeUnknownSync(ThreadCreatedResult);
const catalog: ReadonlyArray<ServerProvider> = [
  {
    instanceId,
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: new Date().toISOString(),
    slashCommands: [],
    skills: [],
    models: ["gpt-6-sol", "gpt-6-luna"].map((slug) => ({
      slug,
      name: slug,
      isCustom: false,
      capabilities: null,
    })),
  },
];

type CommandInput<C = OrchestrationCommand> = C extends OrchestrationCommand
  ? Omit<C, "commandId"> & { commandId?: CommandId }
  : never;

const fixture = Effect.fn(function* (startReactor = true) {
  const core = makeCoordinationTestLayer();
  const scope = yield* Scope.make();
  const context = yield* Layer.buildWithScope(
    Layer.mergeAll(
      CoordinationReactor.layer,
      ProcessRunnerLayer,
      ThreadsToolkitRegistrationLive.pipe(Layer.provideMerge(McpServer.McpServer.layer)),
    ).pipe(
      Layer.provideMerge(core),
      Layer.provide(
        Layer.mergeAll(
          CoordinationPolicy.layerTest,
          Layer.mock(ProviderRegistry)({ getProviders: Effect.succeed(catalog) }),
          Layer.mock(ServerRuntimeStartup)({ enqueueCommand: (effect) => effect }),
          Layer.mock(ThreadDeletionReactor)({ drainThrough: () => Effect.void }),
        ),
      ),
    ),
    scope,
  );
  const fs = Context.get(context, FileSystem.FileSystem);
  const path = Context.get(context, Path.Path);
  const config = Context.get(context, ServerConfig);
  const processes = Context.get(context, ProcessRunner);
  const workspace = path.join(config.stateDir, "workflow-fixture");
  yield* fs.makeDirectory(workspace, { recursive: true });
  yield* fs.writeFileString(path.join(workspace, "README.md"), "Frozen review contents\n");
  const git = Effect.fn(function* (cwd: string, args: ReadonlyArray<string>) {
    const result = yield* processes.run({ command: "git", cwd, args });
    if (result.code !== 0) return yield* Effect.die(new Error(result.stderr));
    return result.stdout.trim();
  });
  yield* git(workspace, ["init", "--initial-branch=main"]);
  yield* git(workspace, ["add", "README.md"]);
  yield* git(workspace, [
    "-c",
    "user.name=T3 test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-m",
    "Review fixture",
  ]);
  const engine = Context.get(context, OrchestrationEngineService);
  const snapshots = Context.get(context, ProjectionSnapshotQuery);
  const reactor = Context.get(context, CoordinationReactor.ThreadCoordinationReactor);
  const start = () => reactor.start().pipe(Scope.provide(scope));
  if (startReactor) yield* start();
  let id = 0;
  const dispatch = (input: CommandInput) =>
    Effect.provide(
      engine.dispatch({
        ...input,
        commandId: input.commandId ?? CommandId.make(`test:${++id}`),
      } as OrchestrationCommand),
      context,
    );
  const now = () => new Date().toISOString();
  yield* dispatch({
    type: "project.create",
    projectId,
    title: "Workflow",
    workspaceRoot: workspace,
    createdAt: now(),
  });
  yield* dispatch({
    type: "thread.create",
    threadId: parentId,
    projectId,
    title: "Parent",
    modelSelection: { instanceId, model: "gpt-6-sol" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdAt: now(),
  });
  const call = (name: string, args: Record<string, unknown> = {}, caller = parentId) =>
    Effect.provide(
      Effect.gen(function* () {
        const server = yield* McpServer.McpServer;
        return yield* server.callTool({ name, arguments: args }).pipe(
          Effect.provideService(McpSchema.McpServerClient, client),
          Effect.provideService(McpInvocationContext, {
            environmentId: EnvironmentId.make("environment"),
            threadId: caller,
            providerSessionId: String(caller),
            providerInstanceId: instanceId,
            capabilities: new Set(["threads"] as const),
            issuedAt: 1,
          }),
        );
      }),
      context,
    );
  const drain = Effect.fn(function* () {
    const sequence = yield* engine.latestSequence;
    yield* reactor.drainThrough(sequence);
  });
  const read = () => snapshots.getSnapshot();
  const events = () => Stream.runCollect(engine.readEvents(0, 1000));
  const session = (threadId: ThreadId, status: "running" | "ready") =>
    dispatch({
      type: "thread.session.set",
      threadId,
      session: {
        threadId,
        status,
        providerName: "codex",
        providerInstanceId: instanceId,
        runtimeMode: "full-access",
        activeTurnId: status === "running" ? TurnId.make(`${threadId}:turn`) : null,
        lastError: null,
        updatedAt: now(),
      },
      createdAt: now(),
    });
  const spawn = Effect.fn(function* (name: string) {
    const result = yield* call("spawn_child", {
      title: name,
      prompt: `Review ${name}`,
      mode: "review",
      reviewRef: "HEAD",
      modelSelection: { instanceId, model: "gpt-6-luna" },
    });
    expect(result.isError, yield* encodeUnknownJson(result)).toBe(false);
    yield* drain();
    return decodeCreatedThread(result.structuredContent).threadId;
  });
  const assignment = Effect.fn(function* (childId: ThreadId) {
    const state = (yield* read()).threads.find((thread) => thread.id === childId)?.coordination;
    if (state?.role !== "child") throw new Error("Missing assignment");
    return state;
  });
  return {
    fs,
    path,
    workspace,
    git,
    snapshots,
    engine,
    reactor,
    start,
    scope,
    dispatch,
    call,
    read,
    events,
    drain,
    session,
    spawn,
    assignment,
    now,
    dispose: () => Scope.close(scope, Exit.void),
  };
});

it.effect(
  "coordinates through real MCP tools and persisted projections without treating session startup as completion",
  () =>
    Effect.gen(function* () {
      const app = yield* fixture();
      try {
        expect((yield* app.call("start_orchestration_layer")).isError).toBe(false);
        yield* app.session(parentId, "running");
        const a = yield* app.spawn("A");
        const b = yield* app.spawn("B");
        expect((yield* app.assignment(a)).reviewRef).toMatch(/^[a-f0-9]{40,64}$/);
        yield* app.session(a, "ready");
        yield* app.drain();
        expect(yield* app.assignment(a)).toMatchObject({ phase: "running", report: null });
        const first = yield* app.assignment(a);
        expect(
          (yield* app.call(
            "report_to_parent",
            { assignmentId: first.assignmentId, text: "A found a race." },
            a,
          )).isError,
        ).toBe(false);
        expect(
          (yield* app.call(
            "report_to_parent",
            { assignmentId: first.assignmentId, text: "A found a race." },
            a,
          )).isError,
        ).toBe(false);
        yield* app.drain();
        expect(yield* app.assignment(a)).toMatchObject({ adopted: false, phase: "running" });
        expect(
          (yield* app.events()).filter(
            (event) =>
              event.type === "thread.turn-start-requested" && event.payload.threadId === parentId,
          ),
        ).toHaveLength(0);
        yield* app.session(parentId, "ready");
        yield* app.drain();
        expect(yield* app.assignment(a)).toMatchObject({ adopted: true });
        expect(
          (yield* app.events()).filter(
            (event) =>
              event.type === "thread.turn-start-requested" && event.payload.threadId === parentId,
          ),
        ).toHaveLength(1);
        expect((yield* app.call("start_orchestration_layer", undefined, a)).isError).toBe(true);
        expect(
          (yield* app.call(
            "spawn_child",
            { title: "Grandchild", prompt: "Delegate", mode: "review", reviewRef: "HEAD" },
            a,
          )).isError,
        ).toBe(true);
        expect(
          (yield* app.call("create_thread", { title: "Grandchild", prompt: "Delegate" }, a))
            .isError,
        ).toBe(true);
        expect(
          (yield* app.call("assign_child", { threadId: b, prompt: "Bypass parent" }, a)).isError,
        ).toBe(true);
        expect((yield* app.call("read_thread", { threadId: parentId }, a)).isError).toBe(true);
        expect((yield* app.call("read_thread", { threadId: b }, a)).isError).toBe(true);
        expect((yield* app.call("read_thread", {}, a)).isError).toBe(false);
        const child = (yield* app.read()).threads.find((thread) => thread.id === a);
        expect(child?.branch).toBeNull();
        if (!child?.worktreePath) throw new Error("Missing review snapshot");
        yield* app.fs.writeFileString(
          app.path.join(app.workspace, "README.md"),
          "Parent changed after assignment\n",
        );
        expect(yield* app.fs.readFileString(app.path.join(child.worktreePath, "README.md"))).toBe(
          "Frozen review contents\n",
        );
        expect(yield* app.git(child.worktreePath, ["rev-parse", "HEAD"])).toBe(
          (yield* app.assignment(a)).reviewRef,
        );

        const shell = yield* app.snapshots.getShellSnapshot();
        const childShellState = shell.threads.find((thread) => thread.id === a)?.coordination;
        expect(childShellState?.role === "child" && childShellState.report).toEqual({
          id: first.assignmentId,
        });
        expect((yield* app.call("read_thread", { threadId: a })).structuredContent).toMatchObject({
          coordination: { report: { text: "A found a race." } },
        });
      } finally {
        yield* app.dispose();
      }
    }),
);

it.effect(
  "preserves reports and counters through pause/resume, cancels queued work, and reports a failed start",
  () =>
    Effect.gen(function* () {
      const app = yield* fixture();
      try {
        yield* app.call("start_orchestration_layer");
        yield* app.call("control_orchestration_layer", { action: "pause" });
        const queued = yield* app.call("spawn_child", {
          title: "Paused",
          prompt: "Review",
          mode: "review",
          reviewRef: "HEAD",
        });
        expect(queued.isError).toBe(true);
        yield* app.call("control_orchestration_layer", { action: "resume" });
        yield* app.session(parentId, "running");
        const children = [];
        for (let i = 0; i < 5; i++) children.push(yield* app.spawn(String(i)));
        expect((yield* app.assignment(children[4]!)).phase).toBe("queued");
        const first = yield* app.assignment(children[0]!);
        yield* app.dispatch({
          type: "thread.activity.append",
          threadId: children[0]!,
          createdAt: app.now(),
          activity: {
            id: EventId.make("failed-start"),
            kind: "provider.turn.start.failed",
            tone: "error",
            summary: "Start failed",
            payload: {
              requestId: `coordination:${first.assignmentId}`,
              detail: "Provider unavailable",
            },
            turnId: null,
            createdAt: app.now(),
          },
        });
        yield* app.drain();
        expect(yield* app.assignment(children[0]!)).toMatchObject({
          phase: "reported",
          report: { text: "Assignment could not start: Provider unavailable" },
        });
        yield* app.drain();
        expect((yield* app.assignment(children[4]!)).phase).toBe("running");
        const before = (yield* app.read()).threads.find(
          (thread) => thread.id === parentId,
        )?.coordination;
        yield* app.call("control_orchestration_layer", { action: "pause" });
        yield* app.call("control_orchestration_layer", { action: "resume" });
        const after = (yield* app.read()).threads.find(
          (thread) => thread.id === parentId,
        )?.coordination;
        expect(after?.role === "parent" && after.budgets).toEqual(
          before?.role === "parent" && before.budgets,
        );
        yield* app.call("control_orchestration_layer", { action: "cancel" });
        yield* app.drain();
        expect(
          (yield* app.read()).threads.filter(
            (thread) =>
              thread.coordination?.role === "child" && thread.coordination.phase === "running",
          ),
        ).toHaveLength(0);
        expect((yield* app.assignment(children[0]!)).report).not.toBeNull();
      } finally {
        yield* app.dispose();
      }
    }),
);

it.effect("queues initial assignments until planning ends, without spending a parent round", () =>
  Effect.gen(function* () {
    const app = yield* fixture();
    try {
      yield* app.session(parentId, "running");
      yield* app.call("start_orchestration_layer");
      const child = yield* app.spawn("queued-during-planning");
      expect((yield* app.assignment(child)).phase).toBe("queued");
      yield* app.session(parentId, "ready");
      yield* app.drain();
      expect((yield* app.assignment(child)).phase).toBe("running");
      const state = (yield* app.read()).threads.find(
        (thread) => thread.id === parentId,
      )?.coordination;
      expect(state).toMatchObject({
        activating: false,
        budgets: expect.arrayContaining([{ model: "gpt-6-sol", limit: 2, used: 0 }]),
      });
    } finally {
      yield* app.dispose();
    }
  }),
);

it.effect(
  "pauses persisted work before consuming startup events and only starts it after explicit resume",
  () =>
    Effect.gen(function* () {
      const app = yield* fixture(false);
      try {
        yield* app.call("start_orchestration_layer");
        const result = yield* app.call("spawn_child", {
          title: "Recovered",
          prompt: "Review",
          mode: "review",
          reviewRef: "HEAD",
          modelSelection: { instanceId, model: "gpt-6-luna" },
        });
        expect(result.isError).toBe(false);
        const child = decodeCreatedThread(result.structuredContent).threadId;
        yield* app.start();
        yield* app.drain();
        expect(
          (yield* app.read()).threads.find((thread) => thread.id === parentId)?.coordination,
        ).toMatchObject({ status: "paused" });
        expect((yield* app.assignment(child)).phase).toBe("queued");
        yield* app.call("control_orchestration_layer", { action: "resume" });
        yield* app.drain();
        expect((yield* app.assignment(child)).phase).toBe("running");
      } finally {
        yield* app.dispose();
      }
    }),
);

it.effect("clears pending approval state when a cancelled child turn is interrupted", () =>
  Effect.gen(function* () {
    const app = yield* fixture();
    try {
      yield* app.call("start_orchestration_layer");
      const child = yield* app.spawn("approval-worker");
      yield* app.dispatch({
        type: "thread.activity.append",
        threadId: child,
        createdAt: app.now(),
        activity: {
          id: EventId.make("approval-request"),
          kind: "approval.requested",
          tone: "approval",
          summary: "Approval",
          createdAt: app.now(),
          turnId: null,
          payload: { requestId: "approval-owned" },
        },
      });
      expect(
        (yield* app.snapshots.getThreadShellById(child)).pipe(Option.getOrThrow)
          .hasPendingApprovals,
      ).toBe(true);
      yield* app.call("control_orchestration_layer", { action: "cancel" });
      yield* app.dispatch({
        type: "thread.session.set",
        threadId: child,
        createdAt: app.now(),
        session: {
          threadId: child,
          status: "interrupted",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: app.now(),
        },
      });
      expect(
        (yield* app.snapshots.getThreadShellById(child)).pipe(Option.getOrThrow)
          .hasPendingApprovals,
      ).toBe(false);
    } finally {
      yield* app.dispose();
    }
  }),
);
