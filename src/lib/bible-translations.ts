// ─── Bible translation registry ─────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for every Bible translation Kairo knows about.
//
// To add a new translation, add ONE entry to BIBLE_TRANSLATIONS below —
// nothing else in the codebase needs to change:
//
//   { id: 'ESV', name: 'English Standard Version', access: 'api' }
//
// Optional knobs per entry:
// - `bundled: true` ......... ships inside resources/bible.db (never removable)
// - `aliases` ............... alternate API.Bible abbreviations that mean this id
// - `namePatterns` .......... regex sources matched against API.Bible names
// - `preferredBibleId` ...... official English text id when abbreviations lie
// - `downloadablePack` ...... makes Settings offer a one-click offline download
//
// Validation always enforces the canonical Protestant versification shared by
// every pack (see BIBLE_VERSE_COUNTS): 66 books, complete chapters, verses
// 1..N with no gaps. A translation that omits verses (e.g. without Matt 17:21)
// cannot be distributed as a pack — that is a structural limitation, not a
// registry setting, which is why packs carry no per-translation verse totals.
//
// Everything else derives from this file:
// - ScriptureService catalog + availability (src/main/services/scripture/index.ts)
// - API.Bible id mapping (api-bible.ts)
// - Sermon reference detection (sermon-plans.ts)
// - Fallback order (src/lib/sermon-plan-resolve.ts)
// - Settings / pack UI (renderer)
//
// This module is dependency-free on purpose: it runs in main, preload,
// renderer, and scripts.

export interface DownloadableBiblePack {
  /** HTTPS URL of the *.db.gz asset. */
  url: string
  /** Hex SHA-256 of the compressed asset, verified before install. */
  sha256: string
  /** Human label for Settings, e.g. 'about 5 MB'. */
  approxLabel: string
}

export interface BibleTranslationDefinition {
  /** Normalized id, e.g. 'NKJV'. Compared case-insensitively everywhere. */
  id: string
  /** Display name, e.g. 'New King James Version'. */
  name: string
  /**
   * 'local' = seeded in resources/bible.db or installed as a pack.
   * 'api' = text comes from API.Bible unless a local pack is installed.
   */
  access: 'local' | 'api'
  /** Ships in resources/bible.db — packs for these ids can never be removed. */
  bundled?: boolean
  /**
   * Alternate abbreviation forms that resolve to this id. Compared after
   * upper-casing and stripping non-alphanumerics, so 'Amplified Classic' and
   * 'AMPLIFIEDCLASSIC' are equivalent. Multi-word forms also feed sermon
   * reference detection verbatim.
   */
  aliases?: string[]
  /**
   * Regex sources (case-insensitive) matched against API.Bible bible names.
   * Order matters: longer names first so "New King James" wins over "King James".
   */
  namePatterns?: string[]
  /** Official English text id, used when a key's abbreviation string is unhelpful. */
  preferredBibleId?: string
  /** When present, Settings offers a one-click offline download for this id. */
  downloadablePack?: DownloadableBiblePack
}

/** Add a new translation HERE — one entry, no other code changes. */
export const BIBLE_TRANSLATIONS: readonly BibleTranslationDefinition[] = [
  {
    id: 'NKJV',
    name: 'New King James Version',
    access: 'api',
    aliases: [],
    namePatterns: ['new king james'],
    downloadablePack: {
      url: 'https://github.com/CodeLawd/kairo-bible-packs/releases/download/bible-packs-v1/nkjv-pack.db.gz',
      sha256: '12efa45e3be35978ffc72ee2305f4f085ca7076ef5974b7046dfcb8ac450b041',
      approxLabel: 'about 5 MB',
    },
  },
  { id: 'KJV', name: 'King James Version', access: 'local', bundled: true, namePatterns: ['king james'] },
  { id: 'BBE', name: 'Bible in Basic English', access: 'local', bundled: true, namePatterns: ['basic english'] },
  { id: 'BSB', name: 'Berean Standard Bible', access: 'local', bundled: true, namePatterns: ['berean standard'] },
  // Public-domain texts that are NOT in resources/bible.db — served by
  // API.Bible (or a local pack). `bundled` must match the shipped database;
  // a test enforces it.
  { id: 'WEB', name: 'World English Bible', access: 'api', namePatterns: ['world english'] },
  { id: 'ASV', name: 'American Standard Version', access: 'api', namePatterns: ['american standard'] },
  { id: 'OEB', name: 'Open English Bible', access: 'api', namePatterns: ['open english'] },
  {
    id: 'NIV',
    name: 'New International Version',
    access: 'api',
    aliases: ['NIVUK', 'NIV11', 'NIV2011', 'NIV84'],
    namePatterns: ['new international'],
    preferredBibleId: '78a9f6124f344018-01',
  },
  {
    id: 'NLT',
    name: 'New Living Translation',
    access: 'api',
    namePatterns: ['new living'],
    downloadablePack: {
      url: 'https://github.com/CodeLawd/kairo-bible-packs/releases/download/bible-packs-v1/nlt-pack.db.gz',
      sha256: 'ea57d70425083de77ad1aca16193bb2f8bd6629ec640200c88937aefd6f45528',
      approxLabel: 'about 5 MB',
    },
  },
  {
    id: 'NASB',
    name: 'New American Standard Bible',
    access: 'api',
    aliases: ['NASB95', 'NASB1995', 'NASB20', 'NASB2020'],
    namePatterns: ['new american standard'],
    preferredBibleId: 'a761ca71e0b3ddcf-01',
  },
  {
    id: 'MSG',
    name: 'The Message',
    access: 'api',
    aliases: ['MESSAGE', 'THEMESSAGE'],
    namePatterns: ['\\bthe message\\b'],
  },
  {
    id: 'AMPC',
    name: 'Amplified Bible, Classic Edition',
    access: 'api',
    aliases: ['AMP', 'AMPLIFIED', 'AMPLIFIEDCLASSIC', 'AMPLIFIED CLASSIC'],
    namePatterns: ['amplified bible,?\\s*classic', '\\bamplified\\b'],
  },
  {
    id: 'TPT',
    name: 'The Passion Translation',
    access: 'api',
    aliases: ['PASSION', 'THEPASSIONTRANSLATION', 'THE PASSION TRANSLATION'],
    namePatterns: ['passion translation'],
  },
  { id: 'ESV', name: 'English Standard Version', access: 'api', namePatterns: ['english standard'] },
  {
    id: 'CSB',
    name: 'Christian Standard Bible',
    access: 'api',
    namePatterns: ['christian standard'],
    preferredBibleId: 'a556c5305ee15c3f-01',
  },
]

