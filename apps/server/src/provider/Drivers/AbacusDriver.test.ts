import { expect, it } from "@effect/vitest";
import { ProviderInstanceId, ProviderSessionId, ThreadId } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";

import { BUILT_IN_DRIVERS } from "../builtInDrivers.ts";
import { ABACUS_BUILT_IN_MODELS, AbacusDriver } from "./AbacusDriver.ts";

it("registers Abacus without replacing the existing built-in drivers", () => {
  expect(BUILT_IN_DRIVERS.map((driver) => driver.driverKind)).toEqual([
    "codex",
    "claudeAgent",
    "cursor",
    "grok",
    "opencode",
    "antigravity",
    "pi",
    "muse",
    "acpRegistry",
    "abacus",
    "zed",
  ]);
});

it.effect("enables configured Abacus text chat and exposes configured model IDs", () =>
  Effect.gen(function* () {
    const instance = yield* AbacusDriver.create({
      instanceId: ProviderInstanceId.make("abacus"),
      displayName: undefined,
      enabled: true,
      environment: [
        { name: "ABACUS_API_KEY", value: "test-key-not-a-real-secret", sensitive: true },
      ],
      config: {
        ...AbacusDriver.defaultConfig(),
        apiBaseUrl: "https://example.test/routellm/v1",
        customModels: ["route-llm", "account-route"],
      },
    });
    const snapshot = yield* instance.snapshot.getSnapshot;

    expect(AbacusDriver.defaultConfig()).toEqual({
      enabled: false,
      apiBaseUrl: "https://routellm.abacus.ai/v1",
      sessionCookie: "",
      customModels: [],
    });
    expect(snapshot).toMatchObject({
      driver: "abacus",
      instanceId: "abacus",
      enabled: true,
      status: "ready",
      auth: { status: "unknown" },
      supportsTextGeneration: true,
    });
    expect(snapshot.models).toEqual([
      ...ABACUS_BUILT_IN_MODELS,
      {
        slug: "account-route",
        name: "account-route",
        isCustom: true,
        capabilities: createModelCapabilities({ optionDescriptors: [] }),
      },
    ]);

    const sessionRuntime = yield* instance.orchestrationAdapter.openSession({
      threadId: ThreadId.make("thread-abacus-1"),
      providerSessionId: ProviderSessionId.make("session-abacus-1"),
      modelSelection: { instanceId: instance.instanceId, model: "route-llm" },
      runtimePolicy: {
        cwd: process.cwd(),
        runtimeMode: "full-access",
        interactionMode: "default",
      },
    });
    expect(sessionRuntime.providerSession).toMatchObject({
      id: "session-abacus-1",
      status: "ready",
      model: "route-llm",
    });
  }).pipe(Effect.scoped),
);
