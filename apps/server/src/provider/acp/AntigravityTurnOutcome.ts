// @effect-diagnostics nodeBuiltinImport:off -- node:sqlite and lstat read the native session log.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import type { OrchestrationV2ProviderFailure } from "@t3tools/contracts";
import { makeProviderFailure } from "@t3tools/provider-core/server/failure";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type * as EffectAcpSchema from "effect-acp/compat";

import { antigravityManagedPath, antigravityProfileRoot } from "./AntigravityProfilePaths.ts";
import { parseAntigravityTaskFinished } from "./AntigravityProtocol.ts";

// CORTEX_STEP_TYPE_ERROR_MESSAGE in the native trajectory.
const ERROR_STEP_TYPE = 17;
// A message another task or agent sent into the trajectory, such as a background task's end.
const MESSAGE_STEP_TYPE = 101;
// CORTEX_STEP_STATUS_DONE; a retry still in flight has another status.
const DONE_STEP_STATUS = 3;
// The harness error text leads the payload; a Go stack trace follows it.
const MAX_ERROR_PAYLOAD_BYTES = 16_384;
// The Go harness's rendering of a Google API error, as the agent's api_errors.py reads it.
// Status is a gRPC code, or an HTTP status line such as "502 Bad Gateway".
const API_ERROR = /Error (\d{3}), Message: (.+?), Status: ([A-Z_]+|\d{3}[A-Za-z ]*)/s;
const QUOTA_EXHAUSTED = /\breason:QUOTA_EXHAUSTED\b/;
const RESET_TIMESTAMP = /\bquotaResetTimeStamp:([^\s\]]+)/;
const RESET_DELAY = /\bquotaResetDelay:((?:\d+(?:\.\d+)?(?:ns|us|µs|μs|ms|h|m|s))+)(?=[\s\]])/;
// google.rpc.RetryInfo, which plain rate limits carry instead of a quota reset.
const RETRY_DELAY = /\bretryDelay:((?:\d+(?:\.\d+)?(?:ns|us|µs|μs|ms|h|m|s))+)(?=[\s\]])/;
const GO_DURATION_PART = /(\d+(?:\.\d+)?)(ns|us|µs|μs|ms|h|m|s)/g;
const GO_DURATION_UNIT_MS: Record<string, number> = {
  ns: 1e-6,
  us: 1e-3,
  µs: 1e-3,
  μs: 1e-3,
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
};
const NATIVE_SESSION_ID = /^[\w-]+$/;

interface LastStep {
  readonly type: number;
  readonly payload: Uint8Array | null;
}

class AntigravitySessionLogError extends Schema.TaggedError<AntigravitySessionLogError>()(
  "AntigravitySessionLogError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not read the Antigravity session log.";
  }
}

const sessionLogError = (cause: unknown) => new AntigravitySessionLogError({ cause });

const readSteps = <A>(file: string, read: (database: NodeSqlite.DatabaseSync) => A) =>
  Effect.try({
    try: () => {
      const database = new NodeSqlite.DatabaseSync(file, { readOnly: true });
      try {
        database.exec("PRAGMA busy_timeout = 100");
        const hasSteps =
          database
            .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'steps'")
            .get() !== undefined;
        return hasSteps ? read(database) : undefined;
      } finally {
        database.close();
      }
    },
    catch: sessionLogError,
  });

const lastStepIndex = (database: NodeSqlite.DatabaseSync) => {
  const index = database.prepare("SELECT max(idx) AS idx FROM steps").get()?.idx;
  return typeof index === "number" ? index : -1;
};

const lastStepAfter =
  (index: number, doneOrErrorOnly: boolean) =>
  (database: NodeSqlite.DatabaseSync): LastStep | undefined => {
    const row = database
      .prepare(
        `SELECT step_type AS type, substr(step_payload, 1, ?) AS payload
         FROM steps WHERE idx > ? ${doneOrErrorOnly ? "AND (step_type = ? OR status = ?)" : ""}
         ORDER BY idx DESC LIMIT 1`,
      )
      .get(
        MAX_ERROR_PAYLOAD_BYTES,
        index,
        ...(doneOrErrorOnly ? [ERROR_STEP_TYPE, DONE_STEP_STATUS] : []),
      );
    if (typeof row?.type !== "number") return undefined;
    return { type: row.type, payload: row.payload instanceof Uint8Array ? row.payload : null };
  };

