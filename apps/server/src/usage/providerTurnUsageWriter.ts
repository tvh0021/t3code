// @effect-diagnostics nodeBuiltinImport:off globalDate:off - writes directly to session log on disk
import * as NodeFS from "node:fs/promises";
import * as NodePath from "node:path";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import type { UsageProviderKind } from "@t3tools/contracts";

export interface RecordProviderTurnUsageInput {
  readonly stateDir: string;
  readonly provider: Extract<UsageProviderKind, "antigravity" | "abacus">;
  readonly sessionId: string;
  readonly turnId?: string;
  readonly model: string;
  readonly tokens: {
    readonly inputTokens: number;
    readonly cachedInputTokens?: number;
    readonly cacheCreationTokens?: number;
    readonly outputTokens: number;
    readonly reasoningTokens?: number;
  };
  readonly credits?: number | undefined;
  readonly timestamp?: Date | string | number;
  readonly timestampMs?: number;
}

export async function appendProviderTurnUsage(input: RecordProviderTurnUsageInput): Promise<void> {
  const { stateDir, provider, sessionId, model, tokens, turnId, credits } = input;
  if (!sessionId || !model || !stateDir) return;

  const uncachedInput = Math.max(0, Math.round(tokens.inputTokens || 0));
  const cachedInput = Math.max(0, Math.round(tokens.cachedInputTokens || 0));
  const cacheCreation = Math.max(0, Math.round(tokens.cacheCreationTokens || 0));
  const output = Math.max(0, Math.round(tokens.outputTokens || 0));
  const reasoning = Math.max(0, Math.round(tokens.reasoningTokens || 0));

  if (
    uncachedInput === 0 &&
    cachedInput === 0 &&
    cacheCreation === 0 &&
    output === 0 &&
    (credits === undefined || credits === 0)
  ) {
    return;
  }

  const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const dir = NodePath.join(stateDir, "usage", provider, "sessions");
  await NodeFS.mkdir(dir, { recursive: true });
  const filePath = NodePath.join(dir, `${safeSessionId}.jsonl`);

  const rawTimestamp = input.timestamp ?? input.timestampMs;
  let timestampIso: string;
  if (rawTimestamp !== undefined) {
    const parsed = DateTime.make(rawTimestamp);
    timestampIso = Option.isSome(parsed)
      ? DateTime.formatIso(parsed.value)
      : DateTime.formatIso(DateTime.makeUnsafe(Date.now()));
  } else {
    timestampIso = DateTime.formatIso(DateTime.makeUnsafe(Date.now()));
  }

  let exists = false;
  try {
    const stat = await NodeFS.stat(filePath);
    exists = stat.size > 0;
  } catch {
    exists = false;
  }

  const lines: string[] = [];
  if (!exists) {
    lines.push(
      JSON.stringify({
        timestamp: timestampIso,
        type: "session_meta",
        payload: { id: sessionId },
      }),
    );
  }

  lines.push(
    JSON.stringify({
      timestamp: timestampIso,
      type: "turn_context",
      payload: { model },
    }),
  );

  // Codex reports `input_tokens` inclusive of cached portion
  const totalInputTokens = uncachedInput + cachedInput + cacheCreation;
  lines.push(
    JSON.stringify({
      timestamp: timestampIso,
      payload: {
        type: "token_count",
        info: {
          last_token_usage: {
            input_tokens: totalInputTokens,
            cached_input_tokens: cachedInput,
            cache_write_input_tokens: cacheCreation,
            output_tokens: output,
            reasoning_output_tokens: reasoning,
            ...(credits !== undefined ? { credits: Math.round(credits * 100) / 100 } : {}),
            ...(turnId ? { turn_id: turnId } : {}),
          },
        },
      },
    }),
  );

  await NodeFS.appendFile(filePath, lines.join("\n") + "\n", "utf8");
}
