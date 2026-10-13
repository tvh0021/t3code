import * as Effect from "effect/Effect";
import type * as EffectAcpSchema from "effect-acp/schema";

import { appendProviderTurnUsage } from "../../usage/providerTurnUsageWriter.ts";

/**
 * Appends a finished Antigravity turn's token usage to the fork's usage log.
 * Turns without token usage are skipped, and write failures never fail the turn.
 */
export const recordAntigravityTurnUsage = (input: {
  readonly stateDir: string | undefined;
  readonly sessionId: string;
  readonly turnId: string;
  readonly model: string | undefined;
  readonly usage: EffectAcpSchema.Usage | null | undefined;
}): Effect.Effect<void> => {
  const { stateDir, usage } = input;
  if (!stateDir) return Effect.void;
  const inputTokens = usage?.inputTokens ?? 0;
  const cachedInputTokens = usage?.cachedReadTokens ?? 0;
  const cacheCreationTokens = usage?.cachedWriteTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  const reasoningTokens = usage?.thoughtTokens ?? 0;
  if (!usage || !(inputTokens > 0 || cachedInputTokens > 0 || outputTokens > 0)) {
    return Effect.void;
  }
  return Effect.promise(() =>
    appendProviderTurnUsage({
      stateDir,
      provider: "antigravity",
      sessionId: input.sessionId,
      turnId: input.turnId,
      model: input.model || "gemini-2.5-pro",
      tokens: {
        inputTokens,
        cachedInputTokens,
        cacheCreationTokens,
        outputTokens,
        reasoningTokens,
      },
    }),
  ).pipe(Effect.catchCause(() => Effect.void));
};
