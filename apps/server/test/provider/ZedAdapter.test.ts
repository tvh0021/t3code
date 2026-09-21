import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { describe, expect } from "vite-plus/test";

import {
  ApprovalRequestId,
  ProviderInstanceId,
  ZedSettings,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";

import { ServerConfig } from "../../src/config.ts";
import { writeFakeCli } from "../../src/testUtils/fakeCli.ts";
import { makeZedAdapter } from "../../src/provider/Layers/ZedAdapter.ts";
import {
  checkZedProviderStatus,
  buildInitialZedProviderSnapshot,
} from "../../src/provider/Layers/ZedProvider.ts";

const decodeZedSettings = Schema.decodeSync(ZedSettings);

const REAL_ZED_BIN = "/Users/tvh0021/git_repos/zed-dev/target/debug/zed-acp-server";
const hasRealZed = NodeFS.existsSync(REAL_ZED_BIN);
// Hosted Zed models require network access and credentials, so the live test is explicit.
const runLiveZedTests = process.env.T3_RUN_LIVE_ZED_TESTS === "1";
const realZedDataDir = process.env.T3_ZED_DATA_DIR?.trim();
// One live smoke request is enough to exercise ACP startup and streaming.
const realZedModel = process.env.T3_ZED_MODEL?.trim() || "zed.dev/gpt-5.6-luna";

function decodeRealZedSettings() {
  return decodeZedSettings({
    binaryPath: REAL_ZED_BIN,
    ...(realZedDataDir ? { dataDir: realZedDataDir } : {}),
  });
}

function withTestServices<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return effect.pipe(
    Effect.provide(
      ServerConfig.layerTest(process.cwd(), {
        prefix: "t3code-zed-adapter-test-",
      }).pipe(Layer.provideMerge(NodeServices.layer)),
    ),
    Effect.scoped,
  );
}

