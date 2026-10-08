/**
 * DrainableWorker - A queue-based worker that exposes a `drain()` effect.
 *
 * Wraps the common `Queue.unbounded` + `Effect.forever` pattern and adds
 * a signal that resolves when the queue is empty **and** the current item
 * has finished processing. This lets tests replace timing-sensitive
 * `Effect.sleep` calls with deterministic `drain()`.
 *
 * @module DrainableWorker
 */
import * as Scope from "effect/Scope";
import * as Effect from "effect/Effect";
import * as TxQueue from "effect/TxQueue";
import * as TxRef from "effect/TxRef";

export interface DrainableWorker<A> {
  /**
   * Enqueue a work item and track it for `drain()`.
   *
   * This wraps `Queue.offer` so drain state is updated atomically with the
   * enqueue path instead of inferring it from queue internals.
   */
  readonly enqueue: (item: A) => Effect.Effect<void>;

  /**
   * Resolves when the queue is empty and the worker is idle (not processing).
   */
  readonly drain: Effect.Effect<void>;
}

/**
 * Create a drainable worker that processes items from an unbounded queue.
 *
 * The worker is forked into the current scope and will be interrupted when
 * the scope closes. A finalizer shuts down the queue.
 *
 * @param process - The effect to run for each queued item.
 * @returns A `DrainableWorker` with `queue` and `drain`.
 */
export const makeDrainableWorker = <A, E, R>(
  process: (item: A) => Effect.Effect<void, E, R>,
): Effect.Effect<DrainableWorker<A>, never, Scope.Scope | R> =>
  Effect.gen(function* () {
    const queue = yield* Effect.acquireRelease(TxQueue.unbounded<A>(), TxQueue.shutdown);
    const outstanding = yield* TxRef.make(0);

    yield* TxQueue.take(queue).pipe(
      Effect.tap((a) =>
        Effect.ensuring(
          process(a),
          TxRef.update(outstanding, (n) => n - 1),
        ),
      ),
      Effect.forever,
      Effect.forkScoped,
    );

    const drain: DrainableWorker<A>["drain"] = TxRef.get(outstanding).pipe(
      Effect.tap((n) => (n > 0 ? Effect.txRetry : Effect.void)),
      Effect.tx,
    );

    const enqueue = (element: A): Effect.Effect<boolean, never, never> =>
      TxQueue.offer(queue, element).pipe(
        Effect.tap(() => TxRef.update(outstanding, (n) => n + 1)),
        Effect.tx,
      );

    return { enqueue, drain } satisfies DrainableWorker<A>;
  });

/** Processes different keys concurrently, preserving FIFO order within each key. */
export const makeKeyedDrainableWorker = <A, K, E, R>(options: {
  readonly key: (item: A) => K;
  readonly concurrency: number;
  readonly process: (item: A) => Effect.Effect<void, E, R>;
}): Effect.Effect<DrainableWorker<A>, never, Scope.Scope | R> =>
  Effect.gen(function* () {
    const queue = yield* Effect.acquireRelease(TxQueue.unbounded<K>(), TxQueue.shutdown);
    const pending = yield* TxRef.make(new Map<K, readonly A[]>());
    const outstanding = yield* TxRef.make(0);

    const processNext = TxQueue.take(queue).pipe(
      Effect.flatMap((key) =>
        Effect.gen(function* () {
          const item = yield* TxRef.modify(pending, (current) => {
            const items = current.get(key)!;
            const next = new Map(current);
            next.set(key, items.slice(1));
            return [items[0]!, next];
          }).pipe(Effect.tx);

          yield* options.process(item).pipe(
            Effect.ensuring(
              Effect.gen(function* () {
                yield* TxRef.update(outstanding, (count) => count - 1);
                const current = yield* TxRef.get(pending);
                if (current.get(key)!.length > 0) {
                  yield* TxQueue.offer(queue, key);
                } else {
                  const next = new Map(current);
                  next.delete(key);
                  yield* TxRef.set(pending, next);
                }
              }).pipe(Effect.tx),
            ),
          );
        }),
      ),
      Effect.forever,
    );
    for (let index = 0; index < options.concurrency; index++) {
      yield* Effect.forkScoped(processNext);
    }

    const enqueue = (item: A) =>
      Effect.gen(function* () {
        const key = options.key(item);
        const current = yield* TxRef.get(pending);
        const items = current.get(key);
        const next = new Map(current);
        next.set(key, items === undefined ? [item] : [...items, item]);
        yield* TxRef.set(pending, next);
        yield* TxRef.update(outstanding, (count) => count + 1);
        if (items === undefined) yield* TxQueue.offer(queue, key);
      }).pipe(Effect.tx);

    const drain = TxRef.get(outstanding).pipe(
      Effect.tap((count) => (count > 0 ? Effect.txRetry : Effect.void)),
      Effect.asVoid,
      Effect.tx,
    );
    return { enqueue, drain } satisfies DrainableWorker<A>;
  });
