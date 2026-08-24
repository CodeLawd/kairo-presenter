import type {
  ScriptureResult,
  ScriptureTranslation,
  ScriptureTranslationOption,
  SermonScriptureItem,
} from "./ipc";

const LOCAL_FALLBACKS: ScriptureTranslation[] = ["KJV", "BSB", "WEB", "ASV", "OEB"];

/** Prefer the requested translation, then the operator's default, then local Bibles. */
export function translationFallbackOrder(
  requested: ScriptureTranslation,
  preferred: ScriptureTranslation,
  options: ScriptureTranslationOption[] = [],
): ScriptureTranslation[] {
  const available = options.filter((option) => option.available).map((option) => option.id);
  const ordered = [requested, preferred, ...LOCAL_FALLBACKS, ...available];
  return [...new Set(ordered)];
}

export async function resolveSermonPlanItem(
  item: SermonScriptureItem,
  preferredTranslation: ScriptureTranslation,
  search: (
    query: string,
    translation: ScriptureTranslation,
  ) => Promise<ScriptureResult[]>,
  options: ScriptureTranslationOption[] = [],
): Promise<SermonScriptureItem> {
  if (item.available && item.verses.length > 0) return item;

  const candidates = translationFallbackOrder(
    item.translation,
    preferredTranslation,
    options,
  );

  let lastError = `${item.translation} text is unavailable`;
  for (const translation of candidates) {
    try {
      const [result] = await search(item.reference, translation);
      if (!result?.verses.length) {
        lastError = `${translation} text is unavailable`;
        continue;
      }
      return {
        ...item,
        reference: result.reference,
        translation: result.translation as ScriptureTranslation,
        verses: result.verses,
        available: true,
        error:
          translation !== item.translation
            ? `${item.translation} unavailable — showing ${translation}`
            : undefined,
      };
    } catch (lookupError) {
      lastError = (lookupError as Error).message;
    }
  }

  return {
    ...item,
    verses: [],
    available: false,
    error: lastError,
  };
}

export async function resolveSermonPlanItems(
  items: SermonScriptureItem[],
  preferredTranslation: ScriptureTranslation,
  search: (
    query: string,
    translation: ScriptureTranslation,
  ) => Promise<ScriptureResult[]>,
  options: ScriptureTranslationOption[] = [],
): Promise<SermonScriptureItem[]> {
  return Promise.all(
    items.map((item) =>
      resolveSermonPlanItem(item, preferredTranslation, search, options),
    ),
  );
}