async function makeFakeZedCli(options?: {
  readonly onRequestPermission?: boolean;
  readonly onElicitation?: boolean;
  readonly onMessageIdStreaming?: boolean;
  readonly onUsageUpdate?: boolean;
  readonly onRepeatedToolCompletion?: boolean;
  readonly terminalStatus?: "completed" | "failed";
  readonly onLateToolOutput?: boolean;
}) {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "fake-zed-test-"));
  const script = `
import * as readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let currentSessionId = "fake-zed-session-1";
let pendingPromptId = null;

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\\n");
}

rl.on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  const id = msg.id;
  const method = msg.method;

  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: 1,
        serverInfo: { name: "fake-zed", version: "0.1.0" },
        capabilities: {
          elicitation: { form: {} },
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false
        }
      }
    });
    return;
  }

  if (method === "session/new") {
    send({
      jsonrpc: "2.0",
      id,
      result: { sessionId: currentSessionId }
    });
    return;
  }

  if (method === "session/cancel") {
    send({ jsonrpc: "2.0", id, result: {} });
    return;
  }

  if (method === "session/prompt") {
    ${
      options?.onRepeatedToolCompletion
        ? `
    const update = (update) => send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: currentSessionId, update } });
    update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Checking conventions." } });
    update({ sessionUpdate: "tool_call", toolCallId: "read-1", title: "Read ledger", kind: "read", status: "in_progress" });
    const completed = { sessionUpdate: "tool_call_update", toolCallId: "read-1", status: "${options?.terminalStatus ?? "completed"}", rawOutput: { text: "ledger contents" } };
    update(completed);
    for (const text of ["The sp", "ecific choices", " this lesson locks in."]) {
      update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
      update(completed);
    }
    if (${options?.onLateToolOutput ?? false}) {
      completed.rawOutput = { text: "updated ledger contents" };
      update(completed);
      update(completed);
    }
    `
        : options?.onMessageIdStreaming
          ? `
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: currentSessionId,
        update: {
          sessionUpdate: "agent_thought_chunk",
          messageId: "thought-1",
          content: { type: "text", text: "Inspecting the docs.\\n" }
        }
      }
    });
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: currentSessionId,
        update: {
          sessionUpdate: "agent_thought_chunk",
          messageId: "thought-2",
          content: { type: "text", text: "Now summarizing." }
        }
      }
    });
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: currentSessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "message-1",
          content: { type: "text", text: "The" }
        }
      }
    });
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: currentSessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "tool-1",
          title: "Read docs",
          kind: "read",
          status: "in_progress"
        }
      }
    });
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: currentSessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "tool-1",
          status: "completed"
        }
      }
    });
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: currentSessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "message-1",
          content: { type: "text", text: " docs" }
        }
      }
    });
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: currentSessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "message-1",
          content: { type: "text", text: " directory" }
        }
      }
    });
    `
          : options?.onUsageUpdate
            ? `
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: currentSessionId,
        update: {
          sessionUpdate: "usage_update",
          size: 10000,
          used: 2500,
          cost: { amount: 2.5, currency: "USD" }
        }
      }
    });
    `
            : `
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: currentSessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Fake Zed answered: " + (msg.params?.prompt?.[0]?.text ?? "") }
        }
      }
    });
    `
    }

    ${
      options?.onRequestPermission
        ? `
    send({
      jsonrpc: "2.0",
      id: 9001,
      method: "session/request_permission",
      params: {
        sessionId: currentSessionId,
        toolCall: {
          toolCallId: "tool-1",
          title: "Run build",
          kind: "execute",
          status: "pending"
        },
        options: [
          { optionId: "allow", name: "Allow", kind: "allow_once" },
          { optionId: "deny", name: "Deny", kind: "reject_once" }
        ]
      }
    });
    pendingPromptId = id;
    return;
    `
        : options?.onElicitation
          ? `
    send({
      jsonrpc: "2.0",
      id: 9002,
      method: "session/elicitation",
      params: {
        sessionId: currentSessionId,
        mode: "form",
        message: "Enter target name",
        requestedSchema: {
          type: "object",
          properties: {
            target: { type: "string", title: "Target", description: "Build target name" }
          }
        }
      }
    });
    pendingPromptId = id;
    return;
    `
          : `
    send({
      jsonrpc: "2.0",
      id,
      result: { stopReason: "end_turn" }
    });
    return;
    `
    }
  }

  if (id === 9001 || id === 9002) {
    if (id === 9001 && msg.result?.outcome?.optionId !== "allow") {
      process.stderr.write("unexpected permission option\\n");
      process.exit(42);
      return;
    }
    if (pendingPromptId !== null) {
      send({
        jsonrpc: "2.0",
        id: pendingPromptId,
        result: { stopReason: "end_turn" }
      });
      pendingPromptId = null;
    }
    return;
  }

  if (method === "zed/invoke_skill") {
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: currentSessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Skill executed: " + (msg.params?.skillName ?? "") }
        }
      }
    });
    send({
      jsonrpc: "2.0",
      id,
      result: { stopReason: "end_turn" }
    });
    return;
  }
});
`;

  return writeFakeCli({
    directory: dir,
    name: "fake-zed",
    source: script,
  });
}

describe("ZedProvider Snapshot and Probe", () => {
  it.effect("builds disabled snapshot when enabled is false", () =>
    Effect.gen(function* () {
      const snapshot = yield* withTestServices(
        buildInitialZedProviderSnapshot(decodeZedSettings({ enabled: false })),
      );
      expect(snapshot.enabled).toBe(false);
      expect(snapshot.installed).toBe(false);
    }),
  );

  it.effect("builds initial ready snapshot when enabled is true", () =>
    Effect.gen(function* () {
      const snapshot = yield* withTestServices(
        buildInitialZedProviderSnapshot(decodeZedSettings({ enabled: true })),
      );
      expect(snapshot.enabled).toBe(true);
      expect(snapshot.slashCommands?.length).toBe(1);
      expect(snapshot.slashCommands?.[0]?.name).toBe("compact");
      expect(snapshot.reportsContextWindow).toBe(true);
      expect(snapshot.usageLimits).toBeUndefined();
      expect(snapshot.models.map((model) => model.slug)).toEqual([
        "zed.dev/claude-sonnet-5",
        "zed.dev/gpt-5.6-luna",
      ]);
    }),
  );

  it.effect("reports uninstalled when binary is not found", () =>
    Effect.gen(function* () {
      const status = yield* withTestServices(
        checkZedProviderStatus(
          decodeZedSettings({ enabled: true, binaryPath: "nonexistent-zed-binary" }),
        ),
      );
      expect(status.installed).toBe(false);
    }),
  );

  if (hasRealZed) {
    it.effect("reports installed and ready when pointing to real binary", () =>
      Effect.gen(function* () {
        const status = yield* withTestServices(
          checkZedProviderStatus(decodeZedSettings({ enabled: true, binaryPath: REAL_ZED_BIN })),
        );
        expect(status.installed).toBe(true);
        expect(status.status).toBe("ready");
      }),
    );
  }
});

