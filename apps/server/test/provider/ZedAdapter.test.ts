import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "vite-plus/test";

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
const REAL_ZED_MODELS = ["zed.dev/claude-sonnet-5", "zed.dev/gpt-5.6-luna"] as const;

function runWithServices<A, E>(effect: Effect.Effect<A, E, any>): Promise<A> {
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "t3code-zed-adapter-test-",
        }).pipe(Layer.provideMerge(NodeServices.layer)),
      ),
      Effect.scoped,
    ),
  );
}

async function makeFakeZedCli(options?: {
  readonly onRequestPermission?: boolean;
  readonly onElicitation?: boolean;
  readonly onMessageIdStreaming?: boolean;
  readonly onUsageUpdate?: boolean;
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
      options?.onMessageIdStreaming
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
  it("builds disabled snapshot when enabled is false", async () => {
    const snapshot = await runWithServices(
      buildInitialZedProviderSnapshot(decodeZedSettings({ enabled: false })),
    );
    expect(snapshot.enabled).toBe(false);
    expect(snapshot.installed).toBe(false);
  });

  it("builds initial ready snapshot when enabled is true", async () => {
    const snapshot = await runWithServices(
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
  });

  it("reports uninstalled when binary is not found", async () => {
    const status = await runWithServices(
      checkZedProviderStatus(
        decodeZedSettings({ enabled: true, binaryPath: "nonexistent-zed-binary" }),
      ),
    );
    expect(status.installed).toBe(false);
  });

  if (hasRealZed) {
    it("reports installed and ready when pointing to real binary", async () => {
      const status = await runWithServices(
        checkZedProviderStatus(decodeZedSettings({ enabled: true, binaryPath: REAL_ZED_BIN })),
      );
      expect(status.installed).toBe(true);
      expect(status.status).toBe("ready");
    });
  }
});

describe("ZedAdapter Lifecycle and Turn Streaming", () => {
  it("starts session and sends turn with content deltas", async () => {
    await runWithServices(
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
    );
  });

  it("publishes Zed context usage as a token update, without faking account spend", async () => {
    await runWithServices(
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
    );
  });

  it("keeps ACP message chunks together across tool updates", async () => {
    await runWithServices(
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
    );
  });

  it("routes permission requests through T3 approval flow", async () => {
    await runWithServices(
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
    );
  });

  it("routes elicitation requests through T3 user-input flow", async () => {
    await runWithServices(
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
    );
  });

  it("dispatches /compact and /skill to zed/invoke_skill", async () => {
    await runWithServices(
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
    );
  });

  it("rejects rollback without altering stored thread history", async () => {
    await runWithServices(
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
    );
  });

  if (hasRealZed) {
    it("executes end-to-end against real zed-acp-server binary", async () => {
      await runWithServices(
        Effect.gen(function* () {
          for (const [index, model] of REAL_ZED_MODELS.entries()) {
            const threadId = ThreadId.make(`zed-adapter-real-bin-${index + 1}`);
            const adapter = yield* makeZedAdapter(decodeZedSettings({ binaryPath: REAL_ZED_BIN }));
            const contentReceived = yield* Deferred.make<void>();
            const turnCompleted = yield* Deferred.make<void>();
            yield* Stream.runForEach(adapter.streamEvents, (event) =>
              Effect.gen(function* () {
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
              modelSelection: {
                instanceId: ProviderInstanceId.make("zed"),
                model,
              },
            });

            expect(session.provider).toBe("zed");
            expect(session.status).toBe("ready");

            const turn = yield* adapter.sendTurn({
              threadId,
              input: "ping real zed agent",
            });

            expect(turn.threadId).toBe(threadId);
            yield* Deferred.await(turnCompleted).pipe(Effect.timeout("20 seconds"));
            yield* Deferred.await(contentReceived).pipe(Effect.timeout("20 seconds"));

            const skillTurn = yield* adapter.sendTurn({
              threadId,
              input: "/compact",
            });

            expect(skillTurn.threadId).toBe(threadId);
            yield* adapter.stopSession(threadId);
          }
        }),
      );
    });
  }
});
