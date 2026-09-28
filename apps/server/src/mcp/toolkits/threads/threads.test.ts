import * as CoordinationPolicy from "../../../orchestration/CoordinationPolicy.ts";
import { ProcessRunner } from "../../../processRunner.ts";
import { expect, it } from "@effect/vitest";
import { ServerConfig } from "../../../config.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EnvironmentId,
  MessageId,
  OrchestrationCommand,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationThread,
  type OrchestrationThreadShell,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { McpSchema, McpServer } from "effect/unstable/ai";

import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ThreadDeletionReactor } from "../../../orchestration/Services/ThreadDeletionReactor.ts";
import { ProviderRegistry } from "../../../provider/Services/ProviderRegistry.ts";
import { ServerRuntimeStartup } from "../../../serverRuntimeStartup.ts";
import { ThreadsToolkitRegistrationLive } from "../../McpHttpServer.ts";
import { McpInvocationContext, type McpCapability } from "../../McpInvocationContext.ts";

const parent: OrchestrationThreadShell = {
  id: ThreadId.make("parent"),
  projectId: ProjectId.make("project"),
  title: "Parent",
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex-personal"),
    model: "gpt-6-astra",
    options: [{ id: "reasoning", value: "high" }],
  },
  runtimeMode: "approval-required",
  interactionMode: "default",
  branch: "codex/review",
  worktreePath: "/workspace/review",
  pullRequests: [],
  latestTurn: null,
  createdAt: "2026-09-26T00:00:00.000Z",
  updatedAt: "2026-09-26T00:00:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  session: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
};
const decodeCommand = Schema.decodeUnknownSync(OrchestrationCommand);
const catalog: ReadonlyArray<ServerProvider> = [
  {
    instanceId: ProviderInstanceId.make("codex-personal"),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: parent.createdAt,
    slashCommands: [],
    skills: [],
    models: ["gpt-6-astra", "gpt-6-sol", "gpt-6-luna"].map((slug) => ({
      slug,
      name: slug,
      isCustom: false,
      capabilities: {
        optionDescriptors: [
          {
            id: "reasoning",
            label: "Reasoning",
            type: "select",
            options: [{ id: "high", label: "High" }],
          },
        ],
      },
    })),
  },
  {
    instanceId: ProviderInstanceId.make("antigravity-work"),
    driver: ProviderDriverKind.make("antigravity"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: parent.createdAt,
    slashCommands: [],
    skills: [],
    models: [
      { slug: "gemini-3.8-flash", name: "Gemini 3.8 Flash", isCustom: false, capabilities: null },
    ],
  },
];
const client = McpSchema.McpServerClient.of({
  clientId: 1,
  clientCapabilities: {},
  clientInfo: { name: "thread-test", version: "1" },
  protocolVersion: "2025-06-18",
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "thread-test", version: "1" },
  },
  getClient: Effect.die("unused"),
});

