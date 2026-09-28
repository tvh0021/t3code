import type { ProviderDriverKind } from "@t3tools/contracts";

/** Parent providers must forward T3 tools; children rely on server-side role checks. */
export function coordinationProviderIssue(
  driver: ProviderDriverKind,
  role: "parent" | "child" = "parent",
): string | undefined {
  if (["codex", "claudeAgent", "abacus", "zed"].includes(driver)) return undefined;
  // Antigravity can run as a child: completion is reported by the server, and
  // its ACP adapter does not expose T3 thread tools that could start a nested workflow.
  if (role === "child" && driver === "antigravity") return undefined;
  return role === "parent"
    ? `${driver} does not forward T3 workflow tools. Use a supported provider instance as the parent; ordinary handoff threads remain available.`
    : `${driver} cannot safely run as a workflow child. Use a supported provider instance; ordinary handoff threads remain available.`;
}
