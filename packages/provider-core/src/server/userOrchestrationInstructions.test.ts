// @effect-diagnostics nodeBuiltinImport:off -- Writes fixture files for the synchronous reader.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";

import {
  T3_CODE_ORCHESTRATION_SECTIONS,
  t3OrchestrationPromptForFirstRun,
  t3OrchestrationSections,
  t3OrchestrationSystemPrompt,
} from "./orchestrationInstructions.ts";
import {
  readUserOrchestrationSections,
  USER_ORCHESTRATION_INSTRUCTIONS_ENV,
  userOrchestrationInstructionsPath,
} from "./userOrchestrationInstructions.ts";

describe("user orchestration instructions", () => {
  it("defaults to ~/.agents/ORCHESTRATION.md and honors the override", () => {
    assert.equal(
      userOrchestrationInstructionsPath({}),
      NodePath.join(NodeOS.homedir(), ".agents", "ORCHESTRATION.md"),
    );
    assert.equal(
      userOrchestrationInstructionsPath({ [USER_ORCHESTRATION_INSTRUCTIONS_ENV]: "/tmp/rules.md" }),
      "/tmp/rules.md",
    );
  });

  it("adds nothing for a missing or blank file", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-user-rules-"));
    try {
      const path = NodePath.join(dir, "ORCHESTRATION.md");
      assert.deepEqual(readUserOrchestrationSections(path), []);
      NodeFS.writeFileSync(path, "  \n\n ");
      assert.deepEqual(readUserOrchestrationSections(path), []);
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("splits a large file into ordered sections under the byte cap", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-user-rules-"));
    try {
      const path = NodePath.join(dir, "ORCHESTRATION.md");
      const paragraphs = Array.from({ length: 40 }, (_, i) => `Rule ${i}. ${"x".repeat(300)}`);
      NodeFS.writeFileSync(path, paragraphs.join("\n\n"));
      const sections = readUserOrchestrationSections(path);

      assert.isAbove(sections.length, 1);
      assert.match(sections[0]!, /^## User orchestration rules/);
      for (const section of sections) assert.isAtMost(Buffer.byteLength(section), 3_800);
      assert.include(sections.join("\n\n"), paragraphs.join("\n\n"));
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("appends the user's file to the provider instructions and rereads it on each call", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-user-rules-"));
    const path = NodePath.join(dir, "ORCHESTRATION.md");
    process.env[USER_ORCHESTRATION_INSTRUCTIONS_ENV] = path;
    try {
      assert.deepEqual(t3OrchestrationSections(), T3_CODE_ORCHESTRATION_SECTIONS);

      NodeFS.writeFileSync(path, "Delegate research to Opus.");
      assert.include(t3OrchestrationSystemPrompt(true), "## User orchestration rules");
      assert.include(t3OrchestrationSystemPrompt(true), "Delegate research to Opus.");

      NodeFS.writeFileSync(path, "Delegate research to Sonnet.");
      const prompt = t3OrchestrationPromptForFirstRun({
        prompt: "Go.",
        runOrdinal: 1,
        hasT3Mcp: true,
      });
      assert.include(prompt, "Delegate research to Sonnet.");
      assert.notInclude(prompt, "Delegate research to Opus.");
    } finally {
      delete process.env[USER_ORCHESTRATION_INSTRUCTIONS_ENV];
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });
});
