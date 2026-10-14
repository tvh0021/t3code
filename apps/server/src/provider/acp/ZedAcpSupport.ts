// @effect-diagnostics nodeBuiltinImport:off - session updates are deduplicated synchronously.
import * as NodeCrypto from "node:crypto";

import type { ModelSelection, ZedSettings, ProviderApprovalDecision } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import type * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/compat";

import * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";

type ZedAcpRuntimeZedSettings = Pick<ZedSettings, "binaryPath" | "dataDir" | "model">;

const ZED_CLIENT_CAPABILITIES: NonNullable<
  EffectAcpSchema.InitializeRequest["clientCapabilities"]
> = {
  elicitation: { form: {} },
  fs: {
    readTextFile: false,
    writeTextFile: false,
  },
  terminal: false,
};

export interface ZedAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "authMethodId" | "clientCapabilities" | "clientInfo" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly zedSettings: ZedAcpRuntimeZedSettings | null | undefined;
  readonly modelSelection?: ModelSelection;
  readonly environment?: NodeJS.ProcessEnv;
}

export function buildZedAcpSpawnInput(
  zedSettings: ZedAcpRuntimeZedSettings | null | undefined,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
  selectedModel?: string,
): AcpSessionRuntime.AcpSpawnInput {
  const binary = zedSettings?.binaryPath?.trim() || "zed-acp-server";
  const args: string[] = [];
  if (cwd) {
    args.push("--worktree", cwd);
  }
  if (zedSettings?.dataDir?.trim()) {
    args.push("--data-dir", zedSettings.dataDir.trim());
  }
  const model =
    selectedModel && selectedModel !== "default" && selectedModel !== "auto"
      ? selectedModel
      : zedSettings?.model?.trim();
  // The bridge authenticates and discovers cloud models before session/new
  // only when a startup model is supplied.
  if (model) args.push("--model", model);
  return {
    command: binary,
    args,
    cwd,
    ...(environment ? { env: environment } : {}),
  };
}

export const makeZedAcpRuntime = Effect.fn("makeZedAcpRuntime")(function* (
  input: ZedAcpRuntimeInput,
): Effect.fn.Return<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  Crypto.Crypto | Scope.Scope
> {
  // Zed scans historical entries on each text update and resends completed
  // tools. Suppress identical snapshots before they close an assistant segment.
  // Keep only digests, not tool output, for the lifetime of this ACP session.
  const completedSnapshots = new Map<string, string>();
  const acpContext = yield* Layer.build(
    AcpSessionRuntime.layer({
      ...input,
      transformSessionUpdate: (notification) => {
        const normalized = input.transformSessionUpdate?.(notification) ?? notification;
        const update = normalized.update;
        if (
          (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update") ||
          (update.status !== "completed" && update.status !== "failed")
        ) {
          return normalized;
        }
        const key = JSON.stringify([normalized.sessionId, update.toolCallId]);
        const digest = NodeCrypto.createHash("sha256").update(JSON.stringify(update)).digest("hex");
        if (completedSnapshots.get(key) === digest) {
          return { ...normalized, _meta: { ...normalized._meta, isReplay: true } };
        }
        completedSnapshots.set(key, digest);
        return normalized;
      },
      spawn: buildZedAcpSpawnInput(
        input.zedSettings,
        input.cwd,
        input.environment,
        input.modelSelection?.model,
      ),
      clientCapabilities: ZED_CLIENT_CAPABILITIES,
      clientInfo: {
        name: "t3-code",
        version: "1.0.0",
      },
    }).pipe(
      Layer.provide(
        Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
      ),
    ),
  );
  return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
    Effect.provide(acpContext),
  );
});

export function selectAcpPermissionOptionId(
  request: EffectAcpSchema.RequestPermissionRequest,
  decision: ProviderApprovalDecision,
): string | undefined {
  const preferredKinds: ReadonlyArray<EffectAcpSchema.PermissionOption["kind"]> = (() => {
    switch (decision) {
      case "accept":
        return ["allow_once", "allow_always"];
      case "acceptForSession":
      case "acceptAlways":
        return ["allow_always", "allow_once"];
      case "decline":
        return ["reject_once", "reject_always"];
      case "cancel":
        return [];
    }
  })();

  for (const kind of preferredKinds) {
    const option = request.options.find(
      (candidate) => candidate.kind === kind && candidate.optionId.trim().length > 0,
    );
    if (option) return option.optionId;
  }
  return undefined;
}