function resetAtFrom(text: string, now: DateTime.Utc): string | undefined {
  // makeProviderFailure drops a timestamp that does not parse, so fall back to the delay.
  const timestamp = RESET_TIMESTAMP.exec(text)?.[1];
  if (timestamp !== undefined && Option.isSome(DateTime.make(timestamp))) return timestamp;
  const delay = RESET_DELAY.exec(text)?.[1] ?? RETRY_DELAY.exec(text)?.[1];
  if (delay === undefined) return undefined;
  let delayMs = 0;
  for (const [, amount, unit] of delay.matchAll(GO_DURATION_PART)) {
    delayMs += Number(amount) * (GO_DURATION_UNIT_MS[unit!] ?? 0);
  }
  return delayMs > 0 ? DateTime.formatIso(DateTime.add(now, { milliseconds: delayMs })) : undefined;
}

const errorStepText = (step: LastStep | undefined) =>
  step?.type === ERROR_STEP_TYPE
    ? new TextDecoder().decode(step.payload ?? new Uint8Array())
    : undefined;

const quotaFailure = (text: string, now: DateTime.Utc) =>
  makeProviderFailure({
    class: "usage_limit",
    message: "You have reached your Antigravity quota for this period.",
    code: API_ERROR.exec(text)?.[3] ?? "QUOTA_EXHAUSTED",
    retryable: true,
    resetAt: resetAtFrom(text, now) ?? null,
  });

function namedErrorFailure(
  text: string,
  now: DateTime.Utc,
): OrchestrationV2ProviderFailure | undefined {
  if (QUOTA_EXHAUSTED.test(text)) return quotaFailure(text, now);
  const apiError = API_ERROR.exec(text);
  if (apiError === null) return undefined;
  const [, httpStatus, message, status] = apiError;
  const rateLimited = httpStatus === "429" || status === "RESOURCE_EXHAUSTED";
  return makeProviderFailure({
    class: rateLimited ? "usage_limit" : "provider_error",
    message: message!.trim(),
    code: status?.trim() ?? null,
    retryable: rateLimited || Number(httpStatus) >= 500,
    resetAt: resetAtFrom(text, now) ?? null,
  });
}

function turnFailure(
  stopReason: EffectAcpSchema.StopReason,
  step: LastStep | undefined,
  now: DateTime.Utc,
): OrchestrationV2ProviderFailure | undefined {
  const errorText = errorStepText(step);
  // The agent maps only the SDK's QUOTA_EXHAUSTED stop reason to `refusal`.
  if (stopReason === "refusal") return quotaFailure(errorText ?? "", now);
  if (errorText === undefined) return undefined;
  return (
    namedErrorFailure(errorText, now) ??
    makeProviderFailure({
      class: "provider_error",
      message: "Antigravity stopped this turn because of an error.",
    })
  );
}

const conversationSegments = ["antigravity-acp", "conversations"];

/**
 * Antigravity reports an upstream API failure as a chat message and `end_turn`. Its
 * session log ends that turn with an error step, so the check reads only steps the
 * current prompt added, read-only, from this session's own unlinked database. Without
 * that evidence a typed `refusal` still fails the turn.
 */
export const watchAntigravityPromptOutcome = Effect.fn("AntigravityTurnOutcome.watch")(function* (
  profileDirectory: string,
  sessionId: string,
) {
  const typedOnly = {
    settled: (result: EffectAcpSchema.PromptResponse) =>
      DateTime.now.pipe(Effect.map((now) => turnFailure(result.stopReason, undefined, now))),
    stalled: Effect.undefined,
  };
  if (!NATIVE_SESSION_ID.test(sessionId)) return typedOnly;
  const segments = [...conversationSegments, `${sessionId}.db`];
  const before = yield* Effect.tryPromise({
    try: async () => {
      const root = await antigravityProfileRoot(profileDirectory);
      if (root === undefined) return undefined;
      if ((await antigravityManagedPath(root, conversationSegments, "directory")) === undefined) {
        return undefined;
      }
      const database = await antigravityManagedPath(root, segments, "file");
      // A path that exists but fails the proof is a link or other foreign entry.
      if (database === undefined) {
        const present = await NodeFSP.lstat(NodePath.join(root, ...segments)).then(
          () => true,
          () => false,
        );
        return present ? undefined : { root, identity: undefined, startIndex: -1 };
      }
      return { root, identity: database.info, startIndex: undefined };
    },
    catch: sessionLogError,
  }).pipe(Effect.orElseSucceed(() => undefined));
  if (before === undefined) {
    yield* Effect.logWarning("The Antigravity session log is not this session's own file.");
    return typedOnly;
  }
  const startIndex =
    before.startIndex ??
    (yield* readSteps(NodePath.join(before.root, ...segments), lastStepIndex).pipe(
      Effect.map((index) => index ?? -1),
      Effect.orElseSucceed(() => undefined),
    ));
  if (startIndex === undefined) {
    yield* Effect.logWarning("Could not read the Antigravity session log before the prompt.");
    return typedOnly;
  }
  // The same file as before the prompt, or one this prompt created, still unlinked.
  const readStepAfterStart = (doneOrErrorOnly: boolean) =>
    Effect.tryPromise({
      try: () => antigravityManagedPath(before.root, segments, "file"),
      catch: sessionLogError,
    }).pipe(
      Effect.orElseSucceed(() => undefined),
      Effect.flatMap((after) =>
        after !== undefined &&
        (before.identity === undefined ||
          (after.info.dev === before.identity.dev && after.info.ino === before.identity.ino))
          ? readSteps(after.path, lastStepAfter(startIndex, doneOrErrorOnly)).pipe(
              Effect.tapError(() =>
                Effect.logWarning("Could not read the Antigravity session log after the prompt."),
              ),
              Effect.orElseSucceed(() => undefined),
            )
          : Effect.undefined,
      ),
    );
  return {
    settled: Effect.fn("AntigravityTurnOutcome.check")(function* (
      result: EffectAcpSchema.PromptResponse,
    ) {
      const step = yield* readStepAfterStart(false);
      return turnFailure(result.stopReason, step, yield* DateTime.now);
    }),
    // Antigravity retries a failed model request without updates; name an error no finished step followed.
    stalled: Effect.gen(function* () {
      const text = errorStepText(yield* readStepAfterStart(true));
      return text === undefined ? undefined : namedErrorFailure(text, yield* DateTime.now);
    }).pipe(Effect.withSpan("AntigravityTurnOutcome.stalled")),
  };
});

