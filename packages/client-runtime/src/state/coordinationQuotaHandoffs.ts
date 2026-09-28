export function formatCoordinationQuotaHandoffs(
  fallbacks: Readonly<Record<string, ReadonlyArray<string>>>,
): string {
  return Object.entries(fallbacks)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([source, destinations]) => `${source}=${destinations.join(",")}`)
    .join("\n");
}

export function parseCoordinationQuotaHandoffs(text: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [index, raw] of text.split("\n").entries()) {
    const line = raw.trim();
    if (!line) continue;
    const [source, destinations, ...extra] = line.split("=");
    if (!source?.trim() || !destinations?.trim() || extra.length > 0)
      throw new Error(`Line ${index + 1}: use source-model=target-model,target-model.`);
    const key = source.trim();
    if (result[key]) throw new Error(`Line ${index + 1}: ${key} appears more than once.`);
    const models = destinations
      .split(",")
      .map((model) => model.trim())
      .filter(Boolean);
    if (models.length === 0 || new Set(models).size !== models.length)
      throw new Error(`Line ${index + 1}: enter unique fallback model IDs.`);
    result[key] = models;
  }
  return result;
}
