import * as NodeCrypto from "node:crypto";

import type { ZedSettings } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import type * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";

export type ZedAcpRuntimeZedSettings = Pick<ZedSettings, "binaryPath" | "dataDir" | "model">;

export const ZED_CLIENT_CAPABILITIES: NonNullable<
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
  readonly environment?: NodeJS.ProcessEnv;
}

export function buildZedAcpSpawnInput(
  zedSettings: ZedAcpRuntimeZedSettings | null | undefined,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
): AcpSessionRuntime.AcpSpawnInput {
  const binary = zedSettings?.binaryPath?.trim() || "zed-acp-server";
  const args: string[] = [];
  if (cwd) {
    args.push("--worktree", cwd);
  }
  if (zedSettings?.dataDir?.trim()) {
    args.push("--data-dir", zedSettings.dataDir.trim());
  }
  if (zedSettings?.model?.trim()) {
    args.push("--model", zedSettings.model.trim());
  }
  return {
    command: binary,
    args,
    cwd,
    ...(environment ? { env: environment } : {}),
  };
}

export const makeZedAcpRuntime = (
  input: ZedAcpRuntimeInput,
): Effect.Effect<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  Crypto.Crypto | Scope.Scope
> =>
  Effect.gen(function* () {
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
          const digest = NodeCrypto.createHash("sha256")
            .update(JSON.stringify(update))
            .digest("hex");
          if (completedSnapshots.get(key) === digest) {
            return { ...normalized, _meta: { ...normalized._meta, isReplay: true } };
          }
          completedSnapshots.set(key, digest);
          return normalized;
        },
        spawn: buildZedAcpSpawnInput(input.zedSettings, input.cwd, input.environment),
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