function fixture(
  options: {
    providers?: ReadonlyArray<ServerProvider>;
    thread?: OrchestrationThreadShell;
    missingParent?: boolean;
    drain?: (sequence: number) => Effect.Effect<void>;
  } = {},
) {
  const commands: Array<OrchestrationCommand> = [];
  const trace: Array<string> = [];
  const threads = new Map<ThreadId, OrchestrationThreadShell>(
    options.missingParent ? [] : [[parent.id, options.thread ?? parent]],
  );
  const historyReads: Array<unknown> = [];
  let messages: OrchestrationThread["messages"] = [];
  const layer = ThreadsToolkitRegistrationLive.pipe(
    Layer.provideMerge(McpServer.McpServer.layer),
    Layer.provide(
      Layer.mergeAll(
        ServerConfig.layerTest(process.cwd(), { prefix: "t3-thread-tools-test-" }).pipe(
          Layer.provide(NodeServices.layer),
        ),
        NodeServices.layer,
        CoordinationPolicy.layerTest,
        Layer.mock(ProcessRunner)({}),
        Layer.mock(ProviderRegistry)({
          getProviders: Effect.succeed(options.providers ?? catalog),
        }),
        Layer.mock(ServerRuntimeStartup)({
          enqueueCommand: (effect) =>
            Effect.suspend(() => {
              trace.push("ready");
              return effect;
            }),
        }),
        Layer.mock(ThreadDeletionReactor)({
          drainThrough: (sequence) =>
            Effect.sync(() => {
              trace.push(`drain:${sequence}`);
            }).pipe(Effect.andThen(options.drain?.(sequence) ?? Effect.void)),
        }),
        Layer.mock(OrchestrationEngineService)({
          dispatch: (command) =>
            Effect.sync(() => {
              decodeCommand(command);
              commands.push(command);
              trace.push(command.type);
              if (command.type === "thread.create")
                threads.set(command.threadId, {
                  ...parent,
                  id: command.threadId,
                  title: command.title,
                  modelSelection: command.modelSelection,
                });
              return { sequence: commands.length };
            }),
        }),
        Layer.mock(ProjectionSnapshotQuery)({
          getThreadShellById: (id) => Effect.succeed(Option.fromUndefinedOr(threads.get(id))),
          getThreadDetailSnapshot: (id, window) =>
            Effect.sync(() => {
              historyReads.push({ id, window });
              const thread = threads.get(id);
              return thread
                ? Option.some({
                    snapshotSequence: 1,
                    thread: {
                      ...thread,
                      coordination:
                        thread.coordination?.role === "parent" ? thread.coordination : null,
                      messages,
                      deletedAt: null,
                      activities: [],
                      proposedPlans: [],
                      checkpoints: [],
                    },
                    page: { beforeCursor: "older", hasMore: true, snapshotSequence: 1 },
                  })
                : Option.none();
            }),
        }),
      ),
    ),
  );
  const call = (
    name: string,
    args: Record<string, unknown> = {},
    capabilities: ReadonlyArray<McpCapability> = ["threads"],
  ) =>
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      return yield* server.callTool({ name, arguments: args }).pipe(
        Effect.provideService(McpSchema.McpServerClient, client),
        Effect.provideService(McpInvocationContext, {
          environmentId: EnvironmentId.make("env"),
          threadId: parent.id,
          providerSessionId: "session",
          providerInstanceId: parent.modelSelection.instanceId,
          capabilities: new Set(capabilities),
          issuedAt: 1,
        }),
      );
    });
  return {
    layer,
    call,
    commands,
    trace,
    threads,
    historyReads,
    setMessages: (value: OrchestrationThread["messages"]) => {
      messages = value;
    },
  };
}

it.effect.each([
  { name: "inherited model", selection: undefined },
  { name: "Sol", selection: { instanceId: "codex-personal", model: "gpt-6-sol" } },
  {
    name: "Luna with reasoning",
    selection: {
      instanceId: "codex-personal",
      model: "gpt-6-luna",
      options: [{ id: "reasoning", value: "high" }],
    },
  },
  {
    name: "another provider",
    selection: { instanceId: "antigravity-work", model: "gemini-3.8-flash" },
  },
])("creates a fresh handoff thread with $name and starts its full prompt", ({ selection }) => {
  const test = fixture();
  return Effect.gen(function* () {
    const prompt =
      "# Handoff\n\nThe complete conversation summary.\nDo not use tools until the user confirms.";
    const result = yield* test.call("create_thread", {
      title: "Continue work",
      prompt,
      ...(selection ? { modelSelection: selection } : {}),
    });
    expect(result.isError).toBe(false);
    const expected = selection ?? parent.modelSelection;
    expect(result.structuredContent).toMatchObject({ modelSelection: expected });
    const childId =
      test.commands[0]?.type === "thread.create" ? test.commands[0].threadId : undefined;
    expect(childId).toBeDefined();
    expect(childId).not.toBe(parent.id);
    expect(test.commands).toMatchObject([
      {
        type: "thread.create",
        threadId: childId,
        projectId: parent.projectId,
        title: "Continue work",
        modelSelection: expected,
        runtimeMode: parent.runtimeMode,
        interactionMode: parent.interactionMode,
        branch: parent.branch,
        worktreePath: parent.worktreePath,
      },
      {
        type: "thread.turn.start",
        threadId: childId,
        modelSelection: expected,
        message: { role: "user", text: prompt, attachments: [] },
        runtimeMode: parent.runtimeMode,
      },
    ]);
    if (selection && !("options" in selection)) {
      expect(
        test.commands[0]?.type === "thread.create" && test.commands[0].modelSelection.options,
      ).toBeUndefined();
    }
    expect(test.trace).toEqual(["ready", "thread.create", "drain:1", "thread.turn.start"]);
    expect(test.threads.get(parent.id)).toEqual(parent);
  }).pipe(Effect.provide(test.layer));
});

