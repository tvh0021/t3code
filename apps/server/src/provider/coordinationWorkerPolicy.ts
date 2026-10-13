import {
  coordinationModelKey,
  type ProviderDriverKind,
  type RuntimeMode,
} from "@t3tools/contracts";

/** Parent providers must forward T3 tools; children rely on server-side role checks. */
export function coordinationProviderIssue(
  driver: ProviderDriverKind,
  role: "parent" | "child" = "parent",
): string | undefined {
  if (["codex", "claudeAgent", "abacus", "zed", "antigravity"].includes(driver)) return undefined;
  return role === "parent"
    ? `${driver} does not forward T3 orchestration layer tools. Use a supported provider instance as the parent; ordinary handoff threads remain available.`
    : `${driver} cannot safely run as a T3 orchestration layer child. Use a supported provider instance; ordinary handoff threads remain available.`;
}

export function isGptModel(model: string): boolean {
  return coordinationModelKey(model).startsWith("gpt-");
}

export function resolveChildRuntimeMode(input: {
  readonly mode: "edit" | "review";
  readonly parentRuntimeMode: RuntimeMode;
  readonly childModel?: string | undefined;
  readonly childDriver?: string | undefined;
}): RuntimeMode {
  if (input.childDriver === "antigravity") {
    return "full-access";
  }
  const gptChild = input.childModel !== undefined && isGptModel(input.childModel);
  return input.mode === "review" && !gptChild ? "approval-required" : input.parentRuntimeMode;
}

export const COORDINATION_CHILD_TOOL_NAMES: ReadonlySet<string> = new Set([
  "report_to_parent",
  "read_orchestration_layer",
  "read_thread",
]);
