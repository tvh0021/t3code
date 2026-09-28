/** One budget identity across provider prefixes, aliases, and dated releases. */
export function coordinationModelKey(model: string): string {
  const name = model.trim().toLowerCase().split("/").at(-1) ?? model;
  const normalized = name
    .replaceAll("_", "-")
    .replace(/-(?:thinking|latest|default)$/, "")
    .replace(/-(?:\d{8}|\d{4}-\d{2}-\d{2})$/, "");
  const aliases: ReadonlyArray<readonly [RegExp, string]> = [
    [/^(?:gpt-)?6[.-]astra(?:-|$)/, "gpt-6-astra"],
    [/^(?:gpt-)?6[.-]sol(?:-|$)/, "gpt-6-sol"],
    [/^(?:gpt-)?6[.-]luna(?:-|$)/, "gpt-6-luna"],
    [/^(?:claude-)?sonnet-5(?:[.-]0)?$/, "claude-sonnet-5"],
    [/^(?:claude-)?opus-5[.-]5$/, "claude-opus-5.5"],
    [/^(?:claude-)?fable-5[.-]1$/, "claude-fable-5.1"],
    [/^glm-5[.-]3-flash$/, "glm-5.3-flash"],
    [/^gemini-3[.-]8-flash(?:-.*)?$/, "gemini-3.8-flash"],
  ];
  return aliases.find(([pattern]) => pattern.test(normalized))?.[1] ?? normalized;
}

export const DEFAULT_COORDINATION_LIMITS: Readonly<Record<string, number | null>> = {
  "gpt-6-astra": 1,
  "gpt-6-sol": 2,
  "gpt-6-luna": null,
  "gemini-3.8-flash": null,
  "claude-sonnet-5": 1,
  "claude-opus-5": 1,
  "claude-opus-5.5": 1,
  "claude-fable-5.1": 1,
  "glm-5.3-flash": null,
};

/** Undefined means unpriced; null explicitly means unlimited. */
export function coordinationLimit(
  model: string,
  outputPrice: number | undefined,
  overrides: Readonly<Record<string, number | null>> = DEFAULT_COORDINATION_LIMITS,
): number | null | undefined {
  const key = coordinationModelKey(model);
  if (Object.hasOwn(overrides, key)) return overrides[key];
  if (outputPrice === undefined || !Number.isFinite(outputPrice) || outputPrice < 0)
    return undefined;
  return outputPrice > 10 ? 1 : outputPrice < 1 ? null : 4;
}