it.effect.each([
  { instanceId: "missing", model: "gpt-6-sol" },
  { instanceId: "codex-personal", model: "gemini-3.8-flash" },
  {
    instanceId: "antigravity-work",
    model: "gemini-3.8-flash",
    options: [{ id: "reasoning", value: "high" }],
  },
  {
    instanceId: "codex-personal",
    model: "gpt-6-sol",
    options: [{ id: "reasoning", value: "invalid" }],
  },
])("rejects invalid model selections before creating anything %#", (selection) => {
  const test = fixture();
  return Effect.gen(function* () {
    const result = yield* test.call("create_thread", {
      title: "Review",
      prompt: "Review this.",
      modelSelection: selection,
    });
    expect(result.isError).toBe(true);
    expect(test.commands).toEqual([]);
  }).pipe(Effect.provide(test.layer));
});

it.effect.each([
  { enabled: false },
  { installed: false },
  { status: "error" as const },
  { auth: { status: "unauthenticated" as const } },
  { availability: "unavailable" as const },
])("reports unavailable instances and prevents starting them %#", (override) => {
  const test = fixture({ providers: catalog.map((provider) => ({ ...provider, ...override })) });
  return Effect.gen(function* () {
    const models = yield* test.call("list_thread_models");
    expect(models.isError).toBe(false);
    expect(models.structuredContent).toMatchObject({
      current: parent.modelSelection,
      providers: [{ available: false, reason: expect.any(String) }, { available: false }],
    });
    const result = yield* test.call("create_thread", { title: "Review", prompt: "Review this." });
    expect(result.isError).toBe(true);
    expect(test.commands).toEqual([]);
  }).pipe(Effect.provide(test.layer));
});

it.effect("discovers provider instances, model slugs and valid reasoning choices", () => {
  const test = fixture();
  return Effect.gen(function* () {
    const result = yield* test.call("list_thread_models");
    expect(result.structuredContent).toMatchObject({
      providers: [
        {
          instanceId: "codex-personal",
          available: true,
          models: [
            { model: "gpt-6-astra", capabilities: { optionDescriptors: [{ id: "reasoning" }] } },
            { model: "gpt-6-sol" },
            { model: "gpt-6-luna" },
          ],
        },
        {
          instanceId: "antigravity-work",
          available: true,
          models: [{ model: "gemini-3.8-flash" }],
        },
      ],
    });
  }).pipe(Effect.provide(test.layer));
});

it.effect("withholds thread tools without the credential capability", () => {
  const test = fixture();
  return Effect.gen(function* () {
    for (const [name, args] of [
      ["list_thread_models", {}],
      ["create_thread", { title: "Review", prompt: "Review this." }],
      ["read_thread", {}],
      ["send_message_to_thread", { threadId: parent.id, prompt: "Continue" }],
      ["interrupt_thread", { threadId: parent.id }],
    ] as const) {
      const result = yield* test.call(name, args, ["pull-requests"]);
      expect(result.isError).toBe(true);
    }
    expect(test.commands).toEqual([]);
  }).pipe(Effect.provide(test.layer));
});

