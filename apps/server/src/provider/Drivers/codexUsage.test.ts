import { describe, expect, it } from "@effect/vitest";

import {
  initialCodexScanState,
  parseCodexLine,
  reconcileCodexCreditUsage,
  reconcileCodexCreditUsageByHome,
} from "./codexUsage.ts";

describe("parseCodexLine", () => {
  const sessionMeta = JSON.stringify({
    type: "session_meta",
    timestamp: "2026-08-01T05:17:41.289Z",
    payload: { type: "session_meta", id: "019fbbc1-b12c-7360-a685-28c181f0025f" },
  });
  const turnContext = JSON.stringify({
    type: "turn_context",
    timestamp: "2026-08-01T05:17:42.694Z",
    payload: { type: "turn_context", model: "gpt-5.6-sol" },
  });
  const tokenCount = (inputTokens: number, cached: number, output: number, reasoning: number) =>
    JSON.stringify({
      type: "event_msg",
      timestamp: "2026-08-01T05:17:49.919Z",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: {
            input_tokens: inputTokens,
            cached_input_tokens: cached,
            cache_write_input_tokens: 0,
            output_tokens: output,
            reasoning_output_tokens: reasoning,
          },
        },
      },
    });

  it("attributes usage to the model from the preceding turn context", () => {
    const state = initialCodexScanState();
    parseCodexLine(sessionMeta, state);
    parseCodexLine(turnContext, state);
    const record = parseCodexLine(tokenCount(19239, 11008, 299, 116), state);

    expect(record?.provider).toBe("codex");
    expect(record?.model).toBe("gpt-5.6-sol");
    expect(record?.sessionId).toBe("019fbbc1-b12c-7360-a685-28c181f0025f");
    expect(record?.totals.uncachedInputTokens).toBe(19239 - 11008);
    expect(record?.totals.cachedInputTokens).toBe(11008);
    expect(record?.totals.reasoningTokens).toBe(116);
  });

  it("skips a repeated token_count so deltas are not double counted", () => {
    const state = initialCodexScanState();
    parseCodexLine(turnContext, state);
    const first = parseCodexLine(tokenCount(100, 0, 10, 0), state);
    const repeat = parseCodexLine(tokenCount(100, 0, 10, 0), state);

    expect(first).not.toBeNull();
    expect(repeat).toBeNull();
  });

  it("drops usage that arrives before any model is known", () => {
    const state = initialCodexScanState();
    expect(parseCodexLine(tokenCount(100, 0, 10, 0), state)).toBeNull();
  });

  it("does not let a pre-model event poison the duplicate signature", () => {
    const state = initialCodexScanState();
    expect(parseCodexLine(tokenCount(100, 0, 10, 0), state)).toBeNull();
    parseCodexLine(turnContext, state);
    expect(parseCodexLine(tokenCount(100, 0, 10, 0), state)).not.toBeNull();
  });

  it("carries the service tier from the latest thread settings", () => {
    const settings = (thread_settings: Record<string, unknown>) =>
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-08-01T05:17:42.000Z",
        payload: { type: "thread_settings_applied", thread_settings },
      });
    const state = initialCodexScanState();
    parseCodexLine(turnContext, state);
    const speedAfter = (line: string, output: number) => {
      parseCodexLine(line, state);
      return parseCodexLine(tokenCount(100, 0, output, 0), state)?.speed;
    };

    expect(parseCodexLine(tokenCount(100, 0, 1, 0), state)?.speed).toBe("standard");
    expect(speedAfter(settings({ service_tier: "ultrafast" }), 2)).toBe("ultrafast");
    expect(speedAfter(settings({ service_tier: "priority" }), 3)).toBe("fast");
    expect(speedAfter(settings({ model: "gpt-6-astra" }), 4)).toBe("standard");
  });

  it("carries the credit balance through to reconciliation, which prices the drop", () => {
    const state = initialCodexScanState();
    parseCodexLine(sessionMeta, state);
    parseCodexLine(turnContext, state);

    const tokenCountWithCredits = (inputTokens: number, outputTokens: number, balance: string) =>
      JSON.stringify({
        timestamp: "2026-08-01T05:00:00.000Z",
        payload: {
          type: "token_count",
          rate_limits: {
            credits: {
              hasCredits: true,
              unlimited: false,
              balance,
            },
          },
          info: {
            last_token_usage: {
              input_tokens: inputTokens,
              cached_input_tokens: 0,
              cache_write_input_tokens: 0,
              output_tokens: outputTokens,
              reasoning_output_tokens: 0,
            },
          },
        },
      });

    const first = parseCodexLine(tokenCountWithCredits(100, 10, "1175.3435"), state);
    const second = parseCodexLine(tokenCountWithCredits(200, 20, "1175.3083"), state);
    expect(first?.creditBalance).toBe(1175.3435);
    expect(second?.creditBalance).toBe(1175.3083);

    // The first balance is the baseline; the second turn consumed 0.0352 credits.
    const [file] = reconcileCodexCreditUsage([
      { path: "rollout.jsonl", records: [first!, second!] },
    ]);
    expect(file?.records.map((record) => record.credits)).toEqual([0, 0.0352]);
    expect(file?.records[0]?.reportedCostUsd).toBeNull();
    expect(file?.records[1]?.reportedCostUsd).toBeCloseTo(0.0352 * 0.04);
  });

  it("skips a repeated token payload even when its balance changed", () => {
    const state = initialCodexScanState();
    parseCodexLine(turnContext, state);
    const tokenCountWithCredits = (inputTokens: number, balance: string) =>
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-08-01T05:00:00.000Z",
        payload: {
          type: "token_count",
          rate_limits: { credits: { balance } },
          info: {
            last_token_usage: {
              input_tokens: inputTokens,
              cached_input_tokens: 0,
              cache_write_input_tokens: 0,
              output_tokens: 10,
              reasoning_output_tokens: 0,
            },
          },
        },
      });

    expect(parseCodexLine(tokenCountWithCredits(100, "100"), state)).not.toBeNull();
    expect(parseCodexLine(tokenCountWithCredits(100, "90"), state)).toBeNull();
    expect(parseCodexLine(tokenCountWithCredits(200, "80"), state)?.creditBalance).toBe(80);
  });

  it("reconciles one account balance across concurrent rollouts and excludes auto-review", () => {
    const makeRecord = (model: string, timestampMs: number, creditBalance: number) => ({
      provider: "codex" as const,
      timestampMs,
      model,
      sessionId: model,
      totals: {
        uncachedInputTokens: 1,
        cachedInputTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 1,
        reasoningTokens: 0,
      },
      reportedCostUsd: null,
      credits: null,
      creditBalance,
      speed: "standard" as const,
      dedupeKey: null,
    });

    const reconciled = reconcileCodexCreditUsage([
      {
        path: "parent.jsonl",
        records: [makeRecord("gpt-5.6-sol", 1, 2500), makeRecord("gpt-5.6-sol", 2, 2000)],
      },
      {
        path: "child.jsonl",
        records: [
          makeRecord("gpt-5.6-sol", 2, 2000),
          makeRecord("codex-auto-review", 3, 2000),
          makeRecord("gpt-5.6-sol", 4, 1169),
        ],
      },
    ]);

    const records = reconciled.flatMap((file) => file.records);
    expect(records.map((record) => record.credits)).toEqual([0, 500, 0, 0, 831]);
    expect(records[0]?.reportedCostUsd).toBeNull();
    expect(records[2]?.reportedCostUsd).toBeNull();
    expect(records.find((record) => record.model === "codex-auto-review")).toMatchObject({
      credits: 0,
      reportedCostUsd: 0,
    });
    expect(records.reduce((sum, record) => sum + (record.credits ?? 0), 0)).toBe(1331);
    expect(records.reduce((sum, record) => sum + (record.reportedCostUsd ?? 0), 0)).toBeCloseTo(
      1331 * 0.04,
    );
  });

  it("reconciles a home's live and archived sessions as one balance timeline", () => {
    const makeRecord = (sessionId: string, timestampMs: number, creditBalance: number) => ({
      provider: "codex" as const,
      timestampMs,
      model: "gpt-6-sol",
      sessionId,
      totals: {
        uncachedInputTokens: 1,
        cachedInputTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 1,
        reasoningTokens: 0,
      },
      reportedCostUsd: null,
      credits: null,
      creditBalance,
      speed: "standard" as const,
      dedupeKey: null,
    });
    const dirs = [
      { provider: "codex", dir: "/home/a/.codex/sessions" },
      { provider: "codex", dir: "/home/a/.codex/archived_sessions" },
      { provider: "codex", dir: "/home/b/.codex/sessions" },
      { provider: "claude", dir: "/home/a/.claude/projects" },
    ];
    const claudeFiles = [{ path: "claude.jsonl", records: [] }];
    const reconciled = reconcileCodexCreditUsageByHome(dirs, [
      [{ path: "live.jsonl", records: [makeRecord("live", 2, 100), makeRecord("live", 4, 91)] }],
      [{ path: "old.jsonl", records: [makeRecord("old", 1, 100), makeRecord("old", 3, 91)] }],
      [{ path: "b.jsonl", records: [makeRecord("b", 1, 50), makeRecord("b", 2, 40)] }],
      claudeFiles,
    ]);

    const credits = (index: number) =>
      reconciled[index]!.flatMap((file) => file.records).reduce(
        (sum, record) => sum + (record.credits ?? 0),
        0,
      );
    // One 9-credit drop, seen from both directories of home a, counts once.
    expect(credits(0) + credits(1)).toBe(9);
    // Another home is another account with its own baseline.
    expect(credits(2)).toBe(10);
    expect(reconciled[3]).toBe(claudeFiles);
  });

  it("excludes codex-auto-review turns at parse time", () => {
    const state = initialCodexScanState();
    const autoReviewContext = JSON.stringify({
      type: "turn_context",
      timestamp: "2026-08-01T05:17:42.694Z",
      payload: { type: "turn_context", model: "codex-auto-review" },
    });
    parseCodexLine(autoReviewContext, state);
    const record = parseCodexLine(tokenCount(100, 0, 10, 0), state);
    expect(record).not.toBeNull();
    expect(record?.model).toBe("codex-auto-review");
    expect(record?.credits).toBe(0);
    expect(record?.reportedCostUsd).toBe(0);
  });

  // A forked/subagent rollout opens with the parent's history copied in and
  // every line re-stamped to the fork instant, then the ancestors' session
  // metas. Counting those again multiplied usage ~1.85x on real data (#5758).
  describe("forked rollouts", () => {
    const meta = (overrides: {
      id: string;
      timestamp: string;
      forkedFromId?: string;
      spawnParentId?: string;
    }) =>
      JSON.stringify({
        type: "session_meta",
        timestamp: overrides.timestamp,
        payload: {
          type: "session_meta",
          id: overrides.id,
          ...(overrides.forkedFromId === undefined
            ? {}
            : { forked_from_id: overrides.forkedFromId }),
          ...(overrides.spawnParentId === undefined
            ? {}
            : {
                source: {
                  subagent: { thread_spawn: { parent_thread_id: overrides.spawnParentId } },
                },
              }),
        },
      });
    const stamped = (timestamp: string, line: string) => {
      const parsed = JSON.parse(line) as { timestamp: string };
      parsed.timestamp = timestamp;
      return JSON.stringify(parsed);
    };

    it("keeps the child session id over copied ancestor metas", () => {
      const state = initialCodexScanState();
      parseCodexLine(meta({ id: "child", timestamp: "2026-08-01T05:00:00.000Z" }), state);
      parseCodexLine(meta({ id: "parent", timestamp: "2026-08-01T05:00:00.000Z" }), state);
      parseCodexLine(turnContext, state);
      const record = parseCodexLine(tokenCount(100, 0, 10, 0), state);

      expect(record?.sessionId).toBe("child");
    });

    it("drops the re-stamped copied burst and keeps the first real event", () => {
      const state = initialCodexScanState();
      const forkInstant = "2026-08-01T05:00:00.000Z";
      parseCodexLine(meta({ id: "child", timestamp: forkInstant, forkedFromId: "parent" }), state);
      parseCodexLine(meta({ id: "parent", timestamp: forkInstant }), state);
      parseCodexLine(stamped(forkInstant, turnContext), state);

      expect(
        parseCodexLine(stamped("2026-08-01T05:00:00.001Z", tokenCount(100, 0, 10, 0)), state),
      ).toBeNull();
      expect(
        parseCodexLine(stamped("2026-08-01T05:00:00.002Z", tokenCount(200, 0, 20, 0)), state),
      ).toBeNull();

      const real = parseCodexLine(
        stamped("2026-08-01T05:00:06.000Z", tokenCount(300, 0, 30, 0)),
        state,
      );
      expect(real).not.toBeNull();
      expect(real?.totals.outputTokens).toBe(30);

      const next = parseCodexLine(
        stamped("2026-08-01T05:00:06.100Z", tokenCount(400, 0, 40, 0)),
        state,
      );
      expect(next).not.toBeNull();
    });

    it("recognizes subagent spawns without forked_from_id", () => {
      const state = initialCodexScanState();
      const spawnInstant = "2026-08-01T05:00:00.000Z";
      parseCodexLine(
        meta({ id: "child", timestamp: spawnInstant, spawnParentId: "parent" }),
        state,
      );
      parseCodexLine(stamped(spawnInstant, turnContext), state);
      expect(
        parseCodexLine(stamped("2026-08-01T05:00:00.001Z", tokenCount(100, 0, 10, 0)), state),
      ).toBeNull();
    });

    it("does not suppress anything in a rollout that is not a fork", () => {
      const state = initialCodexScanState();
      parseCodexLine(meta({ id: "root", timestamp: "2026-08-01T05:00:00.000Z" }), state);
      parseCodexLine(stamped("2026-08-01T05:00:00.100Z", turnContext), state);
      const record = parseCodexLine(
        stamped("2026-08-01T05:00:00.200Z", tokenCount(100, 0, 10, 0)),
        state,
      );
      expect(record).not.toBeNull();
    });
  });
});
