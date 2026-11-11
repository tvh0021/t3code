import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { TrimmedString } from "./baseSchemas.ts";
import { CustomModelSetting } from "./model.ts";
import { makeBinaryPathSetting, makeProviderSettingsSchema, secretSetting } from "./settings.ts";

export const ZedSettings = makeProviderSettingsSchema(
  {
    enabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(false)),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    binaryPath: makeBinaryPathSetting("zed-acp-server").pipe(
      Schema.annotateKey({
        title: "Binary path",
        description: "Path to the Zed ACP server binary.",
        providerSettingsForm: { placeholder: "zed-acp-server", clearWhenEmpty: "omit" },
      }),
    ),
    dataDir: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Zed data directory",
        description: "Custom Zed data directory path (optional).",
        providerSettingsForm: {
          placeholder: "/path/to/zed/data",
          clearWhenEmpty: "omit",
        },
      }),
    ),
    model: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Model",
        description: "Model identifier (e.g. anthropic/claude-3-7-sonnet).",
        providerSettingsForm: {
          placeholder: "anthropic/claude-3-7-sonnet",
          clearWhenEmpty: "omit",
        },
      }),
    ),
    dashboardSession: TrimmedString.pipe(
      secretSetting,
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Dashboard session",
        description:
          "Cookie header for cloud.zed.dev, used to read account spend after each Zed turn. Stored separately on the host.",
        providerSettingsForm: {
          control: "password",
          placeholder: "Optional",
          clearWhenEmpty: "omit",
        },
      }),
    ),
    customModels: Schema.Array(CustomModelSetting).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
  },
  {
    order: ["binaryPath", "model", "dataDir", "dashboardSession"],
  },
);
export type ZedSettings = typeof ZedSettings.Type;

export const ABACUS_DEFAULT_API_BASE_URL = "https://routellm.abacus.ai/v1";

export const AbacusSettings = makeProviderSettingsSchema(
  {
    enabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(false)),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    apiBaseUrl: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed(ABACUS_DEFAULT_API_BASE_URL)),
      Schema.annotateKey({
        title: "API base URL",
        description: "ChatLLM-compatible API base URL for this instance.",
        providerSettingsForm: {
          placeholder: ABACUS_DEFAULT_API_BASE_URL,
          clearWhenEmpty: "omit",
        },
      }),
    ),
    sessionCookie: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Session cookie",
        description:
          "Optional session cookie from apps.abacus.ai to query remaining monthly compute credits.",
        providerSettingsForm: {
          control: "password",
          placeholder: "session=...",
          clearWhenEmpty: "omit",
        },
      }),
    ),
    customModels: Schema.Array(CustomModelSetting).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
  },
  { order: ["apiBaseUrl", "sessionCookie"] },
);
export type AbacusSettings = typeof AbacusSettings.Type;
