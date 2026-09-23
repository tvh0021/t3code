import { type ServerProviderModel } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const ModelList = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.optional(Schema.String),
    }),
  ),
});
const decodeModelList = Schema.decodeUnknownSync(ModelList);

export class AbacusModelsError extends Schema.TaggedError<AbacusModelsError>()(
  "AbacusModelsError",
  {
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
const isAbacusModelsError = Schema.is(AbacusModelsError);

export function abacusModelsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/models`;
}

// RouteLLM also lists image and audio generators, which this text agent cannot run.
function isTextModel(id: string): boolean {
  return !/^(?:flux|dall-e|gpt-image|ideogram|recraft|imagen|seedream|nano-banana|midjourney|sora|veo|kling|runway)(?:[-_.0-9]|$)|(?:-tts|-audio-preview)$/i.test(
    id,
  );
}

export const readAbacusModels = Effect.fn("readAbacusModels")(function* (options: {
  readonly apiBaseUrl: string;
  readonly apiKey: string;
  readonly fetch?: typeof globalThis.fetch;
}) {
  const fetchFn = options.fetch ?? globalThis.fetch;
  return yield* Effect.tryPromise({
    try: async (): Promise<ReadonlyArray<ServerProviderModel>> => {
      const response = await fetchFn(abacusModelsUrl(options.apiBaseUrl), {
        headers: { Authorization: `Bearer ${options.apiKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new AbacusModelsError({ detail: `HTTP ${response.status}` });
      const catalog = decodeModelList(await response.json());
      if (catalog.data.length === 0) {
        throw new AbacusModelsError({ detail: "ChatLLM returned an empty model list." });
      }
      const seen = new Set<string>();
      const models = catalog.data.flatMap((entry) => {
        const slug = entry.id.trim();
        if (!slug || seen.has(slug) || !isTextModel(slug)) return [];
        seen.add(slug);
        return [
          {
            slug,
            name: entry.name?.trim() || slug,
            isCustom: false,
            capabilities: createModelCapabilities({ optionDescriptors: [] }),
          },
        ];
      });
      if (models.length === 0) {
        throw new AbacusModelsError({ detail: "ChatLLM returned no usable model IDs." });
      }
      return models;
    },
    catch: (cause) =>
      isAbacusModelsError(cause)
        ? cause
        : new AbacusModelsError({ detail: "Could not read the ChatLLM model catalog.", cause }),
  });
});
