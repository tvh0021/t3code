import { describe, expect, it } from "vite-plus/test";
import {
  formatCoordinationQuotaHandoffs,
  parseCoordinationQuotaHandoffs,
} from "./coordinationQuotaHandoffs.ts";

describe("coordination quota fallback settings", () => {
  it("round-trips ordered model fallback rules", () => {
    const rules = { "gpt-6-sol": ["claude-opus-5", "claude-sonnet-5"] };
    expect(parseCoordinationQuotaHandoffs(formatCoordinationQuotaHandoffs(rules))).toEqual(rules);
  });

  it("rejects malformed and duplicate source rules", () => {
    expect(() => parseCoordinationQuotaHandoffs("gpt-6-sol=opus\ngpt-6-sol=fable")).toThrow(
      /appears more than once/,
    );
    expect(() => parseCoordinationQuotaHandoffs("gpt-6-sol=")).toThrow(/use source-model/);
  });
});
