import type {
  ProviderUsageLimitsUpdate,
  ServerProviderCredits,
  ServerProviderResetCredits,
  ServerProviderUsageLimits,
  ServerProviderUsageWindow,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import type * as CodexErrors from "effect-codex-app-server/errors";

import { clampPercent, makeUsageLimits } from "@t3tools/provider-core/server/usageLimits";

interface CodexRateLimitWindow {
  readonly usedPercent: number;
  readonly resetsAt?: number | null;
  readonly windowDurationMins?: number | null;
}

export interface CodexRateLimitSnapshot {
  readonly limitId?: string | null;
  readonly planType?: string | null;
  readonly rateLimitReachedType?: string | null;
  readonly primary?: CodexRateLimitWindow | null;
  readonly secondary?: CodexRateLimitWindow | null;
  readonly credits?: {
    readonly hasCredits: boolean;
    readonly unlimited: boolean;
    readonly balance?: string | null;
  } | null;
  readonly individualLimit?: {
    readonly remainingPercent: number;
    readonly resetsAt: number;
  } | null;
}

export interface CodexResetCreditsSummary {
  readonly availableCount: number;
  readonly credits?: ReadonlyArray<{
    readonly status: string;
    readonly expiresAt?: number | null;
  }> | null;
}

const SESSION_MINS = 5 * 60;
const WEEK_MINS = 7 * 24 * 60;
const MONTH_MINS = 30 * 24 * 60;

function isoFromEpochSeconds(value: number | null | undefined): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  const dt = DateTime.make(value * 1000);
  return Option.isSome(dt) ? DateTime.formatIso(dt.value) : undefined;
}

function kindForDuration(mins: number): ServerProviderUsageWindow["kind"] {
  if (mins >= MONTH_MINS) return "monthly";
  if (mins >= WEEK_MINS) return "weekly";
  return "session";
}

function labelForDuration(mins: number): string {
  if (mins >= MONTH_MINS) return "Monthly";
  if (mins >= WEEK_MINS) return "Weekly";
  return "Session";
}

function windowDurationMins(
  window: CodexRateLimitWindow,
  fallbackMins: number,
): number | undefined {
  if (
    typeof window.windowDurationMins === "number" &&
    Number.isFinite(window.windowDurationMins) &&
    window.windowDurationMins > 0
  ) {
    return window.windowDurationMins;
  }
  return fallbackMins;
}

function mapWindow(
  id: string,
  window: CodexRateLimitWindow,
  fallbackMins: number,
): ServerProviderUsageWindow {
  const duration = windowDurationMins(window, fallbackMins);
  const resetsAt = isoFromEpochSeconds(window.resetsAt);
  return {
    id,
    kind: kindForDuration(duration ?? fallbackMins),
    label: labelForDuration(duration ?? fallbackMins),
    usedPercent: clampPercent(window.usedPercent),
    ...(resetsAt ? { resetsAt } : {}),
    ...(duration ? { windowDurationMins: duration } : {}),
  };
}

/** primary/secondary are positions; without windowDurationMins, paid plans use 5-hour/weekly windows and Free/Go use monthly. */
function codexRateLimitsToWindows(
  snapshot: CodexRateLimitSnapshot,
): ReadonlyArray<ServerProviderUsageWindow> {
  // Keep model-specific limits out of main allowance rows; older CLIs omit limit IDs.
  if (snapshot.limitId && snapshot.limitId !== "codex") return [];
  const windows: ServerProviderUsageWindow[] = [];
  if (snapshot.primary) {
    // Primary with no duration is 5h on Plus/Team/Enterprise and 30d on Free/Go.
    const fallbackMins =
      snapshot.planType === "free" || snapshot.planType === "go" ? MONTH_MINS : SESSION_MINS;
    windows.push(mapWindow("primary", snapshot.primary, fallbackMins));
  }
  if (snapshot.secondary) {
    windows.push(mapWindow("secondary", snapshot.secondary, WEEK_MINS));
  }
  const individualLimit = snapshot.individualLimit;
  if (individualLimit && Number.isFinite(individualLimit.remainingPercent)) {
    const resetsAt = isoFromEpochSeconds(individualLimit.resetsAt);
    windows.push({
      id: "individual",
      kind: "monthly",
      label: "Monthly credit limit",
      usedPercent: clampPercent(100 - individualLimit.remainingPercent),
      ...(resetsAt ? { resetsAt } : {}),
    });
  }
  return windows;
}

export function codexCreditsToContract(
  credits: CodexRateLimitSnapshot["credits"],
): ServerProviderCredits | undefined {
  if (!credits) return undefined;
  const balanceNum = typeof credits.balance === "string" ? parseFloat(credits.balance) : undefined;
  return {
    hasCredits: credits.hasCredits,
    unlimited: credits.unlimited,
    ...(balanceNum !== undefined && Number.isFinite(balanceNum)
      ? { balance: Math.round(balanceNum * 100) / 100 }
      : {}),
  };
}