describe("ZedAdapter Lifecycle and Turn Streaming", () => {
  it.effect("starts session and sends turn with content deltas", () =>
    withTestServices(
      Effect.gen(function* () {
        const threadId = ThreadId.make("zed-adapter-turn-1");
        const fakeBinary = yield* Effect.promise(() => makeFakeZedCli());
        const adapter = yield* makeZedAdapter(decodeZedSettings({ binaryPath: fakeBinary }));

        const events: ProviderRuntimeEvent[] = [];
        const turnCompleted = yield* Deferred.make<void>();
        const contentReceived = yield* Deferred.make<void>();

        yield* Stream.runForEach(adapter.streamEvents, (event) =>
          Effect.gen(function* () {
            events.push(event);
            if (event.type === "content.delta") {
              yield* Deferred.succeed(contentReceived, undefined);
            }
            if (event.type === "turn.completed") {
              yield* Deferred.succeed(turnCompleted, undefined);
            }
          }),
        ).pipe(Effect.forkChild);

        const session = yield* adapter.startSession({
          threadId,
          cwd: process.cwd(),
          runtimeMode: "full-access",
        });

        expect(session.provider).toBe("zed");
        expect(session.status).toBe("ready");
        expect(yield* adapter.hasSession(threadId)).toBe(true);

        const turn = yield* adapter.sendTurn({
          threadId,
          input: "hello zed",
        });

        yield* Deferred.await(turnCompleted).pipe(Effect.timeout("5 seconds"));
        yield* Deferred.await(contentReceived).pipe(Effect.timeout("5 seconds"));

        expect(turn.threadId).toBe(threadId);
        const deltas = events.filter((e) => e.type === "content.delta");
        expect(deltas.length).toBeGreaterThan(0);

        yield* adapter.stopSession(threadId);
        expect(yield* adapter.hasSession(threadId)).toBe(false);
      }),
    ),
  );

  it.effect("publishes Zed context usage as a token update, without faking account spend", () =>
    withTestServices(
      Effect.gen(function* () {
        const threadId = ThreadId.make("zed-adapter-usage-1");
        const fakeBinary = yield* Effect.promise(() => makeFakeZedCli({ onUsageUpdate: true }));
        const adapter = yield* makeZedAdapter(decodeZedSettings({ binaryPath: fakeBinary }));
        const usageUpdated = yield* Deferred.make<void>();
        const events: ProviderRuntimeEvent[] = [];

        yield* Stream.runForEach(adapter.streamEvents, (event) =>
          Effect.gen(function* () {
            events.push(event);
            if (event.type === "thread.token-usage.updated") {
              yield* Deferred.succeed(usageUpdated, undefined);
            }
          }),
        ).pipe(Effect.forkChild);

        yield* adapter.startSession({
          threadId,
          cwd: process.cwd(),
          runtimeMode: "full-access",
        });
        yield* adapter.sendTurn({ threadId, input: "report usage" });
        yield* Deferred.await(usageUpdated).pipe(Effect.timeout("5 seconds"));

        const usageEvent = events.find((event) => event.type === "thread.token-usage.updated");
        expect(usageEvent?.payload.usage).toMatchObject({
          usedTokens: 2500,
          maxTokens: 10000,
          compactsAutomatically: true,
        });
        expect(events.some((event) => event.type === "account.rate-limits.updated")).toBe(false);

        yield* adapter.stopSession(threadId);
      }),
    ),
  );

  it.effect("keeps ACP message chunks together across tool updates", () =>
    withTestServices(
      Effect.gen(function* () {
        const threadId = ThreadId.make("zed-adapter-message-id-1");
        const fakeBinary = yield* Effect.promise(() =>
          makeFakeZedCli({ onMessageIdStreaming: true }),
        );
        const adapter = yield* makeZedAdapter(decodeZedSettings({ binaryPath: fakeBinary }));
        const events: ProviderRuntimeEvent[] = [];
        const contentReceived = yield* Deferred.make<void>();
        const turnCompleted = yield* Deferred.make<void>();

        yield* Stream.runForEach(adapter.streamEvents, (event) =>
          Effect.gen(function* () {
            events.push(event);
            if (event.type === "content.delta") {
              yield* Deferred.succeed(contentReceived, undefined);
            }
            if (event.type === "turn.completed") {
              yield* Deferred.succeed(turnCompleted, undefined);
            }
          }),
        ).pipe(Effect.forkChild);

        yield* adapter.startSession({
          threadId,
          cwd: process.cwd(),
          runtimeMode: "full-access",
        });
        yield* adapter.sendTurn({ threadId, input: "show docs" });

        yield* Deferred.await(contentReceived).pipe(Effect.timeout("5 seconds"));
        yield* Deferred.await(turnCompleted).pipe(Effect.timeout("5 seconds"));

        const deltas = events.filter((event) => event.type === "content.delta");
        const assistantDeltas = deltas.filter(
          (event) => event.payload.streamKind === "assistant_text",
        );
        const thoughtDeltas = deltas.filter(
          (event) => event.payload.streamKind === "reasoning_text",
        );
        expect(assistantDeltas.map((event) => event.payload.delta)).toEqual([
          "The",
          " docs",
          " directory",
        ]);
        expect(thoughtDeltas.map((event) => event.payload.delta)).toEqual([
          "Inspecting the docs.\n",
          "Now summarizing.",
        ]);
        expect(new Set(assistantDeltas.map((event) => String(event.itemId))).size).toBe(1);
        expect(thoughtDeltas.map((event) => String(event.itemId))).toEqual([
          "thought-1",
          "thought-2",
        ]);

        yield* adapter.stopSession(threadId);
      }),
    ),
  );

  it.effect.each([
    { terminalStatus: "completed", onLateToolOutput: false },
    { terminalStatus: "failed", onLateToolOutput: false },
    { terminalStatus: "completed", onLateToolOutput: true },
  ] as const)(
    "keeps answer chunks together with repeated $terminalStatus snapshots, late output=$onLateToolOutput",
    ({ terminalStatus, onLateToolOutput }) =>
      withTestServices(
        Effect.gen(function* () {
          const threadId = ThreadId.make("zed-repeated-completion");
          const fakeBinary = yield* Effect.promise(() =>
            makeFakeZedCli({ onRepeatedToolCompletion: true, terminalStatus, onLateToolOutput }),
          );
          const adapter = yield* makeZedAdapter(decodeZedSettings({ binaryPath: fakeBinary }));
          const events: ProviderRuntimeEvent[] = [];
          const completed = yield* Deferred.make<void>();
          yield* Stream.runForEach(adapter.streamEvents, (event) =>
            Effect.gen(function* () {
              events.push(event);
              if (event.type === "turn.completed") yield* Deferred.succeed(completed, undefined);
            }),
          ).pipe(Effect.forkChild);
          yield* adapter.startSession({
            threadId,
            cwd: process.cwd(),
            runtimeMode: "full-access",
          });
          yield* adapter.sendTurn({ threadId, input: "Explain the ledger." });
          yield* Deferred.await(completed).pipe(Effect.timeout("5 seconds"));
          const answer = events.filter(
            (e) => e.type === "content.delta" && e.payload.streamKind === "assistant_text",
          );
          expect(answer.map((e) => e.payload.delta).join("")).toBe(
            "The specific choices this lesson locks in.",
          );
          expect(new Set(answer.map((e) => e.itemId)).size).toBe(1);
          expect(
            events.filter((e) => e.type === "item.completed" && e.itemId === "read-1"),
          ).toHaveLength(onLateToolOutput ? 2 : 1);
          if (onLateToolOutput) {
            expect(
              events.findLast((e) => e.type === "item.completed" && e.itemId === "read-1")?.payload,
            ).toMatchObject({ data: { rawOutput: { text: "updated ledger contents" } } });
          }
          expect(
            events
              .filter(
                (e) => e.type === "content.delta" && e.payload.streamKind === "reasoning_text",
              )
              .map((e) => e.payload.delta),
          ).toEqual(["Checking conventions."]);
          yield* adapter.stopSession(threadId);
        }),
      ),
  );

  it.effect("routes permission requests through T3 approval flow", () =>
    withTestServices(
      Effect.gen(function* () {
        const threadId = ThreadId.make("zed-adapter-approval-1");
        const fakeBinary = yield* Effect.promise(() =>
          makeFakeZedCli({ onRequestPermission: true }),
        );
        const adapter = yield* makeZedAdapter(decodeZedSettings({ binaryPath: fakeBinary }));

        const requestOpened = yield* Deferred.make<ApprovalRequestId>();
        const requestResolved = yield* Deferred.make<void>();

        yield* Stream.runForEach(adapter.streamEvents, (event) =>
          Effect.gen(function* () {
            if (event.type === "request.opened") {
              yield* Deferred.succeed(requestOpened, ApprovalRequestId.make(event.requestId));
            }
            if (event.type === "request.resolved") {
              yield* Deferred.succeed(requestResolved, undefined);
            }
          }),
        ).pipe(Effect.forkChild);

        yield* adapter.startSession({
          threadId,
          cwd: process.cwd(),
          runtimeMode: "auto",
        });

        const turnFiber = yield* adapter
          .sendTurn({
            threadId,
            input: "run tool",
          })
          .pipe(Effect.forkChild);

        const requestId = yield* Deferred.await(requestOpened).pipe(Effect.timeout("5 seconds"));
        expect(requestId).toBeDefined();

        yield* adapter.respondToRequest(threadId, requestId, "accept");
        yield* Deferred.await(requestResolved).pipe(Effect.timeout("5 seconds"));

        yield* Fiber.join(turnFiber);
        yield* adapter.stopSession(threadId);
      }),
    ),
  );

  it.effect("routes elicitation requests through T3 user-input flow", () =>
    withTestServices(
      Effect.gen(function* () {
        const threadId = ThreadId.make("zed-adapter-elicit-1");
        const fakeBinary = yield* Effect.promise(() => makeFakeZedCli({ onElicitation: true }));
        const adapter = yield* makeZedAdapter(decodeZedSettings({ binaryPath: fakeBinary }));

        const inputRequested = yield* Deferred.make<ApprovalRequestId>();
        const inputResolved = yield* Deferred.make<void>();

        yield* Stream.runForEach(adapter.streamEvents, (event) =>
          Effect.gen(function* () {
            if (event.type === "user-input.requested") {
              yield* Deferred.succeed(inputRequested, ApprovalRequestId.make(event.requestId));
            }
            if (event.type === "user-input.resolved") {
              yield* Deferred.succeed(inputResolved, undefined);
            }
          }),
        ).pipe(Effect.forkChild);

        yield* adapter.startSession({
          threadId,
          cwd: process.cwd(),
          runtimeMode: "auto",
        });

        const turnFiber = yield* adapter
          .sendTurn({
            threadId,
            input: "configure target",
          })
          .pipe(Effect.forkChild);

        const requestId = yield* Deferred.await(inputRequested).pipe(Effect.timeout("5 seconds"));
        expect(requestId).toBeDefined();

        yield* adapter.respondToUserInput(threadId, requestId, { target: "release-build" });
        yield* Deferred.await(inputResolved).pipe(Effect.timeout("5 seconds"));

        yield* Fiber.join(turnFiber);
        yield* adapter.stopSession(threadId);
      }),
    ),
  );

  it.effect("dispatches /compact and /skill to zed/invoke_skill", () =>
    withTestServices(
      Effect.gen(function* () {
        const threadId = ThreadId.make("zed-adapter-skill-1");
        const fakeBinary = yield* Effect.promise(() => makeFakeZedCli());
        const adapter = yield* makeZedAdapter(decodeZedSettings({ binaryPath: fakeBinary }));

        const events: ProviderRuntimeEvent[] = [];
        const compactCompleted = yield* Deferred.make<void>();
        const compactContentReceived = yield* Deferred.make<void>();
        const skillCompleted = yield* Deferred.make<void>();
        const skillContentReceived = yield* Deferred.make<void>();
        let completedTurns = 0;

        yield* Stream.runForEach(adapter.streamEvents, (event) =>
          Effect.gen(function* () {
            events.push(event);
            if (event.type === "content.delta") {
              if (event.payload.delta.includes("Skill executed: compact")) {
                yield* Deferred.succeed(compactContentReceived, undefined);
              }
              if (event.payload.delta.includes("Skill executed: review")) {
                yield* Deferred.succeed(skillContentReceived, undefined);
              }
            }
            if (event.type === "turn.completed") {
              completedTurns += 1;
              yield* Deferred.succeed(
                completedTurns === 1 ? compactCompleted : skillCompleted,
                undefined,
              );
            }
          }),
        ).pipe(Effect.forkChild);

        yield* adapter.startSession({
          threadId,
          cwd: process.cwd(),
          runtimeMode: "full-access",
        });

        yield* adapter.sendTurn({
          threadId,
          input: "/compact",
        });

        yield* Deferred.await(compactCompleted).pipe(Effect.timeout("5 seconds"));
        yield* Deferred.await(compactContentReceived).pipe(Effect.timeout("5 seconds"));

        yield* adapter.sendTurn({
          threadId,
          input: "/skill review",
        });

        yield* Deferred.await(skillCompleted).pipe(Effect.timeout("5 seconds"));
        yield* Deferred.await(skillContentReceived).pipe(Effect.timeout("5 seconds"));

        const contentEvents = events.filter((e) => e.type === "content.delta");
        expect(contentEvents).toHaveLength(2);
        expect(contentEvents[0]?.payload.delta).toContain("Skill executed: compact");
        expect(contentEvents[1]?.payload.delta).toContain("Skill executed: review");

        yield* adapter.stopSession(threadId);
      }),
    ),
  );

  it.effect("rejects rollback without altering stored thread history", () =>
    withTestServices(
      Effect.gen(function* () {
        const threadId = ThreadId.make("zed-adapter-rollback-1");
        const fakeBinary = yield* Effect.promise(() => makeFakeZedCli());
        const adapter = yield* makeZedAdapter(decodeZedSettings({ binaryPath: fakeBinary }));

        yield* adapter.startSession({
          threadId,
          cwd: process.cwd(),
          runtimeMode: "full-access",
        });

        yield* adapter.sendTurn({
          threadId,
          input: "remember this",
        });

        const before = yield* adapter.readThread(threadId);
        expect(before.turns.length).toBe(1);

        const rollbackError = yield* adapter.rollbackThread(threadId, 1).pipe(Effect.flip);
        expect(rollbackError._tag).toBe("ProviderAdapterRequestError");

        const after = yield* adapter.readThread(threadId);
        expect(after.turns.length).toBe(1);

        yield* adapter.stopSession(threadId);
      }),
    ),
  );

  if (hasRealZed) {
    it.effect.skipIf(!runLiveZedTests)(
      "executes end-to-end against real zed-acp-server binary",
      () =>
        withTestServices(
          Effect.gen(function* () {
            const threadId = ThreadId.make("zed-adapter-real-bin-smoke");
            const adapter = yield* makeZedAdapter(decodeRealZedSettings());
            const contentReceived = yield* Deferred.make<void>();
            const turnCompleted = yield* Deferred.make<void>();
            const content: string[] = [];
            yield* Stream.runForEach(adapter.streamEvents, (event) =>
              Effect.gen(function* () {
                if (event.type === "content.delta") {
                  content.push(event.payload.delta);
                  yield* Deferred.succeed(contentReceived, undefined);
                }
                if (event.type === "turn.completed") {
                  yield* Deferred.succeed(turnCompleted, undefined);
                }
              }),
            ).pipe(Effect.forkChild);

            const session = yield* adapter.startSession({
              threadId,
              cwd: process.cwd(),
              runtimeMode: "full-access",
              modelSelection: {
                instanceId: ProviderInstanceId.make("zed"),
                model: realZedModel,
              },
            });

            expect(session.provider).toBe("zed");
            expect(session.status).toBe("ready");

            const turn = yield* adapter.sendTurn({
              threadId,
              input: "Reply with exactly OK.",
            });

            expect(turn.threadId).toBe(threadId);
            yield* Deferred.await(turnCompleted).pipe(Effect.timeout("20 seconds"));
            yield* Deferred.await(contentReceived).pipe(Effect.timeout("20 seconds"));
            expect(content.join("").trim()).toBe("OK");
            expect(content.join("").length).toBeLessThan(64);

            yield* adapter.stopSession(threadId);
          }),
        ),
    );
  }
});
