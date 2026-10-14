import { expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { TestClock } from "effect/testing";

import { AbacusDriver } from "../Drivers/AbacusDriver.ts";
import { abacusModelsUrl, readAbacusModels } from "./abacusModels.ts";

it.effect("reads exact model IDs from the configured RouteLLM endpoint", () =>
  Effect.gen(function* () {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      expect(init?.headers).toMatchObject({ Authorization: "Bearer test-key" });
      return Response.json({
        data: [
          { id: "new-model", name: "New model" },
          { id: "new-model" },
          { id: "flux2_pro" },
          { id: "gemini-2.5-pro-preview-tts" },
          { id: "route-llm" },
        ],
      });
    });
    const models = yield* readAbacusModels({
      apiBaseUrl: "https://example.test/v1/",
      apiKey: "test-key",
      fetch,
    });

    expect(abacusModelsUrl("https://example.test/v1/")).toBe("https://example.test/v1/models");
    expect(fetch).toHaveBeenCalledOnce();
    expect(models.map((model) => [model.slug, model.name])).toEqual([
      ["new-model", "New model"],
      ["route-llm", "route-llm"],
    ]);
  }),
);

it.effect("refreshes ChatLLM models on demand and keeps the last list when the API fails", () => {
  let catalog = ["gpt-6-sol", "gpt-6-luna"];
  let fail = false;
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    if (String(input).endsWith("/models")) {
      if (fail) return new Response("unavailable", { status: 503 });
      return Response.json({ data: catalog.map((id) => ({ id })) });
    }
    return Response.json({ success: false });
  });

  return Effect.gen(function* () {
    const instance = yield* AbacusDriver.create({
      instanceId: ProviderInstanceId.make("abacus-refresh-test"),
      displayName: undefined,
      enabled: true,
      environment: [{ name: "ABACUS_API_KEY", value: "test-key", sensitive: true }],
      config: {
        ...AbacusDriver.defaultConfig(),
        apiBaseUrl: "https://example.test/v1",
        customModels: ["custom-model"],
      },
    });
    const modelIds = Effect.map(instance.snapshot.getSnapshot, (snapshot) =>
      snapshot.models.map((model) => model.slug),
    );

    yield* instance.snapshot.refresh;
    expect(yield* modelIds).toEqual(["route-llm", "gpt-6-sol", "gpt-6-luna", "custom-model"]);
    yield* instance.snapshot.refresh;
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("/models"))).toHaveLength(1);

    catalog = ["second-model"];
    yield* instance.refreshModels!();
    expect(yield* modelIds).toEqual(["route-llm", "second-model", "custom-model"]);

    fail = true;
    const result = yield* Effect.exit(instance.refreshModels!());
    expect(result._tag).toBe("Failure");
    expect(yield* modelIds).toEqual(["route-llm", "second-model", "custom-model"]);
  }).pipe(Effect.scoped, Effect.ensuring(Effect.sync(() => fetch.mockRestore())));
});

it.effect("checks for new ChatLLM models in the background", () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input) =>
      String(input).endsWith("/models")
        ? Response.json({ data: [{ id: "background-model" }] })
        : Response.json({ success: false }),
    );

  return Effect.gen(function* () {
    const instance = yield* AbacusDriver.create({
      instanceId: ProviderInstanceId.make("abacus-background-test"),
      displayName: undefined,
      enabled: true,
      environment: [{ name: "ABACUS_API_KEY", value: "test-key", sensitive: true }],
      config: AbacusDriver.defaultConfig(),
    });
    yield* TestClock.adjust("1 minute");
    const snapshot = yield* instance.snapshot.getSnapshot;
    expect(snapshot.models.map((model) => model.slug)).toContain("background-model");
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("/models"))).toHaveLength(1);

    yield* TestClock.adjust("1 hour");
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("/models"))).toHaveLength(1);

    yield* TestClock.adjust("7 days");
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("/models"))).toHaveLength(2);
  }).pipe(
    Effect.scoped,
    Effect.provide(TestClock.layer()),
    Effect.ensuring(Effect.sync(() => fetch.mockRestore())),
  );
});
