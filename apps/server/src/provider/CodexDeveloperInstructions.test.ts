// @effect-diagnostics nodeBuiltinImport:off -- Writes fixture files for the synchronous user-rules reader.
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { T3_CODE_ORCHESTRATION_SECTIONS } from "@t3tools/provider-core/server/orchestrationInstructions";
import { USER_ORCHESTRATION_INSTRUCTIONS_ENV } from "@t3tools/provider-core/server/userOrchestrationInstructions";
import { afterAll, beforeAll, describe, it } from "vite-plus/test";

import {
  buildCodexAdditionalContext,
  CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES,
} from "./CodexDeveloperInstructions.ts";

let userRulesDir: string;
beforeAll(() => {
  userRulesDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-codex-rules-"));
  process.env[USER_ORCHESTRATION_INSTRUCTIONS_ENV] = NodePath.join(
    userRulesDir,
    "ORCHESTRATION.md",
  );
});
afterAll(() => {
  delete process.env[USER_ORCHESTRATION_INSTRUCTIONS_ENV];
  NodeFS.rmSync(userRulesDir, { recursive: true, force: true });
});

describe("buildCodexAdditionalContext", () => {
  describe.each([
    { model: "custom-model", modelName: "Custom 🦊 Model", reasoningEffort: "xhigh" },
  ])("with runtime $model", (runtime) => {
    it.each([undefined, { browser: true, device: true }])(
      "keeps every entry within Codex's per-entry cap with tools %j",
      (availability) => {
        const context = buildCodexAdditionalContext(runtime, availability);

        for (const [key, entry] of Object.entries(context)) {
          // Codex counts ceil(UTF-8 bytes / 4) tokens, excluding keys and wrappers.
          const bytes = Buffer.byteLength(entry.value, "utf8");
          const limit = CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES;
          NodeAssert.ok(
            bytes <= limit,
            `${key}: ${bytes} UTF-8 bytes exceeds Codex's ${limit}-byte per-entry cap by ${bytes - limit} bytes; split the instructions into separate entries to avoid silent truncation`,
          );
        }
      },
    );
  });
});

describe("Codex runtime context", () => {
  it("describes Markdown media support in the runtime context in both modes", () => {
    {
      const instructions = runtimeInstructions({
        model: "gpt-5.3-codex",
        reasoningEffort: "high",
      });
      NodeAssert.match(
        instructions,
        /<runtime_info>.*embed images, video, and audio.*Markdown image syntax with absolute file paths.*Link any other file.*absolute path.*files viewer.*<\/runtime_info>/,
      );
    }
  });

  it("flattens multiline metadata into single-line runtime info", () => {
    const instructions = runtimeInstructions({
      model: "gpt\n5.3\ncodex",
      reasoningEffort: " high\neffort ",
    });

    NodeAssert.match(instructions, /as gpt 5\.3 codex with high effort reasoning effort/);
    NodeAssert.doesNotMatch(instructions, /<runtime_info>[^<]*\n/);
  });
});

describe("Codex orchestration context", () => {
  it("routes subagents native first, delegate_task for the rest", () => {
    const orchestration = Object.entries(buildCodexAdditionalContext({ model: "gpt-6.1-sol" }))
      .filter(([key]) => key.startsWith("t3_code_orchestration_"))
      .map(([, entry]) => entry.value)
      .join("\n");

    NodeAssert.ok(orchestration.includes("use your native tool when the child uses your provider"));
    NodeAssert.ok(orchestration.includes("`run_in_background:false`"));
    NodeAssert.ok(orchestration.includes("A native type running another provider's model"));
    NodeAssert.ok(
      orchestration.includes("Every new delegate review or re-check is a new `delegate_task`"),
    );
    NodeAssert.ok(orchestration.includes("never a `t3_thread_send`"));
    NodeAssert.ok(!orchestration.includes("inheritedOptions"));
    NodeAssert.ok(!orchestration.includes("Prefer native"));
    // The ACP terminal fallback is ACP-only; Codex agents never need it.
    NodeAssert.ok(!orchestration.includes("acp-mcp-call"));
  });
});

function runtimeInstructions(runtime: Parameters<typeof buildCodexAdditionalContext>[0]) {
  return buildCodexAdditionalContext(runtime).t3_code_runtime!.value;
}
describe("buildCodexAdditionalContext with user orchestration rules", () => {
  it("keeps every entry under the cap when the user's file is large", () => {
    const path = process.env[USER_ORCHESTRATION_INSTRUCTIONS_ENV]!;
    const paragraph = "Delegate research to Opus at medium effort. ".repeat(20);
    NodeFS.writeFileSync(path, Array.from({ length: 30 }, () => paragraph).join("\n\n"));
    try {
      const context = buildCodexAdditionalContext({
        model: "gpt-5.3-codex",
        reasoningEffort: "high",
      });
      const sections = Object.keys(context)
        .filter((key) => key.startsWith("t3_code_orchestration_"))
        .sort()
        .map((key) => context[key]!.value);

      NodeAssert.ok(sections.length > T3_CODE_ORCHESTRATION_SECTIONS.length + 1);
      NodeAssert.match(sections.join("\n\n"), /## User orchestration rules/);
      for (const value of sections) {
        NodeAssert.ok(Buffer.byteLength(value, "utf8") <= CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES);
      }
    } finally {
      NodeFS.rmSync(path, { force: true });
    }
  });
});
