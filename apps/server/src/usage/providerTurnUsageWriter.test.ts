// @effect-diagnostics nodeBuiltinImport:off globalDate:off
import { describe, expect, it } from "@effect/vitest";
import * as NodeFS from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { appendProviderTurnUsage } from "./providerTurnUsageWriter.ts";
import { initialCodexScanState, parseCodexLine } from "./usageTranscripts.ts";

describe("providerTurnUsageWriter", () => {
  it("writes valid jsonl for antigravity and abacus that can be parsed by parseCodexLine", async () => {
    const tmpDir = await NodeFS.mkdtemp(NodePath.join(NodeOS.tmpdir(), "usage-turn-test-"));
    try {
      await appendProviderTurnUsage({
        stateDir: tmpDir,
        provider: "antigravity",
        sessionId: "sess-anti-1",
        turnId: "turn-1",
        model: "gemini-2.5-pro",
        tokens: {
          inputTokens: 100,
          cachedInputTokens: 20,
          outputTokens: 50,
          reasoningTokens: 10,
        },
        timestamp: "2026-08-01T12:00:00.000Z",
      });

      const filePath = NodePath.join(
        tmpDir,
        "usage",
        "antigravity",
        "sessions",
        "sess-anti-1.jsonl",
      );
      const content = await NodeFS.readFile(filePath, "utf8");
      const lines = content.trim().split("\n");
      expect(lines.length).toBe(3);

      const state = initialCodexScanState();
      const records = [];
      for (const line of lines) {
        const record = parseCodexLine(line, state, "antigravity");
        if (record) records.push(record);
      }

      expect(records.length).toBe(1);
      expect(records[0]?.provider).toBe("antigravity");
      expect(records[0]?.model).toBe("gemini-2.5-pro");
      expect(records[0]?.totals.uncachedInputTokens).toBe(100);
      expect(records[0]?.totals.cachedInputTokens).toBe(20);
      expect(records[0]?.totals.outputTokens).toBe(50);
      expect(records[0]?.totals.reasoningTokens).toBe(10);
    } finally {
      await NodeFS.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("appends subsequent turns to the same session file without duplicating session_meta", async () => {
    const tmpDir = await NodeFS.mkdtemp(NodePath.join(NodeOS.tmpdir(), "usage-turn-test-"));
    try {
      await appendProviderTurnUsage({
        stateDir: tmpDir,
        provider: "abacus",
        sessionId: "sess-abacus-1",
        turnId: "turn-1",
        model: "route-llm",
        tokens: {
          inputTokens: 50,
          outputTokens: 25,
        },
        timestamp: "2026-08-01T12:00:00.000Z",
      });

      await appendProviderTurnUsage({
        stateDir: tmpDir,
        provider: "abacus",
        sessionId: "sess-abacus-1",
        turnId: "turn-2",
        model: "route-llm",
        tokens: {
          inputTokens: 70,
          outputTokens: 30,
        },
        timestamp: "2026-08-01T12:05:00.000Z",
      });

      const filePath = NodePath.join(tmpDir, "usage", "abacus", "sessions", "sess-abacus-1.jsonl");
      const content = await NodeFS.readFile(filePath, "utf8");
      const lines = content.trim().split("\n");
      // 1 session_meta + 2 turns (each turn = turn_context + token_count) = 5 lines
      expect(lines.length).toBe(5);

      const state = initialCodexScanState();
      const records = [];
      for (const line of lines) {
        const record = parseCodexLine(line, state, "abacus");
        if (record) records.push(record);
      }

      expect(records.length).toBe(2);
      expect(records[0]?.provider).toBe("abacus");
      expect(records[0]?.totals.uncachedInputTokens).toBe(50);
      expect(records[0]?.totals.outputTokens).toBe(25);

      expect(records[1]?.provider).toBe("abacus");
      expect(records[1]?.totals.uncachedInputTokens).toBe(70);
      expect(records[1]?.totals.outputTokens).toBe(30);
    } finally {
      await NodeFS.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
