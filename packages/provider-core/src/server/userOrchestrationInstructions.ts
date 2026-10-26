// @effect-diagnostics nodeBuiltinImport:off -- Prompt builders are plain synchronous functions; this reads one small user file per call.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

export const USER_ORCHESTRATION_INSTRUCTIONS_ENV = "T3_USER_ORCHESTRATION_INSTRUCTIONS";

/**
 * Codex cuts the middle out of any instruction entry over 4,000 bytes, so each
 * section stays under it with room for the key Codex wraps around it.
 */
const SECTION_MAX_BYTES = 3_800;

export function userOrchestrationInstructionsPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[USER_ORCHESTRATION_INSTRUCTIONS_ENV]?.trim();
  return override ? override : NodePath.join(NodeOS.homedir(), ".agents", "ORCHESTRATION.md");
}

/**
 * Read on every call so an edit reaches the next session or turn without a
 * rebuild. A missing or empty file adds nothing.
 */
export function readUserOrchestrationSections(
  path: string = userOrchestrationInstructionsPath(),
): ReadonlyArray<string> {
  let text: string;
  try {
    text = NodeFS.readFileSync(path, "utf8").trim();
  } catch {
    return [];
  }
  if (text.length === 0) return [];
  return packSections(
    `## User orchestration rules\n\nThe user keeps these rules in \`${path}\`. They apply to every provider and model, and to work you delegate.\n\n${text}`,
  );
}

const byteLength = (text: string): number => Buffer.byteLength(text, "utf8");

/** Packs paragraphs in order; a paragraph too large on its own is split by line. */
function packSections(text: string): ReadonlyArray<string> {
  const pieces = text
    .split(/\n{2,}/)
    .flatMap((paragraph) =>
      byteLength(paragraph) <= SECTION_MAX_BYTES ? [paragraph] : paragraph.split("\n"),
    );
  const sections: Array<string> = [];
  let current = "";
  for (const piece of pieces) {
    const candidate = current.length === 0 ? piece : `${current}\n\n${piece}`;
    if (current.length > 0 && byteLength(candidate) > SECTION_MAX_BYTES) {
      sections.push(current);
      current = piece;
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) sections.push(current);
  return sections;
}
