import { describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import type * as EffectAcpSchema from "effect-acp/compat";

import { applyZedModelSelection } from "./ZedAdapterV2.ts";

const instanceId = ProviderInstanceId.make("zed");

const effortOption = {
  id: "thinking_effort",
  name: "Thinking effort",
  category: "thought_level",
  type: "select",
  currentValue: "high",
  _meta: { defaultValue: "high" },
  options: [
    { value: "low", name: "Low" },
    { value: "high", name: "High" },
  ],
} satisfies EffectAcpSchema.SessionConfigOption;

/** Mirrors zed-acp-server: no options until a model is set, and no advertised model option. */
const makeBridge = Effect.gen(function* () {
  const options = yield* Ref.make<ReadonlyArray<EffectAcpSchema.SessionConfigOption>>([]);
  const calls = yield* Ref.make<ReadonlyArray<string>>([]);
  const record = (call: string) => Ref.update(calls, (all) => [...all, call]);
  return {
    calls: Ref.get(calls),
    runtime: {
      getConfigOptions: Ref.get(options),
      setModel: (model: string) =>
        record(`model=${model}`).pipe(Effect.andThen(Ref.set(options, [effortOption]))),
      setConfigOption: (configId: string, value: string | boolean) =>
        record(`${configId}=${String(value)}`).pipe(
          Effect.as({ configOptions: [] } satisfies EffectAcpSchema.SetSessionConfigOptionResponse),
        ),
    },
  };
});

describe("applyZedModelSelection", () => {
  it.effect("sets the model the bridge never advertises, then its requested effort", () =>
    Effect.gen(function* () {
      const bridge = yield* makeBridge;
      const applied = yield* applyZedModelSelection(bridge.runtime, {
        instanceId,
        model: "zed.dev/claude-sonnet-5-5",
        options: [{ id: "thinking_effort", value: "low" }],
      });
      expect(applied).toBe("zed.dev/claude-sonnet-5-5");
      expect(yield* bridge.calls).toEqual([
        "model=zed.dev/claude-sonnet-5-5",
        "thinking_effort=low",
      ]);
    }),
  );

  it.effect("leaves the bridge's default model alone", () =>
    Effect.gen(function* () {
      const bridge = yield* makeBridge;
      yield* applyZedModelSelection(bridge.runtime, { instanceId, model: "default" });
      expect(yield* bridge.calls).toEqual([]);
    }),
  );
});
