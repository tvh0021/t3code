import { ANTIGRAVITY_DEFAULT_MODEL } from "@t3tools/contracts";
import * as ModelCatalog from "@t3tools/provider-core/server/ModelCatalog";
import type { ServerProviderDraft } from "@t3tools/provider-core/server/snapshotProbe";

/**
 * Seeds the catalog's Antigravity models when the provider is authenticated
 * but has no active session to populate dynamic models. Callers pass the live
 * catalog first and the bundled catalog as the fallback.
 */
export function seedAntigravityModels(
  draft: ServerProviderDraft,
  ...catalogs: ReadonlyArray<ModelCatalog.ProviderCatalog | undefined>
): ServerProviderDraft {
  if (
    draft.installed === false ||
    draft.status === "error" ||
    draft.auth.status === "unauthenticated" ||
    draft.models.length !== 0
  ) {
    return draft;
  }
  const catalog = catalogs.find((candidate) => candidate && candidate.models.length > 0);
  if (!catalog) return draft;
  return {
    ...draft,
    models: catalog.models.map((entry) => {
      const model = ModelCatalog.catalogServerModel(catalog, entry);
      const aliases = model.isDefault
        ? [...new Set([...(model.aliases ?? []), ANTIGRAVITY_DEFAULT_MODEL])]
        : model.aliases;
      return {
        ...model,
        capabilities: model.capabilities ?? { optionDescriptors: [] },
        ...(aliases ? { aliases } : {}),
      };
    }),
  };
}
