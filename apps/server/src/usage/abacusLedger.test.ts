import { describe, expect, it } from "@effect/vitest";

import { abacusLedgerModel, abacusLedgerRecords, mergeAbacusLedger } from "./abacusLedger.ts";

// Shape returned by `_getOrganizationComputePointLog` with `byLlm: true`.
const columns = {
  date: "Date",
  total: "Total",
  GEMINI_4_ARGON: "Gemini 4 Argon",
  ZAI_GLM_5_3_FLASH: "GLM 5.3 Flash",
  MUSE_WONDER_1_0: "Muse Wonder",
  CLAUDE_V5_5_HAIKU: "Claude Haiku 5.5",
  XAI_GROK_4_7: "Grok 4.7",
  web_search: "Web Search",
};
const known = [
  "gemini-4-argon",
  "glm-5.3-flash",
  "muse-wonder-1.0",
  "grok-4.7",
  "claude-haiku-5-5",
];

describe("Abacus billing ledger", () => {
  it("maps ledger columns onto the model names T3 records", () => {
    const mapped = Object.entries(columns)
      .filter(([key]) => key !== "date" && key !== "total")
      .map(([key, label]) => abacusLedgerModel(key, label, known));

    expect(mapped).toEqual([
      "gemini-4-argon",
      "glm-5.3-flash",
      "muse-wonder-1.0",
      "claude-haiku-5-5",
      "grok-4.7",
      "web-search",
    ]);
  });

  it("turns each day's charges into credit records on their UTC billing day", () => {
    const records = abacusLedgerRecords(
      {
        columns,
        log: [
          {
            date: "2026-10-17",
            total: 13558.16,
            non_conversation: { "RouteLLM API": 13558.16 },
            GEMINI_4_ARGON: 13550,
            web_search: 8.16,
            XAI_GROK_4_7: 0,
          },
        ],
      },
      "account",
      known,
    );

    expect(
      records.map(({ model, credits, billingDay }) => ({ model, credits, billingDay })),
    ).toEqual([
      { model: "gemini-4-argon", credits: 13550, billingDay: "2026-10-17" },
      { model: "web-search", credits: 8.16, billingDay: "2026-10-17" },
    ]);
    expect(records[0]?.reportedCostUsd).toBeCloseTo(6.775);
  });

  it("replaces refreshed days and keeps days that aged out of the response", () => {
    const merged = mergeAbacusLedger(
      {
        columns,
        log: [
          { date: "2026-09-01", GEMINI_4_ARGON: 5 },
          { date: "2026-10-18", GEMINI_4_ARGON: 16.56 },
        ],
      },
      { columns, log: [{ date: "2026-10-18", GEMINI_4_ARGON: 16.81 }] },
    );

    expect(merged.log).toEqual([
      { date: "2026-10-18", GEMINI_4_ARGON: 16.81 },
      { date: "2026-09-01", GEMINI_4_ARGON: 5 },
    ]);
  });
});
