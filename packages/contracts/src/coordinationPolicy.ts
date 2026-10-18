import * as Schema from "effect/Schema";
import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const CoordinationBudget = Schema.Struct({
  model: TrimmedNonEmptyString,
  limit: Schema.NullOr(NonNegativeInt),
  used: NonNegativeInt,
});
export type CoordinationBudget = typeof CoordinationBudget.Type;

/**
 * One budget identity per model family across generations, provider prefixes,
 * and dated releases, so a limit on the newest generation can't be sidestepped
 * by delegating to an older one.
 */
export function coordinationModelKey(model: string): string {
  const name = model.trim().toLowerCase().split("/").at(-1) ?? model;
  const normalized = name
    .replaceAll("_", "-")
    .replace(/-(?:thinking|latest|default)$/, "")
    .replace(/-(?:\d{8}|\d{4}-\d{2}-\d{2})$/, "");
  const families: ReadonlyArray<readonly [RegExp, string]> = [
    [/^(?:gpt-)?\d+(?:[.-]\d+)?-(astra|sol|luna)(?:-|$)/, "gpt-$1"],
    [/^(?:claude-)?(?:\d+(?:[.-]\d+)?-)?(opus|sonnet|fable|haiku)(?:-\d|$)/, "claude-$1"],
    [/^glm-\d+(?:[.-]\d+)?-flash$/, "glm-flash"],
    [/^gemini-\d+(?:[.-]\d+)?-flash(?:-.*)?$/, "gemini-flash"],
  ];
  for (const [pattern, family] of families) {
    const match = pattern.exec(normalized);
    if (match) return family.replace("$1", match[1] ?? "");
  }
  return normalized;
}

export const DEFAULT_COORDINATION_LIMITS: Readonly<Record<string, number | null>> = {
  "gpt-astra": 1,
  "gpt-sol": 2,
  "gpt-luna": null,
  "gemini-flash": null,
  "claude-sonnet": 1,
  "claude-opus": 1,
  "claude-fable": 1,
  "glm-flash": null,
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
