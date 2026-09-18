import type { ServerProvider } from "@t3tools/contracts";
import {
  defaultInstanceIdForDriver,
  PROVIDER_DISPLAY_NAMES,
  type ProviderDriverKind,
} from "@t3tools/contracts";

function humanizeSlug(slug: string): string {
  return slug
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

/**
 * Multiple instances of the same driver can be configured (e.g. Work and
 * Personal Codex). An instance is identified by its `instanceId`, but the UI
 * renders a human-readable label. The label resolution priority is:
 *
 *   1. A snapshot `displayName` that differs from the driver's brand label —
 *      the server has explicitly named this instance, trust it.
 *   2. For non-default instances, a humanized `instanceId` — the server fell
 *      back to the driver-level label (the same for every instance of that
 *      kind), so the slug is what keeps "Codex" and "Codex Personal" apart.
 *   3. The snapshot's `displayName`, or the brand label from contracts.
 */
export function resolveProviderInstanceDisplayName(
  snapshot: Pick<ServerProvider, "instanceId" | "driver" | "displayName">,
): string {
  const trimmedSnapshotName = snapshot.displayName?.trim();
  const kindLabel = PROVIDER_DISPLAY_NAMES[snapshot.driver] ?? humanizeSlug(snapshot.driver);
  const isLegacyDriverName =
    snapshot.driver === "abacus" && trimmedSnapshotName?.toLowerCase() === "abacus";
  if (trimmedSnapshotName && trimmedSnapshotName !== kindLabel && !isLegacyDriverName)
    return trimmedSnapshotName;
  if (snapshot.instanceId !== defaultInstanceIdForDriver(snapshot.driver)) {
    const humanized = humanizeSlug(snapshot.instanceId);
    if (humanized.length > 0) return humanized;
  }
  return (isLegacyDriverName ? kindLabel : trimmedSnapshotName) || kindLabel;
}

/**
 * Turn a display name into up to two initials for the badge: the first two
 * characters of a single word, or the first character of each of the first
 * two words. Iterates by code point so an emoji never splits into surrogates.
 */
export function providerInstanceInitials(label: string): string {
  const words = label.replace(/[_-]+/g, " ").split(/\s+/u).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return Array.from(words[0]!).slice(0, 2).join("").toUpperCase();
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0]?.toUpperCase() ?? "")
    .join("");
}

/** Only `#rrggbb` accent colors render; anything else is treated as unset. */
export function normalizeProviderAccentColor(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return /^#[0-9a-fA-F]{6}$/u.test(trimmed) ? trimmed : undefined;
}

/**
 * Whether to render an initials badge on a provider button or chip.
 *
 * Rules:
 *   - Any instance with a custom accent color gets an indicator badge.
 *   - Any custom instance of a driver always gets a badge so the user can tell
 *     it apart from the default instance or other custom instances.
 *   - The default instance only gets a badge if *at least one other instance*
 *     of the same driver kind is currently configured; otherwise the driver
 *     icon alone is unambiguous and must not be obscured with initials.
 */
export function shouldShowInstanceBadge(
  entry: {
    readonly driverKind?: ProviderDriverKind | undefined;
    readonly accentColor?: string | undefined;
    readonly instanceId?: string | undefined;
    readonly isDefault?: boolean | undefined;
  },
  entries: Iterable<{
    readonly driverKind?: ProviderDriverKind | undefined;
    readonly instanceId?: string | undefined;
  }>,
): boolean {
  if (entry.accentColor) return true;
  if (entry.driverKind !== undefined) {
    let sharedDriverCount = 0;
    for (const candidate of entries) {
      if (candidate.driverKind === entry.driverKind && ++sharedDriverCount > 1) return true;
    }
    return false;
  }
  if (entry.isDefault === false) return true;
  let count = 0;
  for (const _ of entries) {
    if (++count > 1) return true;
  }
  return false;
}