it.effect("reads a child's result with bounded history and continues it", () => {
  const test = fixture();
  const childId = ThreadId.make("child");
  test.threads.set(childId, {
    ...parent,
    id: childId,
    modelSelection: {
      instanceId: ProviderInstanceId.make("antigravity-work"),
      model: "gemini-3.8-flash",
    },
  });
  test.setMessages([
    {
      id: MessageId.make("result"),
      role: "assistant",
      text: "x".repeat(17_000),
      createdAt: parent.createdAt,
      updatedAt: parent.createdAt,
      turnId: null,
      attachments: [],
      streaming: false,
    },
  ]);
  return Effect.gen(function* () {
    const read = yield* test.call("read_thread", { threadId: childId, beforeCursor: "cursor" });
    expect(read.structuredContent).toMatchObject({
      threadId: childId,
      beforeCursor: "older",
      messages: [{ text: "x".repeat(16_000), truncated: true }],
    });
    expect(test.historyReads).toEqual([
      { id: childId, window: { turnLimit: 3, beforeCursor: "cursor" } },
    ]);
    const sent = yield* test.call("send_message_to_thread", {
      threadId: childId,
      prompt: "Verify the fix again.",
    });
    expect(sent.isError).toBe(false);
    expect(test.commands).toMatchObject([
      {
        type: "thread.turn.start",
        threadId: childId,
        message: { text: "Verify the fix again." },
        runtimeMode: parent.runtimeMode,
      },
    ]);
    expect(
      test.commands[0]?.type === "thread.turn.start" && test.commands[0].modelSelection,
    ).toBeUndefined();
  }).pipe(Effect.provide(test.layer));
});

it.effect("rejects a follow-up to a busy thread and can interrupt it", () => {
  const test = fixture({
    thread: {
      ...parent,
      latestTurn: {
        turnId: TurnId.make("turn"),
        state: "running",
        requestedAt: parent.createdAt,
        startedAt: parent.createdAt,
        completedAt: null,
        assistantMessageId: null,
      },
    },
  });
  return Effect.gen(function* () {
    const result = yield* test.call("send_message_to_thread", {
      threadId: parent.id,
      prompt: "Continue",
    });
    expect(result.isError).toBe(true);
    expect(test.commands).toEqual([]);
    const stopped = yield* test.call("interrupt_thread", { threadId: parent.id });
    expect(stopped.isError).toBe(false);
    expect(test.commands).toMatchObject([{ type: "thread.turn.interrupt", threadId: parent.id }]);
  }).pipe(Effect.provide(test.layer));
});

it.effect("does not read or mutate threads outside the calling project", () => {
  const test = fixture();
  const other = ThreadId.make("other");
  test.threads.set(other, { ...parent, id: other, projectId: ProjectId.make("another-project") });
  return Effect.gen(function* () {
    for (const name of ["read_thread", "send_message_to_thread", "interrupt_thread"]) {
      const result = yield* test.call(name, { threadId: other, prompt: "Continue" });
      expect(result.isError).toBe(true);
    }
    expect(test.commands).toEqual([]);
    expect(test.historyReads).toEqual([]);
  }).pipe(Effect.provide(test.layer));
});

it.effect("cannot spawn from a deleted source thread", () => {
  const test = fixture({ missingParent: true });
  return Effect.gen(function* () {
    const result = yield* test.call("create_thread", { title: "Continue", prompt: "Handoff" });
    expect(result.isError).toBe(true);
    expect(test.commands).toEqual([]);
  }).pipe(Effect.provide(test.layer));
});

it.effect("persists the initial handoff even when the MCP caller disconnects during creation", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const test = fixture({
      drain: () =>
        Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))),
    });
    yield* Effect.scoped(
      Effect.gen(function* () {
        const fiber = yield* test
          .call("create_thread", { title: "Continue", prompt: "The full handoff" })
          .pipe(Effect.forkScoped);
        yield* Deferred.await(entered);
        yield* Effect.sync(() => fiber.interruptUnsafe());
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.await(fiber);
        expect(test.commands).toMatchObject([
          { type: "thread.create" },
          { type: "thread.turn.start", message: { text: "The full handoff" } },
        ]);
      }),
    ).pipe(Effect.provide(test.layer));
  }),
);
