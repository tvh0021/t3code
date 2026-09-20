/**
 * ZedAdapter — Zed ACP server adapter.
 *
 * @module ZedAdapter
 */

import {
  ApprovalRequestId,
  type ZedSettings,
  EventId,
  type ProviderApprovalDecision,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderUserInputAnswers,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeRequestId,
  type ThreadTokenUsageSnapshot,
  type ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import { mapAcpToAdapterError, selectAcpPermissionOptionId } from "../acp/AcpAdapterSupport.ts";
import type * as AcpSessionRuntime from "../acp/AcpSessionRuntime.ts";
import {
  makeAcpAssistantItemEvent,
  makeAcpContentDeltaEvent,
  makeAcpPlanUpdatedEvent,
  makeAcpRequestOpenedEvent,
  makeAcpRequestResolvedEvent,
  makeAcpToolCallEvent,
} from "../acp/AcpCoreRuntimeEvents.ts";
import { parsePermissionRequest } from "../acp/AcpRuntimeModel.ts";
import { makeZedAcpRuntime } from "../acp/ZedAcpSupport.ts";
import { type ZedAdapterShape } from "../Services/ZedAdapter.ts";

const PROVIDER = ProviderDriverKind.make("zed");
const ZED_RESUME_VERSION = 1 as const;

interface PendingApproval {
  readonly decision: Deferred.Deferred<ProviderApprovalDecision>;
}

interface PendingUserInput {
  readonly answers: Deferred.Deferred<ProviderUserInputAnswers>;
}

interface TurnRecord {
  readonly id: TurnId;
  readonly items: Array<{ prompt: unknown; result: unknown }>;
}

interface ZedSessionContext {
  readonly threadId: ThreadId;
  readonly cwd: string;
  readonly nativeSessionId: string;
  readonly acp: AcpSessionRuntime.AcpSessionRuntime["Service"];
  readonly scope: Scope.Closeable;
  readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;
  readonly pendingUserInputs: Map<ApprovalRequestId, PendingUserInput>;
  readonly turns: TurnRecord[];
  session: ProviderSession;
  activeTurnId: TurnId | undefined;
  stopped: boolean;
}

export interface ZedAdapterLiveOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly instanceId?: ProviderInstanceId;
  readonly resolveSettings?: Effect.Effect<ZedSettings>;
}

function extractQuestionsFromElicitation(
  request: EffectAcpSchema.ElicitationRequest,
): ReadonlyArray<{
  readonly id: string;
  readonly header: string;
  readonly question: string;
  readonly options: ReadonlyArray<{ readonly label: string; readonly description: string }>;
}> {
  if (request.mode === "form") {
    const properties = request.requestedSchema.properties ?? {};
    const entries = Object.entries(properties);
    if (entries.length > 0) {
      return entries.map(([id, prop]) => {
        const title = prop.title ?? id;
        const description = prop.description ?? request.message;
        const options =
          prop.type === "string" && prop.enum
            ? prop.enum.map((label) => ({ label, description: label }))
            : [];
        return {
          id,
          header: title,
          question: description,
          options,
        };
      });
    }
  }
  return [
    {
      id: "input",
      header: "Input Required",
      question: request.message,
      options: [],
    },
  ];
}

function toAcpElicitationContent(
  answers: ProviderUserInputAnswers,
): Readonly<Record<string, EffectAcpSchema.ElicitationContentValue>> {
  return Object.fromEntries(
    Object.entries(answers).flatMap(([key, value]) => {
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        (Array.isArray(value) && value.every((item) => typeof item === "string"))
      ) {
        return [[key, value]];
      }
      return [];
    }),
  );
}

function settlePendingApprovalsAsCancelled(
  pendingApprovals: ReadonlyMap<ApprovalRequestId, PendingApproval>,
): Effect.Effect<void> {
  const pendingEntries = Array.from(pendingApprovals.values());
  return Effect.forEach(pendingEntries, (pending) => Deferred.succeed(pending.decision, "cancel"), {
    discard: true,
  });
}