function codexResetCreditsToContract(
  summary: CodexResetCreditsSummary | null | undefined,
): ServerProviderResetCredits | undefined {
  if (!summary) return undefined;
  const expiries = (summary.credits ?? [])
    .filter((credit) => credit.status === "available")
    .map((credit) => credit.expiresAt)
    .filter((value): value is number => typeof value === "number");
  const nextExpiresAt =
    expiries.length > 0 ? isoFromEpochSeconds(Math.min(...expiries)) : undefined;
  return {
    availableCount: Math.max(0, summary.availableCount),
    ...(nextExpiresAt ? { nextExpiresAt } : {}),
  };
}

export function codexRateLimitsToLimits(input: {
  readonly snapshot: CodexRateLimitSnapshot;
  readonly rateLimitsByLimitId?:
    | Readonly<Record<string, CodexRateLimitSnapshot>>
    | null
    | undefined;
  readonly resetCredits?: CodexResetCreditsSummary | null | undefined;
  readonly checkedAt: string;
}): ServerProviderUsageLimits {
  const resetCredits = codexResetCreditsToContract(input.resetCredits);
  const mainSnapshot = input.rateLimitsByLimitId?.codex ?? input.snapshot;
  const windows = codexRateLimitsToWindows(mainSnapshot);
  const credits = codexCreditsToContract(mainSnapshot.credits ?? input.snapshot.credits);
  return {
    ...makeUsageLimits({
      checkedAt: input.checkedAt,
      windows,
    }),
    ...(resetCredits ? { resetCredits } : {}),
    ...(credits ? { credits } : {}),
  };
}

export function codexRateLimitsToUpdate(
  snapshot: CodexRateLimitSnapshot,
  previous?: CodexRateLimitSnapshot,
): ProviderUsageLimitsUpdate | undefined {
  const previousWindows = previous ? codexRateLimitsToWindows(previous) : [];
  // Token ticks repeat session-cached limits that may predate an account probe or reset.
  const windows = codexRateLimitsToWindows(snapshot).filter((window) => {
    const existing = previousWindows.find((candidate) => candidate.id === window.id);
    return (
      !existing ||
      existing.kind !== window.kind ||
      existing.usedPercent !== window.usedPercent ||
      existing.resetsAt !== window.resetsAt ||
      existing.windowDurationMins !== window.windowDurationMins
    );
  });
  const credits = codexCreditsToContract(snapshot.credits);
  const previousCredits = previous ? codexCreditsToContract(previous.credits) : undefined;
  const creditsChanged =
    credits !== undefined && JSON.stringify(credits) !== JSON.stringify(previousCredits);
  return windows.length > 0 || creditsChanged
    ? { windows, ...(creditsChanged ? { credits } : {}) }
    : undefined;
}

export function codexRateLimitsFailureMessage(error: CodexErrors.CodexAppServerError): string {
  switch (error._tag) {
    case "CodexAppServerRequestError":
      return `Codex could not read usage (JSON-RPC ${error.code}).`;
    case "CodexAppServerSpawnError":
      return "Codex could not be started to read usage.";
    case "CodexAppServerProcessExitedError":
      return "Codex exited before it could report usage.";
    default:
      return "Codex did not answer the usage request.";
  }
}

/** Rate-limit notifications are partial: omitted fields preserve earlier session values. */
export function mergeCodexRateLimits(
  previous: CodexRateLimitSnapshot | undefined,
  update: CodexRateLimitSnapshot,
): CodexRateLimitSnapshot | undefined {
  // Model-specific snapshots must not overwrite the main allowance.
  if (update.limitId && update.limitId !== "codex") return previous;
  if (!previous) return update;
  return {
    ...previous,
    ...(update.limitId !== undefined ? { limitId: update.limitId } : {}),
    ...(update.planType !== undefined ? { planType: update.planType } : {}),
    ...(update.rateLimitReachedType !== undefined
      ? { rateLimitReachedType: update.rateLimitReachedType }
      : {}),
    ...(update.primary !== undefined ? { primary: update.primary } : {}),
    ...(update.secondary !== undefined ? { secondary: update.secondary } : {}),
    ...(update.credits !== undefined ? { credits: update.credits } : {}),
    ...(update.individualLimit !== undefined ? { individualLimit: update.individualLimit } : {}),
  };
}

/** All exhausted windows must reset before a continuation can run. */
export function codexUsageLimitResetAt(
  snapshot: CodexRateLimitSnapshot | undefined,
): string | null {
  if (!snapshot) return null;
  const windows = codexRateLimitsToWindows(snapshot).filter((window) => window.usedPercent >= 100);
  if (windows.length === 0 || windows.some((window) => !window.resetsAt)) return null;
  return windows.reduce<string | null>(
    (latest, window) =>
      latest === null || Date.parse(window.resetsAt!) > Date.parse(latest)
        ? window.resetsAt!
        : latest,
    null,
  );
}
