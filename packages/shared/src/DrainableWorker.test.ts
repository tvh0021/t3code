import { it } from "@effect/vitest";
import { describe, expect } from "vite-plus/test";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";

import { makeDrainableWorker, makeKeyedDrainableWorker } from "./DrainableWorker.ts";

describe("makeKeyedDrainableWorker", () => {
  it.effect("bounds concurrent keys, preserves each key's order, and drains queued work", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Queue.unbounded<string>();
        const releaseA = yield* Deferred.make<void>();
        const releaseB = yield* Deferred.make<void>();
        const releaseC = yield* Deferred.make<void>();
        const releaseD = yield* Deferred.make<void>();
        const releaseE = yield* Deferred.make<void>();
        const releases = new Map([
          ["a1", releaseA],
          ["b1", releaseB],
          ["c1", releaseC],
          ["d1", releaseD],
          ["e1", releaseE],
        ]);
        const order: string[] = [];
        let active = 0;
        let maxActive = 0;
        const worker = yield* makeKeyedDrainableWorker({
          key: (id: string) => id[0],
          concurrency: 4,
          process: (id) =>
            Effect.gen(function* () {
              active += 1;
              maxActive = Math.max(active, maxActive);
              order.push(id);
              yield* Queue.offer(started, id);
              const release = releases.get(id);
              if (release) yield* Deferred.await(release);
              active -= 1;
            }),
        });
        for (const id of ["a1", "a2", "b1", "c1", "d1", "e1"]) {
          yield* worker.enqueue(id);
        }
        const first = [];
        for (let index = 0; index < 4; index++) first.push(yield* Queue.take(started));
        expect(first.sort()).toEqual(["a1", "b1", "c1", "d1"]);
        expect(order).not.toContain("a2");
        expect(order).not.toContain("e1");
        const draining = yield* Effect.forkChild(worker.drain);

        yield* Deferred.succeed(releaseB, undefined);
        expect(yield* Queue.take(started)).toBe("e1");
        expect(order).not.toContain("a2");
        expect(draining.pollUnsafe()).toBeUndefined();
        yield* worker.enqueue("a3");
        for (const release of [releaseA, releaseC, releaseD, releaseE]) {
          yield* Deferred.succeed(release, undefined);
        }
        yield* Fiber.join(draining);
        expect(order.filter((id) => id.startsWith("a"))).toEqual(["a1", "a2", "a3"]);
        expect(maxActive).toBe(4);
        expect(active).toBe(0);
      }),
    ),
  );
});

describe("makeDrainableWorker", () => {
  it.live("waits for work enqueued during active processing before draining", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const processed: string[] = [];
        const firstStarted = yield* Deferred.make<void>();
        const releaseFirst = yield* Deferred.make<void>();
        const secondStarted = yield* Deferred.make<void>();
        const releaseSecond = yield* Deferred.make<void>();

        const worker = yield* makeDrainableWorker((item: string) =>
          Effect.gen(function* () {
            if (item === "first") {
              yield* Deferred.succeed(firstStarted, undefined).pipe(Effect.orDie);
              yield* Deferred.await(releaseFirst);
            }

            if (item === "second") {
              yield* Deferred.succeed(secondStarted, undefined).pipe(Effect.orDie);
              yield* Deferred.await(releaseSecond);
            }

            processed.push(item);
          }),
        );

        yield* worker.enqueue("first");
        yield* Deferred.await(firstStarted);

        const drained = yield* Deferred.make<void>();
        yield* Effect.forkChild(
          worker.drain.pipe(
            Effect.tap(() => Deferred.succeed(drained, undefined).pipe(Effect.orDie)),
          ),
        );

        yield* worker.enqueue("second");
        yield* Deferred.succeed(releaseFirst, undefined);
        yield* Deferred.await(secondStarted);

        expect(yield* Deferred.isDone(drained)).toBe(false);

        yield* Deferred.succeed(releaseSecond, undefined);
        yield* Deferred.await(drained);

        expect(processed).toEqual(["first", "second"]);
      }),
    ),
  );
});