/** The default translation for fresh installs. Change in one place. */
/** KJV ships with Kairo, so a new install can show scripture with no download or key. */
export const DEFAULT_TRANSLATION_ID = 'KJV'

/** Ids shipped inside resources/bible.db — derived, never hand-listed. */
export const BUNDLED_TRANSLATION_IDS: readonly string[] = BIBLE_TRANSLATIONS.filter(
  (entry) => entry.bundled,
).map((entry) => entry.id)

const byId = new Map<string, BibleTranslationDefinition>(
  BIBLE_TRANSLATIONS.map((entry) => [entry.id.toUpperCase(), entry]),
)

export function getTranslationDefinition(id: string): BibleTranslationDefinition | undefined {
  return byId.get(id.toUpperCase())
}

export function isBundledTranslation(id: string): boolean {
  return getTranslationDefinition(id)?.bundled === true
}

export function getDownloadablePack(id: string): DownloadableBiblePack | undefined {
  return getTranslationDefinition(id)?.downloadablePack
}

/** Ids with a one-click offline pack (drives the Settings pack list). */
export function getDownloadableTranslationIds(): string[] {
  return BIBLE_TRANSLATIONS.filter((entry) => entry.downloadablePack).map((entry) => entry.id)
}

/** Catalog rows in registry order: [id, name, access]. */
export function translationCatalogEntries(): Array<[string, string, 'local' | 'api']> {
  return BIBLE_TRANSLATIONS.map((entry) => [entry.id, entry.name, entry.access])
}

/** Normalized-alias → translation id, for API.Bible abbreviation matching. */
export function buildAbbreviationAliases(): Record<string, string> {
  const aliases: Record<string, string> = {}
  for (const entry of BIBLE_TRANSLATIONS) {
    for (const alias of entry.aliases ?? []) {
      aliases[normalizeAbbreviation(alias)] = entry.id
    }
  }
  return aliases
}

/** API.Bible bible id → translation id, for editions with unhelpful abbreviations. */
export function buildPreferredBibleIds(): Record<string, string> {
  const preferred: Record<string, string> = {}
  for (const entry of BIBLE_TRANSLATIONS) {
    if (entry.preferredBibleId) preferred[entry.preferredBibleId] = entry.id
  }
  return preferred
}

/** Ordered [pattern, id] pairs for API.Bible name matching.
 *
 * Sorted longest-pattern-first so "New American Standard Bible" matches NASB,
 * not ASV ("american standard"), and "New King James Version" matches NKJV,
 * not KJV. Registry order breaks ties.
 */
export function buildNamePatterns(): Array<[RegExp, string]> {
  const patterns: Array<[RegExp, string]> = []
  for (const entry of BIBLE_TRANSLATIONS) {
    for (const source of entry.namePatterns ?? []) {
      patterns.push([new RegExp(source, 'i'), entry.id])
    }
  }
  return patterns.sort((a, b) => b[0].source.length - a[0].source.length)
}

/**
 * Alias → translation id for sermon reference detection, including each id
 * itself. Keys are upper-cased with interior whitespace collapsed to a single
 * space (so 'AMPLIFIED CLASSIC' still matches).
 */
export function buildTranslationAliasMap(): Record<string, string> {
  const map: Record<string, string> = {}
  for (const entry of BIBLE_TRANSLATIONS) {
    map[entry.id.toUpperCase()] = entry.id
    for (const alias of entry.aliases ?? []) {
      map[alias.toUpperCase().replace(/\s+/g, ' ')] = entry.id
    }
  }
  return map
}

/** Local-first fallback order: bundled translations in registry order. */
export function bundledTranslationIdsInOrder(): string[] {
  return [...BUNDLED_TRANSLATION_IDS]
}

function normalizeAbbreviation(value: string | undefined): string {
  return (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}
