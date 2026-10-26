import {
  type ModelSelection,
  ProviderApprovalOption,
  ProviderDriverKind,
  ProviderInstanceId,
  ZedSettings,
  type OrchestrationV2ProviderCapabilities,
  type ProviderSetupError,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { resolveSelfInvocation, type SelfInvocation } from "@t3tools/shared/nodeRuntime";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/compat";

import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as ProviderEventLoggers from "@t3tools/provider-core/server/ProviderEventLoggers";
import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import {
  ProviderAdapterDriverCreateError,
  type ProviderAdapterDriverCreateInput,
} from "@t3tools/provider-core/server/adapterDriver";
import { makeProviderFailure } from "@t3tools/provider-core/server/failure";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import type * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";
import { makeAcpNativeLoggerFactory } from "@t3tools/provider-acp/server/nativeLogging";
import {
  AcpProviderCapabilitiesV2,
  makeAcpAdapterV2,
  type AcpAdapterV2Flavor,
  type AcpAdapterV2RuntimeInput,
} from "@t3tools/provider-acp/server/adapter";
import { makeZedAcpRuntime, type ZedAcpRuntimeInput } from "../../provider/acp/ZedAcpSupport.ts";

const ZED_PROVIDER = ProviderDriverKind.make("zed");

const ZedProviderCapabilitiesV2 = {
  ...AcpProviderCapabilitiesV2,
  sessions: {
    ...AcpProviderCapabilitiesV2.sessions,
    supportsModelSwitchInSession: true,
    supportsRuntimeModeSwitchInSession: false,
  },
} satisfies OrchestrationV2ProviderCapabilities;

export interface ZedAdapterV2Options {
  readonly instanceId: ProviderInstanceId;
  readonly selfInvocation: SelfInvocation;
  readonly makeRuntime: (
    input: Omit<ZedAcpRuntimeInput, "childProcessSpawner">,
  ) => Effect.Effect<
    AcpSessionRuntime.AcpSessionRuntime["Service"],
    EffectAcpErrors.AcpError | ProviderSetupError,
    Scope.Scope
  >;
  readonly defaultModel?: Effect.Effect<string | undefined>;
  readonly onSessionStarted?: (
    started: AcpSessionRuntime.AcpSessionRuntimeStartResult,
    cwd: string,
  ) => Effect.Effect<void>;
  readonly onSessionEvent?: AcpAdapterV2Flavor["onSessionEvent"];
  /** Runs after every prompt settles, whatever its outcome. Must not block. */
  readonly onPromptSettled?: Effect.Effect<void>;
  readonly nativeLogging?: Parameters<typeof makeAcpAdapterV2>[0]["nativeLogging"];
  readonly continuationRequests?: Parameters<typeof makeAcpAdapterV2>[0]["continuationRequests"];
}

interface ZedFlavorServices {
  readonly crypto: Crypto.Crypto;
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly host: ProviderHost.ProviderHost["Service"];
}

/** Selects the model, then the thinking effort the bridge reports for that model. */
export const applyZedModelSelection = Effect.fnUntraced(function* (
  runtime: Pick<
    AcpSessionRuntime.AcpSessionRuntime["Service"],
    "setModel" | "getConfigOptions" | "setConfigOption"
  >,
  modelSelection: ModelSelection,
) {
  const requestedModel = modelSelection.model;
  if (requestedModel && requestedModel !== "default" && requestedModel !== "auto") {
    // zed-acp-server accepts the "model" config id without advertising it,
    // and only reports thinking effort once a model is set.
    yield* runtime.setModel(requestedModel);
  }
  const configOptions = yield* runtime.getConfigOptions;
  const effortDescriptor = configOptions.find((option) => option.id === "thinking_effort");
  const requestedEffort = modelSelection.options?.find(
    (opt) => opt.id === "thinking_effort",
  )?.value;
  if (!effortDescriptor || effortDescriptor.type !== "select") {
    if (requestedEffort) {
      return yield* EffectAcpErrors.AcpRequestError.invalidParams(
        "This Zed bridge or model does not support thinking effort. Refresh the model catalog or rebuild zed-acp-server.",
      );
    }
  } else {
    const nativeDefault = (effortDescriptor._meta as Record<string, unknown> | undefined)?.[
      "defaultValue"
    ];
    const value =
      (typeof requestedEffort === "string" ? requestedEffort : undefined) ??
      (typeof nativeDefault === "string" ? nativeDefault : effortDescriptor.currentValue);
    if (value && value !== effortDescriptor.currentValue) {
      yield* runtime.setConfigOption(effortDescriptor.id, value);
    }
  }
  return requestedModel;
});

const isAcpRequestError = Schema.is(EffectAcpErrors.AcpRequestError);
// zed-acp-server flattens Zed's payment-required category into the text of a
// generic -32000 error, and the cloud's wording varies by plan.
const zedOutOfCredits =
  /\bcredits?\s+(?:consumed|exhausted|depleted)\b|\b(?:insufficient|out of|no remaining)\s+(?:\w+\s+)?credits?\b/i;

export function zedPromptFailure(cause: unknown) {
  if (!isAcpRequestError(cause)) return makeProviderFailure({ cause, class: "provider_error" });
  const message = cause.errorMessage.replace(/^Prompt failed:\s*/, "");
  return makeProviderFailure({
    cause,
    message,
    code: String(cause.code),
    class: zedOutOfCredits.test(message) ? "usage_limit" : "provider_error",
  });
}

function makeZedAcpAdapterFlavor(
  options: ZedAdapterV2Options & ZedFlavorServices,
): AcpAdapterV2Flavor {
  const makeRuntime = Effect.fn("ZedAdapterV2.makeRuntime")(
    function* (input: AcpAdapterV2RuntimeInput) {
      const scope = yield* Scope.fork(yield* Effect.scope);
      const runtime = yield* options
        .makeRuntime({ ...input, zedSettings: undefined })
        .pipe(Effect.provideService(Scope.Scope, scope));
      return {
        ...runtime,
        prompt: (...args: Parameters<typeof runtime.prompt>) =>
          runtime.prompt(...args).pipe(Effect.ensuring(options.onPromptSettled ?? Effect.void)),
        start: () =>
          runtime
            .start()
            .pipe(
              Effect.tap(
                (started) => options.onSessionStarted?.(started, input.cwd) ?? Effect.void,
              ),
            ),
      };
    },
    Effect.provideService(Crypto.Crypto, options.crypto),
    Effect.mapError((cause): EffectAcpErrors.AcpError =>
      cause._tag === "ProviderSetupError"
        ? new EffectAcpErrors.AcpTransportError({ detail: cause.detail, cause })
        : cause,
    ),
  );

  return {
    driver: ZED_PROVIDER,
    runtimeHarness: "Zed",
    capabilities: ZedProviderCapabilitiesV2,
    makeRuntime,
    supportsCompaction: true,
    ...(options.onSessionEvent === undefined ? {} : { onSessionEvent: options.onSessionEvent }),
    applyModelSelection: ({ runtime, modelSelection }) =>
      applyZedModelSelection(runtime, modelSelection),
    promptFailure: zedPromptFailure,
    approvalOptions: (request) => {
      const options: ProviderApprovalOption[] = [];
      const optionWithKind = (kind: EffectAcpSchema.PermissionOption["kind"]) =>
        request.options.find((entry) => entry.kind === kind && entry.optionId.trim());
      const once = optionWithKind("allow_once");
      if (once) {
        options.push({ decision: "accept", label: "Allow once" });
      }
      const always = optionWithKind("allow_always");
      if (always) {
        options.push({ decision: "acceptForSession", label: "Allow for this thread" });
      }
      if (optionWithKind("reject_once")) {
        options.push({ decision: "decline", label: "Deny" });
      }
      options.push({ decision: "cancel", label: "Cancel" });
      return options;
    },
  };
}

const makeZedAdapterV2 = Effect.fn("makeZedAdapterV2")(function* (options: ZedAdapterV2Options) {
  const services: ZedFlavorServices = {
    crypto: yield* Crypto.Crypto,
    fileSystem: yield* FileSystem.FileSystem,
    path: yield* Path.Path,
    host: yield* ProviderHost.ProviderHost,
  };
  return yield* makeAcpAdapterV2({
    instanceId: options.instanceId,
    flavor: makeZedAcpAdapterFlavor({ ...options, ...services }),
    selfInvocation: options.selfInvocation,
    ...(options.nativeLogging === undefined ? {} : { nativeLogging: options.nativeLogging }),
    ...(options.continuationRequests === undefined
      ? {}
      : { continuationRequests: options.continuationRequests }),
  });
});

export type ZedAdapterV2DriverEnv =
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | IdAllocator.IdAllocatorV2
  | McpProviderSessions.McpProviderSessions
  | Path.Path
  | ProviderEventLoggers.ProviderEventLoggers
  | ProviderHost.ProviderHost;

export const createZedAdapterV2 = Effect.fn("ZedAdapterV2Driver.create")(
  function* (
    input: ProviderAdapterDriverCreateInput<ZedSettings>,
    hooks: Pick<ZedAdapterV2Options, "onPromptSettled"> = {},
  ) {
    const crypto = yield* Crypto.Crypto;
    const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const hostEnvironment = yield* HostProcess.Environment;
    const selfInvocation = yield* resolveSelfInvocation();
    const providerEventLoggers = yield* ProviderEventLoggers.ProviderEventLoggers;
    const makeNativeLogger = yield* makeAcpNativeLoggerFactory();
    const processEnv = yield* mergeProviderInstanceEnvironment(input.environment, hostEnvironment);
    return yield* makeZedAdapterV2({
      instanceId: input.instanceId,
      selfInvocation,
      ...hooks,
      makeRuntime: (runtimeInput) =>
        makeZedAcpRuntime({
          ...runtimeInput,
          childProcessSpawner,
          zedSettings: input.config,
          environment: processEnv,
        }).pipe(Effect.provideService(Crypto.Crypto, crypto)),
      nativeLogging: (threadId) =>
        makeNativeLogger({
          nativeEventLogger: providerEventLoggers.native,
          provider: ZED_PROVIDER,
          threadId,
        }),
    });
  },
  (effect, input, _hooks) =>
    effect.pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterDriverCreateError({
            driver: ZED_PROVIDER,
            instanceId: input.instanceId,
            detail: "Failed to create Zed adapter.",
            cause,
          }),
      ),
    ),
);