/**
 * This session's background tasks that end from now on, each once. Antigravity logs an end
 * as a message step and resumes the model, but holds its updates and requests until the
 * next prompt opens. Reads follow writes to the session log; nothing polls.
 */
export const watchAntigravityBackgroundTaskEnds = (
  profileDirectory: string,
  sessionId: string,
): Stream.Stream<string, never, FileSystem.FileSystem> =>
  Stream.unwrap(
    Effect.gen(function* () {
      if (!NATIVE_SESSION_ID.test(sessionId)) return Stream.empty;
      const fileSystem = yield* FileSystem.FileSystem;
      const fileName = `${sessionId}.db`;
      const segments = [...conversationSegments, fileName];
      const located = yield* Effect.tryPromise({
        try: async () => {
          const root = await antigravityProfileRoot(profileDirectory);
          if (root === undefined) return undefined;
          const directory = await antigravityManagedPath(root, conversationSegments, "directory");
          return directory === undefined ? undefined : { root, directory: directory.path };
        },
        catch: sessionLogError,
      }).pipe(Effect.orElseSucceed(() => undefined));
      if (located === undefined) return Stream.empty;
      const withLog = <A>(read: (database: NodeSqlite.DatabaseSync) => A) =>
        Effect.tryPromise({
          try: () => antigravityManagedPath(located.root, segments, "file"),
          catch: sessionLogError,
        }).pipe(
          Effect.flatMap((file) =>
            file === undefined ? Effect.undefined : readSteps(file.path, read),
          ),
        );
      let cursor =
        (yield* withLog(lastStepIndex).pipe(Effect.orElseSucceed(() => undefined))) ?? -1;
      const ended = new Set<string>();
      const readEnds = withLog((database) =>
        database
          .prepare(
            "SELECT idx, step_payload AS payload FROM steps WHERE idx > ? AND step_type = ? ORDER BY idx",
          )
          .all(cursor, MESSAGE_STEP_TYPE),
      ).pipe(
        Effect.map((rows) =>
          (rows ?? []).flatMap((row) => {
            if (typeof row.idx === "number") cursor = Math.max(cursor, row.idx);
            if (!(row.payload instanceof Uint8Array)) return [];
            const taskId = parseAntigravityTaskFinished(
              new TextDecoder().decode(row.payload),
              sessionId,
            );
            if (taskId === undefined) return [];
            if (ended.has(taskId)) return [];
            ended.add(taskId);
            return [taskId];
          }),
        ),
        Effect.tapError(() => Effect.logWarning("Could not read the Antigravity session log.")),
        Effect.orElseSucceed((): ReadonlyArray<string> => []),
      );
      // Rows written between the baseline read and the watch registering get one read.
      const ready = yield* Queue.sliding<void>(1);
      return Stream.merge(
        fileSystem
          .watch(located.directory, { onReady: () => Queue.offerUnsafe(ready, undefined) })
          .pipe(
            Stream.filter((event) => NodePath.basename(event.path).startsWith(fileName)),
            Stream.as(undefined),
          ),
        Stream.fromQueue(ready),
      ).pipe(
        // One read after a burst of writes sees every new row.
        Stream.buffer({ capacity: 1, strategy: "sliding" }),
        Stream.mapEffect(() => readEnds),
        Stream.flattenIterable,
      );
    }),
  ).pipe(Stream.ignore({ log: true }));
