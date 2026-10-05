import type { RuntimeMode } from "./orchestration.ts";

const ALL_RUNTIME_MODES: ReadonlyArray<RuntimeMode> = [
  "approval-required",
  "auto-accept-edits",
  "auto",
  "full-access",
];
const ANTIGRAVITY_RUNTIME_MODES: ReadonlyArray<RuntimeMode> = ["full-access"];

/** Keep the thread's permission preference so another provider can restore it. */
export function resolveProviderRuntimeMode(
  driver: string | undefined,
  preferredMode: RuntimeMode,
): RuntimeMode {
  return driver === "antigravity" ? "full-access" : preferredMode;
}

export function getProviderRuntimeModes(driver: string | undefined): ReadonlyArray<RuntimeMode> {
  return driver === "antigravity" ? ANTIGRAVITY_RUNTIME_MODES : ALL_RUNTIME_MODES;
}
