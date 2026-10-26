import { describe, expect, it } from "@effect/vitest";

import {
  codexUsageFormat,
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
  const counters = (input: number, output: number) => ({
    input_tokens: input,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    output_tokens: output,
    reasoning_output_tokens: 0,
    total_tokens: input + output,
  });
  const counted = (last: unknown, total?: unknown, extra = {}) =>
    JSON.stringify({
      type: "event_msg",
      timestamp: "2026-08-01T05:17:49.919Z",
      payload: {
        type: "token_count",
        info: { last_token_usage: last, total_token_usage: total, ...extra },
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

  it("does not consume counters before the model and timestamp are valid", () => {
    const state = initialCodexScanState();
    expect(parseCodexLine(tokenCount(100, 0, 10, 0), state)).toBeNull();
    parseCodexLine(turnContext, state);
    expect(parseCodexLine(tokenCount(100, 0, 10, 0), state)).not.toBeNull();

    const cumulativeState = initialCodexScanState();
    const line = counted(counters(100, 20), counters(100, 20));
    expect(parseCodexLine(line, cumulativeState)).toBeNull();
    parseCodexLine(turnContext, cumulativeState);
    expect(
      parseCodexLine(line.replace("2026-08-01T05:17:49.919Z", "invalid"), cumulativeState),
    ).toBeNull();
    expect(parseCodexLine(line, cumulativeState)?.totals.outputTokens).toBe(20);
    expect(codexUsageFormat.readMalformedRecords?.(cumulativeState)).toBe(0);
  });

  it("ignores stale changed requests but counts equal requests when totals advance across contexts", () => {
    const state = initialCodexScanState();
    parseCodexLine(turnContext, state);
    const request = counters(100, 20);
    expect(parseCodexLine(counted(request, request), state)?.totals.outputTokens).toBe(20);
    expect(parseCodexLine(counted(counters(20, 5), request), state)).toBeNull();
    expect(
      parseCodexLine(
        counted({ ...counters(0, 0), total_tokens: 20330 }, request, {
          model_context_window: 258400,
        }),
        state,
      ),
    ).toBeNull();
    expect(parseCodexLine(counted(request, counters(200, 40)), state)?.totals.outputTokens).toBe(
      20,
    );

    for (const [index, tier] of ["priority", "ultrafast"].entries()) {
      parseCodexLine(
        JSON.stringify({ type: "turn_context", payload: { model: "gpt-6-astra" } }),
        state,
      );
      parseCodexLine(
        JSON.stringify({
          type: "event_msg",
          payload: { type: "thread_settings_applied", thread_settings: { service_tier: tier } },
        }),
        state,
      );
      const record = parseCodexLine(
        counted(request, counters(100 * (index + 3), 20 * (index + 3))),
        state,
      );
      expect(record).toMatchObject({
        model: "gpt-6-astra",
        speed: tier === "priority" ? "fast" : "ultrafast",
        totals: { uncachedInputTokens: 100, outputTokens: 20 },
      });
    }
    expect(codexUsageFormat.readMalformedRecords?.(state)).toBe(0);
  });

  it.each([false, true])(
    "does not rebill legacy requests or drop the next cumulative delta (initial cumulative=%s)",
    (initialCumulative) => {
      const state = initialCodexScanState();
      parseCodexLine(turnContext, state);
      const first = counters(100, 20);
      expect(
        parseCodexLine(counted(first, initialCumulative ? first : undefined), state)?.totals
          .outputTokens,
      ).toBe(20);
      expect(parseCodexLine(counted(first), state)).toBeNull();
      expect(parseCodexLine(counted(counters(20, 5)), state)?.totals.outputTokens).toBe(5);
      expect(parseCodexLine(counted(counters(20, 5), counters(120, 25)), state)).toBeNull();
      expect(
        parseCodexLine(counted(counters(10, 2), counters(130, 27)), state)?.totals.outputTokens,
      ).toBe(2);
      expect(codexUsageFormat.readMalformedRecords?.(state)).toBe(0);
    },
  );

  it("checks every cumulative component and recovers using an inconsistent pair's valid baseline", () => {
    const request = {
      ...counters(100, 20),
      cached_input_tokens: 30,
      cache_write_input_tokens: 10,
      reasoning_output_tokens: 5,
    };
    const fields = Object.keys(request) as (keyof typeof request)[];
    for (const field of fields) {
      const state = initialCodexScanState();
      parseCodexLine(turnContext, state);
      expect(parseCodexLine(counted(request, request), state)?.totals).toEqual({
        uncachedInputTokens: 60,
        cachedInputTokens: 30,
        cacheCreationTokens: 10,
        outputTokens: 20,
        reasoningTokens: 5,
      });
      const total = { ...request };
      for (const key of fields) total[key] *= 2;
      total[field] += 1;
      if (field === "input_tokens" || field === "output_tokens") total.total_tokens += 1;
      expect(parseCodexLine(counted(request, total), state), field).toBeNull();
      expect(codexUsageFormat.readMalformedRecords?.(state), field).toBe(1);
      for (const key of fields) total[key] += request[key];
      expect(parseCodexLine(counted(request, total), state)?.totals.outputTokens, field).toBe(20);
      expect(codexUsageFormat.readMalformedRecords?.(state), field).toBe(1);
    }
  });

  it.each(["continuation", "fork", "subagent"])(
    "bills only the latest request when a %s has no initial counter baseline",
    (source) => {
      const state = initialCodexScanState();
      parseCodexLine(
        JSON.stringify({
          type: "session_meta",
          timestamp: "2026-08-01T05:17:41.000Z",
          payload: {
            id: "child",
            model_provider: "openai",
            ...(source === "fork" ? { forked_from_id: "parent" } : {}),
            ...(source === "subagent"
              ? { source: { subagent: { thread_spawn: { parent_thread_id: "parent" } } } }
              : { source: "vscode" }),
          },
        }),
        state,
      );
      parseCodexLine(turnContext, state);
      const request = {
        ...counters(100, 20),
        cached_input_tokens: 30,
        cache_write_input_tokens: 10,
        reasoning_output_tokens: 5,
      };
      const cumulative = {
        ...counters(500, 60),
        cached_input_tokens: 200,
        cache_write_input_tokens: 20,
        reasoning_output_tokens: 15,
      };
      const first = counted(request, cumulative);
      expect(parseCodexLine(first, state)).toMatchObject({
        sessionId: "child",
        totals: {
          uncachedInputTokens: 60,
          cachedInputTokens: 30,
          cacheCreationTokens: 10,
          outputTokens: 20,
          reasoningTokens: 5,
        },
      });
      expect(parseCodexLine(first, state)).toBeNull();
      expect(parseCodexLine(counted(counters(10, 2), cumulative), state)).toBeNull();
      expect(
        parseCodexLine(
          counted(counters(10, 2), {
            ...cumulative,
            input_tokens: 510,
            output_tokens: 62,
            total_tokens: 572,
          }),
          state,
        )?.totals.outputTokens,
      ).toBe(2);
      expect(codexUsageFormat.readMalformedRecords?.(state)).toBe(0);
    },
  );

  it.each([
    {
      ...counters(90, 40),
      cached_input_tokens: 60,
      cache_write_input_tokens: 20,
      reasoning_output_tokens: 10,
    },
    {
      ...counters(200, 10),
      cached_input_tokens: 60,
      cache_write_input_tokens: 20,
      reasoning_output_tokens: 5,
    },
    {
      ...counters(200, 40),
      cached_input_tokens: 20,
      cache_write_input_tokens: 20,
      reasoning_output_tokens: 10,
    },
    {
      ...counters(200, 40),
      cached_input_tokens: 60,
      cache_write_input_tokens: 5,
      reasoning_output_tokens: 10,
    },
    {
      ...counters(200, 40),
      cached_input_tokens: 60,
      cache_write_input_tokens: 20,
      reasoning_output_tokens: 3,
    },
    {
      ...counters(110, 40),
      cached_input_tokens: 60,
      cache_write_input_tokens: 20,
      reasoning_output_tokens: 10,
    },
    {
      ...counters(200, 30),
      cached_input_tokens: 60,
      cache_write_input_tokens: 20,
      reasoning_output_tokens: 20,
    },
  ])("rejects an initial snapshot with an impossible inherited baseline: %j", (cumulative) => {
    const state = initialCodexScanState();
    parseCodexLine(turnContext, state);
    const request = {
      ...counters(100, 20),
      cached_input_tokens: 30,
      cache_write_input_tokens: 10,
      reasoning_output_tokens: 5,
    };
    expect(parseCodexLine(counted(request, cumulative), state)).toBeNull();
    expect(codexUsageFormat.readMalformedRecords?.(state)).toBe(1);
    expect(state.lastCumulativeUsage).toEqual(cumulative);
  });

  it.each(["request", "cumulative"])("skips malformed %s counters and recovers", (malformed) => {
    const state = initialCodexScanState();
    parseCodexLine(turnContext, state);
    const request = counters(100, 20);
    parseCodexLine(counted(request, request), state);
    expect(
      parseCodexLine(
        counted(
          malformed === "request" ? { ...request, cached_input_tokens: -1 } : request,
          malformed === "cumulative"
            ? { ...counters(200, 40), output_tokens: "40" }
            : counters(200, 40),
        ),
        state,
      ),
    ).toBeNull();
    expect(codexUsageFormat.readMalformedRecords?.(state)).toBe(1);
    expect(
      parseCodexLine(
        counted(request, malformed === "request" ? counters(300, 60) : counters(200, 40)),
        state,
      )?.totals.outputTokens,
    ).toBe(20);
    expect(codexUsageFormat.readMalformedRecords?.(state)).toBe(1);
  });

  it("does not bill a context-window estimate or lose the following real request", () => {
    const state = initialCodexScanState();
    parseCodexLine(turnContext, state);
    parseCodexLine(counted(counters(100, 20), counters(100, 20)), state);
    const estimate = { ...counters(0, 0), total_tokens: 1000 };
    expect(
      parseCodexLine(
        counted({ ...estimate, total_tokens: 880 }, estimate, { model_context_window: 1000 }),
        state,
      ),
    ).toBeNull();
    expect(
      parseCodexLine(counted(counters(10, 2), { ...counters(10, 2), total_tokens: 1012 }), state)
        ?.totals.outputTokens,
    ).toBe(2);
    expect(codexUsageFormat.readMalformedRecords?.(state)).toBe(0);
  });

  it.each([false, true])(
    "accepts the post-compaction context marker without a malformed record (prior request: %s)",
    (priorRequest) => {
      const state = initialCodexScanState();
      parseCodexLine(turnContext, state);
      if (priorRequest) parseCodexLine(counted(counters(100, 20), counters(100, 20)), state);
      const marker = counted({ ...counters(0, 0), total_tokens: 26387 }, counters(0, 0), {
        model_context_window: 475000,
      });
      expect(parseCodexLine(marker, state)).toBeNull();
      expect(
        parseCodexLine(counted(counters(30, 5), counters(30, 5)), state)?.totals.outputTokens,
      ).toBe(5);
      expect(codexUsageFormat.readMalformedRecords?.(state)).toBe(0);
    },
  );

  it("bills the first request after a resume restarts the cumulative counters", () => {
    const state = initialCodexScanState();
    parseCodexLine(turnContext, state);
    parseCodexLine(counted(counters(100, 20), counters(100, 20)), state);
    expect(
      parseCodexLine(counted(counters(30, 5), counters(30, 5)), state)?.totals.outputTokens,
    ).toBe(5);
    expect(
      parseCodexLine(counted(counters(10, 2), counters(40, 7)), state)?.totals.outputTokens,
    ).toBe(2);
    expect(codexUsageFormat.readMalformedRecords?.(state)).toBe(0);
  });

  it("retains initial tier evidence only for the own OpenAI session and exact context until native settings arrive", () => {
    const meta = (id: string, model_provider?: string) =>
      JSON.stringify({ type: "session_meta", payload: { id, model_provider } });
    const context = (turn_id?: string, model?: string) =>
      JSON.stringify({ type: "turn_context", payload: { turn_id, model } });
    for (const provider of ["openai", "t3", "custom", undefined]) {
      const state = initialCodexScanState();
      parseCodexLine(meta("own-session", provider), state);
      parseCodexLine(meta("ancestor", provider === "openai" ? "custom" : "openai"), state);
      parseCodexLine(context("first-turn", "gpt-6-astra"), state);
      const first = parseCodexLine(tokenCount(100, 0, 1, 0), state);
      expect(first).toMatchObject({
        sessionId: "own-session",
        model: "gpt-6-astra",
        speed: "standard",
      });
      if (provider === "openai") {
        expect(first).toHaveProperty("unresolvedServiceTierTurnId", "first-turn");
      } else {
        expect(first).not.toHaveProperty("unresolvedServiceTierTurnId");
      }

      parseCodexLine(context(undefined, "gpt-6-astra"), state);
      expect(parseCodexLine(tokenCount(100, 0, 2, 0), state)).not.toHaveProperty(
        "unresolvedServiceTierTurnId",
      );
      parseCodexLine(context("missing-model"), state);
      expect(parseCodexLine(tokenCount(100, 0, 3, 0), state)).not.toHaveProperty(
        "unresolvedServiceTierTurnId",
      );
      parseCodexLine(context("next-turn", "gpt-6-astra"), state);
      const next = parseCodexLine(tokenCount(100, 0, 4, 0), state);
      if (provider === "openai") {
        expect(next).toHaveProperty("unresolvedServiceTierTurnId", "next-turn");
      } else {
        expect(next).not.toHaveProperty("unresolvedServiceTierTurnId");
      }
    }

    for (const service_tier of ["standard", "", undefined, "priority", "ultrafast"]) {
      const state = initialCodexScanState();
      parseCodexLine(meta("own-session", "openai"), state);
      parseCodexLine(context("first-turn", "gpt-6-astra"), state);
      expect(parseCodexLine(tokenCount(100, 0, 1, 0), state)).toHaveProperty(
        "unresolvedServiceTierTurnId",
        "first-turn",
      );
      parseCodexLine(
        JSON.stringify({
          type: "event_msg",
          payload: { type: "thread_settings_applied", thread_settings: { service_tier } },
        }),
        state,
      );
      for (const output of [2, 3]) {
        parseCodexLine(context(`native-turn-${output}`, "gpt-6-astra"), state);
        const record = parseCodexLine(tokenCount(100, 0, output, 0), state);
        expect(record?.speed).toBe(
          service_tier === "priority"
            ? "fast"
            : service_tier === "ultrafast"
              ? "ultrafast"
              : "standard",
        );
        expect(record).not.toHaveProperty("unresolvedServiceTierTurnId");
      }
    }
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
  // metas. Counting those again multiplied usage ~1.85x on real data.
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

    it("drops the re-stamped copied burst and keeps the first real event", () => {
      const state = initialCodexScanState();
      const forkInstant = "2026-08-01T05:00:00.000Z";
      parseCodexLine(meta({ id: "child", timestamp: forkInstant, forkedFromId: "parent" }), state);
      parseCodexLine(meta({ id: "parent", timestamp: forkInstant }), state);
      parseCodexLine(stamped(forkInstant, turnContext), state);

      expect(
        parseCodexLine(
          stamped("2026-08-01T05:00:00.001Z", counted(counters(100, 10), counters(100, 10))),
          state,
        ),
      ).toBeNull();
      expect(
        parseCodexLine(
          stamped("2026-08-01T05:00:00.002Z", counted(counters(200, 20), counters(300, 30))),
          state,
        ),
      ).toBeNull();

      const real = parseCodexLine(
        stamped("2026-08-01T05:00:06.000Z", counted(counters(200, 20), counters(500, 50))),
        state,
      );
      expect(real).not.toBeNull();
      expect(real?.sessionId).toBe("child");
      expect(real?.totals.outputTokens).toBe(20);

      const next = parseCodexLine(
        stamped("2026-08-01T05:00:06.100Z", counted(counters(400, 40), counters(900, 90))),
        state,
      );
      expect(next).not.toBeNull();
      expect(codexUsageFormat.readMalformedRecords?.(state)).toBe(0);
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
