import type { UsageProviderKind } from "@t3tools/contracts";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";

/**
 * Series and table order. The chart stacks providers from the bottom in this
 * order, so it also fixes which band sits on top of the bars.
 */
export const PROVIDER_ORDER: readonly UsageProviderKind[] = [
  "codex",
  "claude",
  "grok",
  "antigravity",
  "abacus",
];

export const PROVIDER_LABEL: Record<UsageProviderKind, string> = {
  claude: "Claude Code",
  codex: "Codex",
  grok: "Grok Build",
  antigravity: "Antigravity",
  abacus: "ChatLLM",
};

export const DRIVER_LABEL: Record<string, string> = {
  codex: "Codex",
  claudeAgent: "Claude",
  zed: "Zed",
  antigravity: "Antigravity",
  abacus: "ChatLLM",
  chatllm: "ChatLLM",
};

export function getDriverLabel(driver: string): string {
  const normalized = driver.trim().toLowerCase();
  if (normalized === "claudeagent") return "Claude";
  return DRIVER_LABEL[normalized] ?? DRIVER_LABEL[driver] ?? driver;
}

/**
 * Claude's brand orange holds in both themes; Codex and Grok are neutrals and
 * must flip with the theme or their bars vanish against the matching background.
 */
export function useProviderColors(): Record<UsageProviderKind, string> {
  const { themeAppearance: scheme } = useAppearancePreferences();
  return {
    claude: "#d97757",
    codex: scheme === "dark" ? "#e6e6e6" : "#3c3c43",
    grok: scheme === "dark" ? "#a1a1aa" : "#52525b",
    antigravity: "#4285f4",
    abacus: "#8b5cf6",
  };
}