function settlePendingUserInputsAsEmptyAnswers(
  pendingUserInputs: ReadonlyMap<ApprovalRequestId, PendingUserInput>,
): Effect.Effect<void> {
  const pendingEntries = Array.from(pendingUserInputs.values());
  return Effect.forEach(pendingEntries, (pending) => Deferred.succeed(pending.answers, {}), {
    discard: true,
  });
}

export function makeZedAdapter(
  zedSettings: ZedSettings,
  options?: ZedAdapterLiveOptions,
): Effect.Effect<
  ZedAdapterShape,
  never,
  ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto | Scope.Scope
> {
  return Effect.gen(function* () {
    const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const crypto = yield* Crypto.Crypto;
    const runtimeEventPubSub = yield* PubSub.unbounded<ProviderRuntimeEvent>();
    const sessions = new Map<ThreadId, ZedSessionContext>();
    const threadLocksRef = yield* SynchronizedRef.make(new Map<ThreadId, Semaphore.Semaphore>());
    const getThreadSemaphore = (threadId: ThreadId) =>
      SynchronizedRef.modifyEffect(threadLocksRef, (locks) => {
        const existing: Option.Option<Semaphore.Semaphore> = Option.fromNullishOr(
          locks.get(threadId),
        );
        if (Option.isSome(existing)) {
          return Effect.succeed([existing.value, locks] as const);
        }
        return Effect.map(
          Semaphore.make(1),
          (semaphore) => [semaphore, new Map(locks).set(threadId, semaphore)] as const,
        );
      });

    const withThreadLock = <A, E, R>(
      threadId: ThreadId,
      effect: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E, R> =>
      Effect.flatMap(getThreadSemaphore(threadId), (semaphore) => semaphore.withPermit(effect));

    const offerRuntimeEvent = (event: ProviderRuntimeEvent): Effect.Effect<void> =>
      PubSub.publish(runtimeEventPubSub, event).pipe(Effect.asVoid);

    const randomUUIDv4 = crypto.randomUUIDv4.pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "crypto/randomUUIDv4",
            detail: "Failed to generate Zed runtime identifier.",
            cause,
          }),
      ),
    );

    const mapAcpCallbackFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.mapError((cause) =>
          EffectAcpErrors.AcpRequestError.internalError(
            "Failed to process a Zed ACP callback.",
            undefined,
            { cause },
          ),
        ),
      );

    const makeEventStamp = () =>
      Effect.gen(function* () {
        const eventId = EventId.make(yield* randomUUIDv4);
        const createdAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
        return { eventId, createdAt };
      });

    const requireSession = (
      threadId: ThreadId,
    ): Effect.Effect<ZedSessionContext, ProviderAdapterSessionNotFoundError> =>
      Effect.gen(function* () {
        const ctx = sessions.get(threadId);
        if (!ctx || ctx.stopped) {
          return yield* new ProviderAdapterSessionNotFoundError({
            provider: PROVIDER,
            threadId,
          });
        }
        return ctx;
      });

    const stopSessionInternal = (ctx: ZedSessionContext): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (ctx.stopped) return;
        ctx.stopped = true;
        yield* settlePendingApprovalsAsCancelled(ctx.pendingApprovals);
        yield* settlePendingUserInputsAsEmptyAnswers(ctx.pendingUserInputs);
        yield* Effect.ignore(
          ctx.acp.cancel.pipe(
            Effect.mapError((error) =>
              mapAcpToAdapterError(PROVIDER, ctx.threadId, "session/cancel", error),
            ),
          ),
        );
        yield* Scope.close(ctx.scope, Exit.void);
        sessions.delete(ctx.threadId);
      });

    const startSession: ZedAdapterShape["startSession"] = (input) =>
      withThreadLock(
        input.threadId,
        Effect.gen(function* () {
          const existing = sessions.get(input.threadId);
          if (existing && !existing.stopped) {
            yield* stopSessionInternal(existing);
          }

          const currentSettings = options?.resolveSettings
            ? yield* options.resolveSettings
            : zedSettings;
          const cwd = input.cwd ?? process.cwd();
          const selectedModel = input.modelSelection?.model;
          const effectiveModel =
            selectedModel && selectedModel !== "default"
              ? selectedModel
              : currentSettings.model.trim();
          const effectiveSettings =
            effectiveModel.length > 0
              ? { ...currentSettings, model: effectiveModel }
              : currentSettings;

          const sessionScope = yield* Scope.make();
          const pendingApprovals = new Map<ApprovalRequestId, PendingApproval>();
          const pendingUserInputs = new Map<ApprovalRequestId, PendingUserInput>();

          let ctxRef: ZedSessionContext | undefined;

          const acp = yield* makeZedAcpRuntime({
            zedSettings: effectiveSettings,
            childProcessSpawner,
            cwd,
            ...(options?.environment ? { environment: options.environment } : {}),
          }).pipe(
            Effect.provideService(Crypto.Crypto, crypto),
            Scope.provide(sessionScope),
            Effect.mapError((error) =>
              mapAcpToAdapterError(PROVIDER, input.threadId, "session/new", error),
            ),
          );

          yield* acp.handleRequestPermission((params) =>
            mapAcpCallbackFailure(
              Effect.gen(function* () {
                const permissionRequest = parsePermissionRequest(params);
                const requestId = ApprovalRequestId.make(yield* randomUUIDv4);
                const runtimeRequestId = RuntimeRequestId.make(requestId);
                const decision = yield* Deferred.make<ProviderApprovalDecision>();
                pendingApprovals.set(requestId, { decision });

                yield* offerRuntimeEvent(
                  makeAcpRequestOpenedEvent({
                    stamp: yield* makeEventStamp(),
                    provider: PROVIDER,
                    threadId: input.threadId,
                    turnId: ctxRef?.activeTurnId,
                    requestId: runtimeRequestId,
                    permissionRequest,
                    detail: permissionRequest.detail ?? "Zed requests permission",
                    args: params,
                    source: "acp.jsonrpc",
                    method: "session/request_permission",
                    rawPayload: params,
                  }),
                );

                const resolved = yield* Deferred.await(decision);
                pendingApprovals.delete(requestId);

                const optionId = selectAcpPermissionOptionId(params, resolved);
                if (resolved !== "cancel" && optionId === undefined) {
                  return yield* EffectAcpErrors.AcpRequestError.invalidParams(
                    `Zed did not provide a permission option for decision '${resolved}'.`,
                  );
                }

                yield* offerRuntimeEvent(
                  makeAcpRequestResolvedEvent({
                    stamp: yield* makeEventStamp(),
                    provider: PROVIDER,
                    threadId: input.threadId,
                    turnId: ctxRef?.activeTurnId,
                    requestId: runtimeRequestId,
                    permissionRequest,
                    decision: resolved,
                  }),
                );

                return {
                  outcome:
                    resolved === "cancel"
                      ? ({ outcome: "cancelled" } as const)
                      : {
                          outcome: "selected" as const,
                          optionId: optionId!,
                        },
                };
              }),
            ),
          );

          yield* acp.handleElicitation((params) =>
            mapAcpCallbackFailure(
              Effect.gen(function* () {
                const requestId = ApprovalRequestId.make(yield* randomUUIDv4);
                const runtimeRequestId = RuntimeRequestId.make(requestId);
                const answers = yield* Deferred.make<ProviderUserInputAnswers>();
                pendingUserInputs.set(requestId, { answers });

                const questions = extractQuestionsFromElicitation(params);
                yield* offerRuntimeEvent({
                  type: "user-input.requested",
                  ...(yield* makeEventStamp()),
                  provider: PROVIDER,
                  threadId: input.threadId,
                  turnId: ctxRef?.activeTurnId,
                  requestId: runtimeRequestId,
                  payload: { questions },
                  raw: {
                    source: "acp.jsonrpc",
                    method: "session/elicitation",
                    payload: params,
                  },
                });

                const resolved = yield* Deferred.await(answers);
                pendingUserInputs.delete(requestId);

                yield* offerRuntimeEvent({
                  type: "user-input.resolved",
                  ...(yield* makeEventStamp()),
                  provider: PROVIDER,
                  threadId: input.threadId,
                  turnId: ctxRef?.activeTurnId,
                  requestId: runtimeRequestId,
                  payload: { answers: resolved },
                });

                const content = toAcpElicitationContent(resolved);
                if (Object.keys(content).length === 0) {
                  const response: EffectAcpSchema.ElicitationResponse = {
                    action: { action: "cancel" },
                  };
                  return response;
                }
                const response: EffectAcpSchema.ElicitationResponse = {
                  action: { action: "accept", content },
                };
                return response;
              }),
            ),
          );

          const startResult = yield* acp
            .start()
            .pipe(
              Effect.mapError((error) =>
                mapAcpToAdapterError(PROVIDER, input.threadId, "session/new", error),
              ),
            );

          const createdAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
          const session: ProviderSession = {
            provider: PROVIDER,
            providerInstanceId: options?.instanceId ?? ProviderInstanceId.make("zed"),
            threadId: input.threadId,
            cwd,
            status: "ready",
            runtimeMode: input.runtimeMode,
            model: effectiveModel || "default",
            resumeCursor: {
              schemaVersion: ZED_RESUME_VERSION,
              sessionId: startResult.sessionId,
            },
            createdAt,
            updatedAt: createdAt,
          };

          const ctx: ZedSessionContext = {
            threadId: input.threadId,
            cwd,
            nativeSessionId: startResult.sessionId,
            acp,
            scope: sessionScope,
            pendingApprovals,
            pendingUserInputs,
            turns: [],
            session,
            activeTurnId: undefined,
            stopped: false,
          };
          ctxRef = ctx;
          sessions.set(input.threadId, ctx);

          yield* Stream.runDrain(
            Stream.mapEffect(acp.getEvents(), (event) =>
              Effect.gen(function* () {
                if (ctx.stopped) return;
                switch (event._tag) {
                  case "EventStreamBarrier":
                    yield* Deferred.succeed(event.acknowledge, undefined);
                    return;
                  case "AssistantItemStarted":
                  case "AssistantItemCompleted":
                    yield* offerRuntimeEvent(
                      makeAcpAssistantItemEvent({
                        stamp: yield* makeEventStamp(),
                        provider: PROVIDER,
                        threadId: input.threadId,
                        turnId: ctx.activeTurnId,
                        itemId: event.itemId,
                        lifecycle:
                          event._tag === "AssistantItemStarted" ? "item.started" : "item.completed",
                      }),
                    );
                    return;
                  case "ContentDelta":
                  case "ThoughtDelta":
                    yield* offerRuntimeEvent(
                      makeAcpContentDeltaEvent({
                        stamp: yield* makeEventStamp(),
                        provider: PROVIDER,
                        threadId: input.threadId,
                        turnId: ctx.activeTurnId,
                        ...(event._tag === "ContentDelta" && event.itemId
                          ? { itemId: event.itemId }
                          : {}),
                        ...(event._tag === "ThoughtDelta" && event.messageId
                          ? { itemId: event.messageId }
                          : {}),
                        ...(event._tag === "ThoughtDelta" ? { streamKind: "reasoning_text" } : {}),
                        text: event.text,
                        rawPayload: event.rawPayload,
                      }),
                    );
                    return;
                  case "ToolCallUpdated":
                    yield* offerRuntimeEvent(
                      makeAcpToolCallEvent({
                        stamp: yield* makeEventStamp(),
                        provider: PROVIDER,
                        threadId: input.threadId,
                        turnId: ctx.activeTurnId,
                        toolCall: event.toolCall,
                        rawPayload: event.rawPayload,
                      }),
                    );
                    return;
                  case "PlanUpdated":
                    yield* offerRuntimeEvent(
                      makeAcpPlanUpdatedEvent({
                        stamp: yield* makeEventStamp(),
                        provider: PROVIDER,
                        threadId: input.threadId,
                        turnId: ctx.activeTurnId,
                        payload: event.payload,
                        source: "acp.jsonrpc",
                        method: "session/update",
                        rawPayload: event.rawPayload,
                      }),
                    );
                    return;
                  case "UsageUpdated": {
                    if (!Number.isInteger(event.used) || event.used < 0) {
                      return;
                    }
                    const maxTokens =
                      Number.isInteger(event.size) && event.size > 0 ? event.size : undefined;
                    const usage: ThreadTokenUsageSnapshot = {
                      usedTokens: event.used,
                      ...(maxTokens !== undefined ? { maxTokens } : {}),
                      compactsAutomatically: true,
                    };
                    const stamp = yield* makeEventStamp();
                    yield* offerRuntimeEvent({
                      type: "thread.token-usage.updated",
                      ...stamp,
                      provider: PROVIDER,
                      threadId: ctx.threadId,
                      ...(ctx.activeTurnId ? { turnId: ctx.activeTurnId } : {}),
                      payload: { usage },
                      raw: {
                        source: "acp.jsonrpc",
                        method: "session/update",
                        payload: event.rawPayload,
                      },
                    });
                    return;
                  }
                  default:
                    return;
                }
              }),
            ),
          ).pipe(Effect.forkIn(sessionScope));

          return session;
        }),
      );

    const sendTurn: ZedAdapterShape["sendTurn"] = (input) =>
      withThreadLock(
        input.threadId,
        Effect.gen(function* () {
          const ctx = yield* requireSession(input.threadId);
          const rawPrompt = input.input?.trim() ?? "";
          if (rawPrompt.length === 0) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "sendTurn",
              issue: "Turn requires non-empty text.",
            });
          }

          const turnId = TurnId.make(yield* randomUUIDv4);
          ctx.activeTurnId = turnId;

          yield* offerRuntimeEvent({
            type: "turn.started",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId: input.threadId,
            turnId,
            payload: { model: ctx.session.model },
          });

          const compactMatch = rawPrompt.match(/^\/(?:compact|compress)(?:\s+([\s\S]*))?$/);
          const skillMatch = rawPrompt.match(/^\/skill\s+([^\s]+)(?:\s+([\s\S]*))?$/);

          let promptResult: EffectAcpSchema.PromptResponse;

          if (compactMatch) {
            const prompt = compactMatch[1] ?? "";
            const response = yield* ctx.acp
              .request("zed/invoke_skill", {
                sessionId: ctx.nativeSessionId,
                skillName: "compact",
                prompt,
              })
              .pipe(
                Effect.mapError((error) =>
                  mapAcpToAdapterError(PROVIDER, input.threadId, "zed/invoke_skill", error),
                ),
              );
            promptResult =
              response && typeof response === "object" && "stopReason" in response
                ? (response as EffectAcpSchema.PromptResponse)
                : { stopReason: "end_turn" };
          } else if (skillMatch) {
            const skillName = skillMatch[1];
            const prompt = skillMatch[2] ?? "";
            const response = yield* ctx.acp
              .request("zed/invoke_skill", {
                sessionId: ctx.nativeSessionId,
                skillName,
                prompt,
              })
              .pipe(
                Effect.mapError((error) =>
                  mapAcpToAdapterError(PROVIDER, input.threadId, "zed/invoke_skill", error),
                ),
              );
            promptResult =
              response && typeof response === "object" && "stopReason" in response
                ? (response as EffectAcpSchema.PromptResponse)
                : { stopReason: "end_turn" };
          } else {
            promptResult = yield* ctx.acp
              .prompt({
                prompt: [{ type: "text", text: rawPrompt }],
              })
              .pipe(
                Effect.mapError((error) =>
                  mapAcpToAdapterError(PROVIDER, input.threadId, "session/prompt", error),
                ),
              );
          }

          const turnRecord = ctx.turns.find((t) => t.id === turnId);
          if (turnRecord) {
            turnRecord.items.push({ prompt: rawPrompt, result: promptResult });
          } else {
            ctx.turns.push({ id: turnId, items: [{ prompt: rawPrompt, result: promptResult }] });
          }

          yield* offerRuntimeEvent({
            type: "turn.completed",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId: input.threadId,
            turnId,
            payload: {
              state: promptResult.stopReason === "cancelled" ? "cancelled" : "completed",
              stopReason: promptResult.stopReason ?? null,
            },
          });

          return {
            threadId: input.threadId,
            turnId,
            ...(ctx.session.resumeCursor !== undefined
              ? { resumeCursor: ctx.session.resumeCursor }
              : {}),
          };
        }),
      );

    const interruptTurn: ZedAdapterShape["interruptTurn"] = (threadId) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        yield* settlePendingApprovalsAsCancelled(ctx.pendingApprovals);
        yield* settlePendingUserInputsAsEmptyAnswers(ctx.pendingUserInputs);
        yield* Effect.ignore(
          ctx.acp.cancel.pipe(
            Effect.mapError((error) =>
              mapAcpToAdapterError(PROVIDER, threadId, "session/cancel", error),
            ),
          ),
        );
      });

    const respondToRequest: ZedAdapterShape["respondToRequest"] = (threadId, requestId, decision) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        const pending = ctx.pendingApprovals.get(requestId);
        if (!pending) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "session/request_permission",
            detail: `Unknown pending approval request: ${requestId}`,
          });
        }
        yield* Deferred.succeed(pending.decision, decision);
      });

    const respondToUserInput: ZedAdapterShape["respondToUserInput"] = (
      threadId,
      requestId,
      answers,
    ) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        const pending = ctx.pendingUserInputs.get(requestId);
        if (!pending) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "session/elicitation",
            detail: `Unknown pending user-input request: ${requestId}`,
          });
        }
        yield* Deferred.succeed(pending.answers, answers);
      });

    const readThread: ZedAdapterShape["readThread"] = (threadId) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        return { threadId, turns: ctx.turns };
      });

    const rollbackThread: ZedAdapterShape["rollbackThread"] = (threadId, numTurns) =>
      Effect.gen(function* () {
        yield* requireSession(threadId);
        if (!Number.isInteger(numTurns) || numTurns < 1) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "rollbackThread",
            issue: "numTurns must be an integer >= 1.",
          });
        }
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "thread/rollback",
          detail: "Zed ACP sessions do not support provider-side rollback.",
        });
      });

    const stopSession: ZedAdapterShape["stopSession"] = (threadId) =>
      withThreadLock(
        threadId,
        Effect.gen(function* () {
          const ctx = yield* requireSession(threadId);
          yield* stopSessionInternal(ctx);
        }),
      );

    const listSessions: ZedAdapterShape["listSessions"] = () =>
      Effect.sync(() => Array.from(sessions.values(), (c) => ({ ...c.session })));

    const hasSession: ZedAdapterShape["hasSession"] = (threadId) =>
      Effect.sync(() => {
        const c = sessions.get(threadId);
        return c !== undefined && !c.stopped;
      });

    const stopAll: ZedAdapterShape["stopAll"] = () =>
      Effect.forEach(sessions.values(), stopSessionInternal, { discard: true });

    yield* Effect.addFinalizer(() =>
      Effect.forEach(sessions.values(), stopSessionInternal, { discard: true }).pipe(
        Effect.tap(() => PubSub.shutdown(runtimeEventPubSub)),
      ),
    );

    const streamEvents = Stream.fromPubSub(runtimeEventPubSub);

    return {
      provider: PROVIDER,
      capabilities: {
        sessionModelSwitch: "unsupported",
        supportsConversationRollback: false,
      },
      compaction: {
        type: "slash-command",
        command: "/compact",
      },
      startSession,
      sendTurn,
      interruptTurn,
      readThread,
      rollbackThread,
      respondToRequest,
      respondToUserInput,
      stopSession,
      listSessions,
      hasSession,
      stopAll,
      streamEvents,
    } satisfies ZedAdapterShape;
  });
}
