import { ANTIGRAVITY_DEFAULT_MODEL, ProviderDriverKind } from "@t3tools/contracts";

import * as ModelManifest from "../ModelManifest.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";

const DRIVER = ProviderDriverKind.make("antigravity");

/**
 * Seeds the manifest's Antigravity models when the provider is authenticated
 * but has no active session to populate dynamic models. Falls back to the
 * bundled manifest when the live one has no Antigravity catalog.
 */
export function seedAntigravityModels(
  draft: ServerProviderDraft,
  manifest: ModelManifest.ModelManifestData,
): ServerProviderDraft {
  if (
    draft.installed === false ||
    draft.status === "error" ||
    draft.auth.status === "unauthenticated" ||
    draft.models.length !== 0
  ) {
    return draft;
  }
  const catalog =
    ModelManifest.resolveProviderCatalog(manifest, DRIVER) ??
    ModelManifest.resolveProviderCatalog(ModelManifest.BUNDLED_MODEL_MANIFEST, DRIVER);
  if (!catalog || catalog.models.length === 0) return draft;
  return {
    ...draft,
    models: catalog.models.map((entry) => {
      const isDefault = entry.model.isDefault;
      const aliases = isDefault
        ? [...new Set([...(entry.model.aliases ?? []), ANTIGRAVITY_DEFAULT_MODEL])]
        : entry.model.aliases;
      return {
        ...entry.model,
        capabilities: entry.model.capabilities ?? { optionDescriptors: [] },
        ...(aliases ? { aliases } : {}),
      };
    }),
  };
}
