import type { ProviderDriverKind } from "@t3tools/contracts";

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
