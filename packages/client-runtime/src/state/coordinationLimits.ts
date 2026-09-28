import { coordinationModelKey } from "@t3tools/contracts";

/** Human-editable model=turns lines. A blank editor restores the built-in and price defaults. */
export function parseCoordinationLimits(text: string): Record<string, number | null> {
  const entries: Record<string, number | null> = {};
  for (const [index, raw] of text.split("\n").entries()) {
    const line = raw.trim();
    if (!line) continue;
    const match = /^(\S+)\s*=\s*(unlimited|\d+)$/i.exec(line);
    if (!match) throw new Error(`Line ${index + 1}: use model=turns or model=unlimited.`);
    const model = coordinationModelKey(match[1]!);
    if (Object.hasOwn(entries, model))
      throw new Error(`Line ${index + 1}: ${model} already has a limit.`);
    const limit = match[2]!.toLowerCase() === "unlimited" ? null : Number(match[2]);
    if (limit !== null && !Number.isSafeInteger(limit))
      throw new Error(`Line ${index + 1}: use a whole number of turns.`);
    entries[model] = limit;
  }
  return entries;
}

export function formatCoordinationLimits(limits: Readonly<Record<string, number | null>>) {
  return Object.entries(limits)
    .map(([model, limit]) => `${model}=${limit ?? "unlimited"}`)
    .join("\n");
}
