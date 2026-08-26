// ─── Common ───────────────────────────────────────────────────────────────────

export type Unsubscribe = () => void

// ─── App Settings ─────────────────────────────────────────────────────────────

export type ScriptureTranslation =
  | 'NKJV' | 'KJV' | 'BSB' | 'WEB' | 'ASV' | 'OEB'
  | 'NIV' | 'NLT' | 'NASB' | 'MSG' | 'AMPC' | 'TPT' | 'ESV' | 'CSB'
export type STTProvider = 'deepgram' | 'whisper' | 'none'

export interface AppSettings {
  propresenter: {
    host: string
    port: number
    password: string
  }
  audio: {
    deviceId: string
  }
  stt: {
    provider: STTProvider
    apiKey: string
    anthropicApiKey: string
    deepseekApiKey: string
    llmProvider: 'anthropic' | 'deepseek'
    bibleApiKey: string
    language: string
  }
  scripture: {
    defaultTranslation: ScriptureTranslation
    showVerseNumbers: boolean
    autoMode: boolean
    confidenceThreshold: number
    debounceInterval: number
    contextWindowSize: number
    /**
     * API.Bible ids whose licence has been confirmed to permit whole-translation
     * offline download. Possession of an API key alone never implies this right.
     */
    offlineDownloadBibleIds: string[]
  }
  lyrics: {
    /**
     * Lets online lyrics search find songs outside Genius/LRCLIB (African gospel
     * blogs, etc.). Optional — a free HTML fallback runs without it.
     */
    braveApiKey: string
    /**
     * Google Cloud Translation API key. Optional — powers “Translate to English”
     * on lyrics (original kept; English gloss under each line).
     */
    googleTranslateApiKey: string
    /**
     * Color for bilingual gloss lines `(English…)` in the editor and slide preview.
     * Default: slightly darker yellow.
     */
    glossColor: string
  }
  display: {
    theme: 'dark' | 'light'
    fontSize: number
    transcriptionFontSize: number
  }
  overlay: {
    // — phase 1 (existing, unchanged) —
    /** PP message template string. Must contain {Reference} and/or {Text}. */
    template: string
    /** Append translation to reference shown on screen: "John 3:16 (KJV)" */
    showTranslation: boolean
    /** Show verse numbers when pushing multi-verse passages */
    showVerseNumbers: boolean
    /** Max verses per push; 0 = no cap (whole detected range) */
    maxVerses: number
    /** Auto-clear overlay after N seconds; 0 = manual clear only */
    autoClearSec: number
    // — phase 3 (new) — one entry per destination; see OverlayOutput below.
    outputs: OverlayOutput[]
    // — phase 2 (legacy — migrated into `outputs`, kept only so the migration
    //   in normalizeOverlaySettings can still read a pre-phase-3 store) —
    /** @deprecated Replaced by `outputs`. */
    mode: 'auto' | 'ndi' | 'message'
    /** @deprecated Replaced by the `ndi` output's `ppVideoInputUuid`. */
    ppVideoInputUuid: string
    /** @deprecated Replaced by the `ndi` output's `theme`. */
    theme: OverlayTheme
  }
  themeLibrary: CustomOverlayTheme[]
}

export interface CustomOverlayTheme {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  theme: OverlayTheme
}

// ─── Overlay theme (phase 2 — NDI in-app renderer) ────────────────────────────
// Defaults + the normalizer live in src/lib/overlay-defaults.ts.

/** Independent canvas box for verse or reference, in % of the 1920×1080 frame. */
export interface OverlayBox {
  /** Left edge, 0–100 (% of frame width). */
  xPct: number
  /** Top edge, 0–100 (% of frame height). */
  yPct: number
  /** Box width, 8–100 (% of frame width). */
  widthPct: number
  /** Box height, 6–100 (% of frame height). */
  heightPct: number
}

export type OverlayTextAlign = 'left' | 'center' | 'right' | 'justify'
export type OverlayVerticalAlign = 'top' | 'middle' | 'bottom'
export type OverlayTextDecoration = 'none' | 'underline' | 'line-through'
export type OverlayTextTransform = 'none' | 'uppercase' | 'capitalize' | 'lowercase'
export type OverlayOutlinePosition = 'outside' | 'inside' | 'center'
export type OverlayOutlineStyle = 'solid' | 'dashed' | 'dotted'

export interface OverlayTextShadow {
  enabled: boolean
  xPx: number
  yPx: number
  blurPx: number
  color: string
  opacity: number
}

export interface OverlayTextOutline {
  enabled: boolean
  position: OverlayOutlinePosition
  widthPx: number
  style: OverlayOutlineStyle
  color: string
  opacity: number
}

/** Shared typography + effects for verse or reference text. */
export interface OverlayTextStyle {
  fontFamily: string
  fontSizePx: number
  fontWeight: number
  color: string
  colorOpacity: number
  lineHeight: number
  letterSpacingPx: number
  align: OverlayTextAlign
  verticalAlign: OverlayVerticalAlign
  textDecoration: OverlayTextDecoration
  textTransform: OverlayTextTransform
  shadow: OverlayTextShadow
  outline: OverlayTextOutline
  box: OverlayBox
}

export interface OverlayTheme {
  background: {
    type: 'color' | 'gradient' | 'transparent' | 'image' | 'video'
    color: string          // '#0b1220'
    color2?: string        // gradient end; used when type === 'gradient'
    angleDeg?: number      // gradient angle, 0–360
    opacity: number        // 0–1, applies to the whole background layer
    /** Absolute local file path of the media shown when type is 'image'/'video'.
     *  Picked via native dialog; served to both renderers over the pa-media:// protocol,
     *  which only allows the currently-configured path. */
    mediaPath?: string
    /** How image/video media fills the 1920×1080 frame. Default 'cover'. */
    mediaFit?: 'cover' | 'contain' | 'fill'
  }
  verse: OverlayTextStyle
  reference: OverlayTextStyle & {
    show: boolean
    position: 'above' | 'below'
  }
  layout: {
    position: 'lower-third' | 'center' | 'top' | 'full'
    maxWidthPct: number    // 20–100 (ignored by 'full', which is full-bleed)
    paddingPx: number      // 0–200
    backdropBox: boolean   // rounded box behind the text block
    backdropColor: string  // rgba recommended
    backdropRadiusPx: number // 0–64
    /** Auto-size verse text to fill its box, capped by verse.fontSizePx. */
    autoFitText: boolean
  }
}

// ─── Overlay outputs (phase 3 — one push, many destinations) ──────────────────
// ProPresenter has no "send this to screen 2" API. The routing primitive is the
// LAYER, and a Look decides which layers each screen shows. So a destination is
// a (PP layer, content, styling) triple. Defaults, normalizer and the layer map
// live in src/lib/overlay-outputs.ts.

export type OverlayOutputKind = 'ndi' | 'library' | 'message' | 'stage'

/** The ProPresenter layer an output writes to. Two outputs on the same layer compete. */
export type OverlayLayer = 'presentation' | 'messages' | 'stage'

export interface OverlayOutput {
  id: string
  /** Operator-facing label — "Main screen", "Pastor confidence", "Lobby lower third". */
  name: string
  kind: OverlayOutputKind
  enabled: boolean
  /** Order within its layer group — lower runs first. */
  order: number
  /**
   * Push only if every non-fallback output failed. This is how the legacy
   * `auto`/`ndi`/`message` modes' last-resort message overlay survives the move
   * to fan-out: it is a different layer, so without this it would fire
   * *alongside* a successful presentation-layer push instead of instead of it.
   */
  fallbackOnly: boolean
  /** PP Look to trigger before pushing; '' leaves the operator's Look alone. */
  lookId: string
  // — kind: 'ndi' —
  /** Source theme in `themeLibrary`, or null when `theme` is a one-off. Display only. */
  themeId: string | null
  /** Resolved copy — rendering never depends on the library still holding `themeId`. */
  theme: OverlayTheme
  /** Persisted after discovery — the bound PP video-input uuid for the NDI source. */
  ppVideoInputUuid: string
  // — kind: 'message' | 'stage' —
  /** Token template; same {Reference}/{Text} syntax as the legacy `overlay.template`. */
  template: string
}

/** Per-output result of one fan-out push. */
export interface OverlayDispatchResult {
  outputId: string
  name: string
  kind: OverlayOutputKind
  layer: OverlayLayer
  ok: boolean
  /** Why it failed, when `ok` is false. */
  reason?: string
}

// ─── ProPresenter ─────────────────────────────────────────────────────────────

export interface ConnectOptions {
  host: string
  port: number
  password: string
}

export type ProPresenterConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'

export interface ProPresenterStatus {
  state: ProPresenterConnectionState
  host: string
  port: number
  version: string | null
  activeSlideId: string | null
  activePresentationId: string | null
  activePresentationName: string | null
  activePlaylistId: string | null
  activePlaylistName: string | null
}

export interface ProPresenterSlide {
  id: string
  label: string
  notes: string
  textContent: string
  thumbnailUrl?: string
}

export interface ProPresenterPresentation {
  id: string
  name: string
  slides: ProPresenterSlide[]
}

export interface ProPresenterPlaylistItem {
  id: string
  type: 'presentation' | 'media' | 'header'
  name: string
  presentationId?: string
}

export interface ProPresenterPlaylist {
  id: string
  name: string
  items: ProPresenterPlaylistItem[]
}

export interface ProPresenterLibrary {
  presentations: ProPresenterPresentation[]
}

// ─── Audio ────────────────────────────────────────────────────────────────────

export interface AudioDevice {
  id: string
  label: string
  kind: 'audioinput' | 'audiooutput'
  isDefault: boolean
}

export interface AudioLevel {
  rms: number       // 0–1
  peak: number      // 0–1
  clipping: boolean
  timestamp: number
}

export interface AudioError {
  code: 'DEVICE_NOT_FOUND' | 'PERMISSION_DENIED' | 'CAPTURE_FAILED' | 'UNKNOWN'
  message: string
}

// ─── Startup bootstrap ────────────────────────────────────────────────────────

/** Local resources the app waits for before showing its interface. */
export type BootstrapResource =
  | 'settings'
  | 'orchestrator'
  | 'propresenter'
  | 'transcription'
  | 'translations'
  | 'sermonPlans'
  | 'livePlan'
  | 'lyrics'

export interface BootstrapResourceError {
  resource: BootstrapResource
  message: string
}

export interface BootstrapProgress {
  completed: number
  total: number
  /** User-facing label, e.g. "Loading scripture playlists…". */
  step: string
}

/**
 * Everything the renderer needs for its first paint, loaded once at startup.
 * Network and hardware integrations are deliberately excluded — they hydrate in
 * the background so an unavailable one cannot hold the app hostage.
 */
export interface AppBootstrapSnapshot {
  /** Null only when settings could not be read; the renderer falls back to defaults. */
  settings: AppSettings | null
  orchestrator: OrchestratorStatus | null
  propresenter: ProPresenterStatus | null
  transcription: TranscriptResult[]
  translations: ScriptureTranslationOption[]
  sermonPlans: SermonPlan[]
  livePlan: LivePlanState | null
  lyrics: LyricsSong[]
  errors: BootstrapResourceError[]
  completedAt: number
}

/**
 * Whether the saved API.Bible key has been confirmed. Scripture must not warn
 * about a missing or unauthorized key until this is `unauthorized`.
 */
export type ApiBibleAuthorizationState =
  | 'unchecked'
  | 'checking'
  | 'authorized'
  | 'unauthorized'
  | 'offline'

// ─── Scripture ────────────────────────────────────────────────────────────────

export interface ScriptureVerse {
  book: string
  chapter: number
  verse: number
  text: string
}

export interface ScriptureSuggestion {
  id: string
  reference: string
  verses: ScriptureVerse[]
  translation: ScriptureTranslation
  confidence: number
  source: 'auto' | 'manual'
  triggerText: string
  /** Shared identity and ordering for verses expanded from one detected range. */
  passageId?: string
  passageReference?: string
  passageIndex?: number
  passageLength?: number
  /** Adjacent verse loaded proactively beyond the preacher's stated range. */
  preloadedNext?: boolean
  /** Playlist item this verse resolved against, when a live sermon playlist is set. */
  planId?: string
  planItemId?: string
  /** How the live playlist matched: spoken citation vs. the preacher reading the text. */
  planMatch?: 'reference' | 'quote'
}

export interface ScriptureResult {
  reference: string
  verses: ScriptureVerse[]
  translation: ScriptureTranslation
}

export interface ScriptureTranslationOption {
  id: ScriptureTranslation
  name: string
  access: 'local' | 'api'
  available: boolean
  requiresApiKey: boolean
}

export type ApiBibleCacheStatus =
  | 'not-downloaded'
  | 'partial'
  | 'downloading'
  | 'paused'
  | 'downloaded'
  | 'stale'
  | 'unavailable'
  | 'failed'

export interface ApiBibleOfflineTranslation {
  bibleId: string
  translation: ScriptureTranslation
  name: string
  copyright: string
  status: ApiBibleCacheStatus
  cachedChapters: number
  totalChapters: number
  cachedVerses: number
  fetchedAt: number | null
  expiresAt: number | null
  offlineDownloadEnabled: boolean
  error?: string
}

export interface ApiBibleDownloadProgress {
  bibleId: string
  status: ApiBibleCacheStatus
  completedChapters: number
  totalChapters: number
  cachedVerses: number
  error?: string
}

export interface SermonScriptureItem {
  id: string
  reference: string
  translation: ScriptureTranslation
  verses: ScriptureVerse[]
  available: boolean
  error?: string
}

export interface SermonPlan {
  id: string
  title: string
  sourceFileName: string
  items: SermonScriptureItem[]
  createdAt: number
  updatedAt: number
  reviewedAt?: number
}

export function completeSermonPlanReview(plan: SermonPlan, completedAt = Date.now()): SermonPlan {
  return { ...plan, reviewedAt: completedAt, updatedAt: completedAt }
}

export function sermonPlanNeedsReview(plan: SermonPlan): boolean {
  return typeof plan.reviewedAt !== 'number'
}

export function appendScriptureResultToPlan(
  plan: SermonPlan,
  result: ScriptureResult,
  itemId: string,
  addedAt = Date.now(),
): SermonPlan {
  return insertScriptureResultInPlan(plan, result, itemId, null, 'after', addedAt)
}

/** Insert a scripture item after/before a relative playlist item (or append if relative missing). */
export function insertScriptureResultInPlan(
  plan: SermonPlan,
  result: ScriptureResult,
  itemId: string,
  relativeItemId: string | null,
  position: 'before' | 'after' = 'after',
  addedAt = Date.now(),
): SermonPlan {
  const entry: SermonScriptureItem = {
    id: itemId,
    reference: result.reference,
    translation: result.translation,
    verses: result.verses,
    available: true,
  }
  const items = [...plan.items]
  const relativeIndex = relativeItemId
    ? items.findIndex((item) => item.id === relativeItemId)
    : -1
  if (relativeIndex < 0) {
    items.push(entry)
  } else {
    items.splice(relativeIndex + (position === 'after' ? 1 : 0), 0, entry)
  }
  return { ...plan, items, updatedAt: addedAt }
}

/** Append each result as its own playlist item (passage row). Multi-verse results stay one item. */
export function appendScriptureResultsToPlan(
  plan: SermonPlan,
  results: ScriptureResult[],
  batchId: string,
  addedAt = Date.now(),
): SermonPlan {
  let updated = plan
  for (const [index, result] of results.entries()) {
    if (result.verses.length === 0) continue
    updated = appendScriptureResultToPlan(
      updated,
      result,
      `${batchId}-${index}`,
      addedAt,
    )
  }
  return updated
}

/** Split multi-verse playlist rows into one item per verse. */
export function expandSermonPlanItems(items: SermonScriptureItem[]): SermonScriptureItem[] {
  return items.flatMap((item) => {
    if (item.verses.length <= 1) return [item]
    return item.verses.map((verse, index) => ({
      id: `${item.id}-v${verse.chapter}-${verse.verse}-${index}`,
      reference: `${verse.book} ${verse.chapter}:${verse.verse}`,
      translation: item.translation,
      verses: [verse],
      available: item.available,
      error: item.error,
    }))
  })
}

export function removeSermonPlanItem(plan: SermonPlan, itemId: string, removedAt = Date.now()): SermonPlan {
  return {
    ...plan,
    items: plan.items.filter((item) => item.id !== itemId),
    updatedAt: removedAt,
  }
}

export function reorderSermonPlanItem(
  plan: SermonPlan,
  draggedId: string,
  targetId: string,
  position: 'before' | 'after',
  movedAt = Date.now(),
): SermonPlan {
  if (draggedId === targetId) return plan
  const fromIndex = plan.items.findIndex((item) => item.id === draggedId)
  if (fromIndex < 0) return plan
  const items = [...plan.items]
  const [movedItem] = items.splice(fromIndex, 1)
  const targetIndex = items.findIndex((item) => item.id === targetId)
  if (targetIndex < 0) return plan
  items.splice(targetIndex + (position === 'after' ? 1 : 0), 0, movedItem)
  return { ...plan, items, updatedAt: movedAt }
}

/** Summary of the sermon playlist currently referenced by live transcription. */
export interface LivePlanState {
  planId: string | null
  title: string | null
  itemCount: number
  /** Items with no resolved verse text — they cannot be matched by reading. */
  unavailableCount: number
}

export interface SermonPlanDraft {
  title: string
  sourceFileName: string
  items: Array<Pick<SermonScriptureItem, 'id' | 'reference' | 'translation'>>
}

// ─── Transcription ────────────────────────────────────────────────────────────

export interface TranscriptWord {
  word: string
  start: number
  end: number
  confidence: number
}

export interface TranscriptResult {
  id: string
  text: string
  words: TranscriptWord[]
  isFinal: true
  timestamp: number
  duration: number
}

export interface InterimResult {
  text: string
  stability: number
  timestamp: number
}

// ─── Lyrics ───────────────────────────────────────────────────────────────────

export type LyricsImportSource =
  | { type: 'url'; url: string }
  | { type: 'ccli'; ccliNumber: string; apiKey: string }
  | { type: 'text'; title: string; artist: string; text: string; copyright?: string }
  | { type: 'usr'; content: string; filename?: string }
  | { type: 'online'; provider: LyricsProvider; url: string; title: string; artist: string }

/** Remote catalogues the online search tier can reach. */
export type LyricsProvider = 'genius' | 'lrclib' | 'web'

export interface LyricsOnlineResult {
  /** Stable per-provider identifier, used as a React key and for dedup. */
  id: string
  provider: LyricsProvider
  title: string
  artist: string
  /** Provider endpoint the lyrics get fetched from on import. */
  url: string
  album?: string
  releaseYear?: string
  /**
   * The lyric line that matched the query, when the hit came from the words
   * rather than the title. Shown so the operator can tell at a glance why a
   * result is in the list.
   */
  snippet?: string
  /**
   * Id of the library song this result already matches, if any. Lets the UI
   * offer "Open" instead of importing a duplicate.
   */
  existingSongId?: string
}

/** Full lyrics for a search hit — fetched on click, not saved until Import. */
export interface LyricsOnlinePreview {
  title: string
  artist: string
  provider: LyricsProvider
  url: string
  sections: LyricsSongSection[]
}

export type LyricsSectionType =
  | 'verse'
  | 'chorus'
  | 'bridge'
  | 'pre-chorus'
  | 'tag'
  | 'intro'
  | 'outro'
  | 'ending'

export type LyricsSource = 'usr' | 'text' | 'propresenter' | 'ccli' | 'genius' | 'lrclib' | 'web'

export interface LyricsSongSection {
  type: LyricsSectionType
  label: string
  lines: string[]
  /**
   * Optional per-line color overrides (same length as `lines` when present).
   * `null` / missing = use auto gloss detection + Settings gloss color.
   */
  lineColors?: (string | null)[]
}

export interface LyricsSong {
  id: string
  title: string
  artist: string
  copyright?: string
  ccliNumber?: string
  isFavorite?: boolean
  source?: LyricsSource
  sections: LyricsSongSection[]
  createdAt: number
  updatedAt: number
}

export interface SongPresentOptions {
  /**
   * @deprecated Slides are defined by blank-line breaks in the song text.
   * Kept so older callers still type-check; ignored by the formatter.
   */
  linesPerSlide?: number
  /** Soft word-wrap character limit per line. Default: 40 */
  maxCharsPerLine?: number
  /**
   * Where to place the copyright notice.
   * 'each'     — appended as final line on every slide
   * 'last'     — appended only on the very last content slide
   * 'separate' — its own final slide group ("Copyright")
   * 'none'     — omitted entirely (default)
   */
  copyrightPosition?: 'each' | 'last' | 'separate' | 'none'
  /** Trigger the first slide in ProPresenter immediately after import. Default: false */
  triggerFirst?: boolean
}

// ─── Per-namespace API shapes (shared source of truth) ────────────────────────

export interface ProPresenterAPI {
  connect: (options: ConnectOptions) => Promise<void>
  disconnect: () => Promise<void>
  getStatus: () => Promise<ProPresenterStatus>
  triggerSlide: (slideId: string) => Promise<void>
  clearAll: () => Promise<void>
  getLibrary: () => Promise<ProPresenterLibrary>
  getPlaylists: () => Promise<ProPresenterPlaylist[]>
  /** Pushes a sample verse (John 3:16 KJV) through the scripture overlay path using current overlay settings. */
  testOverlay: () => Promise<boolean>
  /** Clears every layer this app most recently pushed to. */
  clearOverlay: () => Promise<boolean>
  /** PP Looks — a Look defines which layers are visible on which screens. */
  getLooks: () => Promise<PPLook[]>
  /** Returns cleanup fn — call when component unmounts. */
  onStatusChange: (callback: (status: ProPresenterStatus) => void) => Unsubscribe
}

/** One entry from PP's `GET /v1/looks`. */
export interface PPLook {
  id: string
  name: string
}

export interface AudioAPI {
  getDevices: () => Promise<AudioDevice[]>
  startCapture: (deviceId: string) => Promise<void>
  stopCapture: () => Promise<void>
  /** Send raw Int16 PCM chunk (16kHz mono) from renderer to main for Deepgram. */
  sendPCMChunk: (buffer: ArrayBuffer) => void
  /** Returns cleanup fn. */
  onLevel: (callback: (level: AudioLevel) => void) => Unsubscribe
  /** Returns cleanup fn. */
  onError: (callback: (error: AudioError) => void) => Unsubscribe
}

export interface ScriptureAPI {
  /** Returns cleanup fn. Fires when auto-detection finds a scripture reference. */
  onSuggestion: (callback: (suggestion: ScriptureSuggestion) => void) => Unsubscribe
  approve: (suggestionId: string) => Promise<void>
  dismiss: (suggestionId: string) => Promise<void>
  /** Register a manually-built suggestion so orchestrator.approveSuggestion can present it. */
  register: (suggestion: ScriptureSuggestion) => Promise<void>
  search: (query: string, translation?: ScriptureTranslation) => Promise<ScriptureResult[]>
  getTranslations: (apiKey?: string) => Promise<ScriptureTranslationOption[]>
  setTranslation: (translation: ScriptureTranslation) => Promise<void>
  importSermonNotes: () => Promise<SermonPlanDraft | null>
  listSermonPlans: () => Promise<SermonPlan[]>
  saveSermonPlan: (plan: SermonPlan) => Promise<SermonPlan>
  deleteSermonPlan: (planId: string) => Promise<void>
  /** Reads the sermon playlist currently referenced by live transcription. */
  getLivePlan: () => Promise<LivePlanState>
  /** Selects (or clears, with null) the live reference playlist. */
  setLivePlan: (planId: string | null) => Promise<LivePlanState>
  /** Returns cleanup fn. Fires when the live playlist or its contents change. */
  onLivePlanChange: (callback: (state: LivePlanState) => void) => Unsubscribe
  setAutoMode: (enabled: boolean) => Promise<void>
  setConfidenceThreshold: (threshold: number) => Promise<void>
  /** Cache state for every API.Bible translation the saved key can reach. */
  listOfflineTranslations: () => Promise<ApiBibleOfflineTranslation[]>
  downloadTranslation: (bibleId: string) => Promise<void>
  pauseTranslationDownload: (bibleId: string) => Promise<void>
  refreshOfflineTranslation: (bibleId: string) => Promise<void>
  /** Deletes cached licensed text; the API key and app settings are untouched. */
  removeOfflineTranslation: (bibleId: string) => Promise<void>
  /** Returns cleanup fn. Fires as chapters are downloaded or refreshed. */
  onOfflineDownloadProgress: (callback: (value: ApiBibleDownloadProgress) => void) => Unsubscribe
}

export interface TranscriptionAPI {
  /** Returns cleanup fn. Fires for each finalized transcript segment. */
  onTranscript: (callback: (result: TranscriptResult) => void) => Unsubscribe
  /** Returns cleanup fn. Fires for in-progress, not-yet-final text. */
  onInterim: (callback: (result: InterimResult) => void) => Unsubscribe
  getHistory: () => Promise<TranscriptResult[]>
  clearHistory: () => Promise<void>
}

export interface LyricsAPI {
  search: (query: string) => Promise<LyricsSong[]>
  /**
   * Searches remote catalogues by title, artist, or a fragment of the lyrics.
   * Results are annotated with `existingSongId` when the library already has a match.
   */
  searchOnline: (query: string) => Promise<LyricsOnlineResult[]>
  /**
   * Fetches full lyrics for a search hit without writing to the library.
   * Used so the operator can confirm the song before Import.
   */
  previewOnline: (source: {
    provider: LyricsProvider
    url: string
    title: string
    artist: string
  }) => Promise<LyricsOnlinePreview>
  import: (source: LyricsImportSource) => Promise<LyricsSong>
  getLibrary: () => Promise<LyricsSong[]>
  getSong: (id: string) => Promise<LyricsSong | null>
  update: (id: string, song: LyricsSong) => Promise<LyricsSong | null>
  delete: (id: string) => Promise<boolean>
  toggleFavorite: (id: string) => Promise<boolean>
  sendToProPresenter: (songId: string, options?: SongPresentOptions) => Promise<void>
  addToPlaylist: (songId: string, playlistId: string) => Promise<void>
  /**
   * Translates singable lines to English and inserts `(gloss)` under each line.
   * Prefers Anthropic/DeepSeek when configured; otherwise Google Translate.
   * `sourceLanguage`: 'auto' | 'yo' | 'ig' | 'ha' | …
   */
  translateSections: (
    sections: LyricsSongSection[],
    options?: {
      target?: string
      sourceLanguage?: string
      title?: string
      artist?: string
    }
  ) => Promise<LyricsSongSection[]>
}

// ─── NDI ───────────────────────────────────────────────────────────────────────

export interface NdiStatus {
  /** grandiose-mac loaded and sender created successfully. */
  available: boolean
  /** Frame loop currently pushing frames to the NDI sender. */
  sending: boolean
  /** A PP video input (bound uuid, or discovered by name) is currently present in PP's /v1/video_inputs list. */
  ppInputConfigured: boolean
  /** Readiness of each enabled output, keyed by output id. */
  outputs: NdiOutputStatus[]
}

export interface NdiOutputStatus {
  id: string
  /** False when this output cannot currently push — see `reason`. */
  ready: boolean
  reason?: string
}

/** One entry from PP's `GET /v1/video_inputs` — PP names these "Input N", it does NOT expose the NDI source name. */
export interface PPVideoInputInfo {
  uuid: string
  name: string
}

export interface NdiAPI {
  getStatus: () => Promise<NdiStatus>
  /** Lists PP's configured video inputs so the user can bind the NDI one manually. */
  getVideoInputs: () => Promise<PPVideoInputInfo[]>
  /** Native open-file dialog for an overlay background image/video. Resolves to the absolute path, or null if cancelled. */
  pickOverlayMedia: (kind: 'image' | 'video') => Promise<string | null>
}

export interface SettingsAPI {
  get: <K extends keyof AppSettings>(key: K) => Promise<AppSettings[K]>
  /**
   * For `overlay`, main merges the value onto the freshly-read stored object, so
   * pages may send only the fields they own (see D3 in src/main/ipc/index.ts).
   * Every other key is replaced wholesale — send the complete section object.
   */
  set: <K extends keyof AppSettings>(key: K, value: AppSettings[K] | Partial<AppSettings[K]>) => Promise<void>
  getAll: () => Promise<AppSettings>
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export interface OrchestratorConfig {
  audioDeviceId: string
  sttProvider: STTProvider
  sttApiKey: string
  sttLanguage: string
  /** LLM provider for scripture detection */
  llmProvider: 'anthropic' | 'deepseek'
  llmApiKey: string
  /** Model override (default: claude-haiku-4-5-20251001 for anthropic, deepseek-chat for deepseek) */
  scriptureModel?: string
  scriptureTranslation: ScriptureTranslation
  autoMode: boolean
  /** Minimum confidence (0–1) to trigger auto-present; default 0.7 */
  confidenceThreshold: number
  /** Seconds between detection and auto-present; default 3 */
  autoPresentDelaySec: number
}

export interface SessionStats {
  sessionId: string
  startedAt: number
  durationMs: number
  totalWords: number
  totalDetections: number
  totalPresentations: number
  detectorCalls: number
  avgDetectorLatencyMs: number
  estimatedCostUsd: number
}

export interface ResilienceStatus {
  overallHealth: 'ALL_GOOD' | 'DEGRADED' | 'CRITICAL'
  internetConnected: boolean
  ppReconnectCountdown: number | null
  ppQueueSize: number
  claudeFallbackActive: boolean
  audioDeviceLost: boolean
  recoverySessionAvailable: boolean
  health: ServiceHealth[]
}

export interface ResilienceAPI {
  getStatus: () => Promise<ResilienceStatus>
  restoreSession: () => Promise<void>
  discardSession: () => Promise<void>
  onStatusChange: (callback: (status: ResilienceStatus) => void) => Unsubscribe
}

export type ServiceName = 'audio' | 'stt' | 'detector' | 'propresenter'

export interface ServiceHealth {
  service: ServiceName
  status: 'ok' | 'error' | 'degraded'
  lastError?: string
  lastUpdated: number
}

export interface OrchestratorStatus {
  running: boolean
  autoMode: boolean
  ppConnected: boolean
  health: ServiceHealth[]
  totalPresentations: number
}

export interface PendingAutoPresent {
  suggestionId: string
  reference: string
  expiresAt: number
}

export interface OrchestratorAPI {
  start: (config: OrchestratorConfig) => Promise<void>
  stop: () => Promise<void>
  getStatus: () => Promise<OrchestratorStatus>
  getStats: () => Promise<SessionStats | null>
  approveSuggestion: (suggestionId: string) => Promise<void>
  dismissSuggestion: (suggestionId: string) => Promise<void>
  dismissAuto: (suggestionId: string) => Promise<void>
  onStatus: (callback: (status: OrchestratorStatus) => void) => Unsubscribe
  onPendingAuto: (callback: (pending: PendingAutoPresent) => void) => Unsubscribe
}

export interface AppAPI {
  /** Loads every local resource the first render needs, in one round trip. */
  bootstrap: () => Promise<AppBootstrapSnapshot>
  /** Returns cleanup fn. Fires as each bootstrap resource settles. */
  onBootstrapProgress: (callback: (progress: BootstrapProgress) => void) => Unsubscribe
}

export interface ProAutomateAPI {
  app: AppAPI
  propresenter: ProPresenterAPI
  audio: AudioAPI
  scripture: ScriptureAPI
  transcription: TranscriptionAPI
  lyrics: LyricsAPI
  settings: SettingsAPI
  orchestrator: OrchestratorAPI
  resilience: ResilienceAPI
  ndi: NdiAPI
}

// ─── IPC channel constants ────────────────────────────────────────────────────
// invoke = ipcRenderer.invoke / ipcMain.handle   (request → response)
// push   = webContents.send / ipcRenderer.on     (main → renderer, one-way)

export const IPC = {
  PROPRESENTER: {
    CONNECT:        'propresenter:connect',         // invoke
    DISCONNECT:     'propresenter:disconnect',      // invoke
    GET_STATUS:     'propresenter:getStatus',       // invoke
    TRIGGER_SLIDE:  'propresenter:triggerSlide',    // invoke
    CLEAR_ALL:      'propresenter:clearAll',        // invoke
    GET_LIBRARY:    'propresenter:getLibrary',      // invoke
    GET_PLAYLISTS:  'propresenter:getPlaylists',    // invoke
    TEST_OVERLAY:   'propresenter:testOverlay',     // invoke
    CLEAR_OVERLAY:  'propresenter:clearOverlay',    // invoke
    GET_LOOKS:      'propresenter:getLooks',        // invoke — PPLook[]
    STATUS_CHANGE:  'propresenter:statusChange',    // push
  },
  AUDIO: {
    GET_DEVICES:    'audio:getDevices',             // invoke
    START_CAPTURE:  'audio:startCapture',           // invoke
    STOP_CAPTURE:   'audio:stopCapture',            // invoke
    PCM_CHUNK:      'audio:pcmChunk',               // renderer→main send
    LEVEL:          'audio:level',                  // push
    ERROR:          'audio:error',                  // push
  },
  APP: {
    BOOTSTRAP:          'app:bootstrap',          // invoke
    BOOTSTRAP_PROGRESS: 'app:bootstrapProgress',  // push
  },
  SCRIPTURE: {
    APPROVE:                'scripture:approve',                 // invoke
    DISMISS:                'scripture:dismiss',                 // invoke
    REGISTER:               'scripture:register',                // invoke
    SEARCH:                 'scripture:search',                  // invoke
    GET_TRANSLATIONS:       'scripture:getTranslations',         // invoke
    SET_TRANSLATION:        'scripture:setTranslation',         // invoke
    IMPORT_SERMON_NOTES:    'scripture:importSermonNotes',       // invoke
    LIST_SERMON_PLANS:      'scripture:listSermonPlans',         // invoke
    SAVE_SERMON_PLAN:       'scripture:saveSermonPlan',          // invoke
    DELETE_SERMON_PLAN:     'scripture:deleteSermonPlan',        // invoke
    GET_LIVE_PLAN:          'scripture:getLivePlan',             // invoke
    SET_LIVE_PLAN:          'scripture:setLivePlan',             // invoke
    LIVE_PLAN_CHANGED:      'scripture:livePlanChanged',         // push
    LIST_OFFLINE_TRANSLATIONS:   'scripture:listOfflineTranslations',   // invoke
    DOWNLOAD_TRANSLATION:        'scripture:downloadTranslation',       // invoke
    PAUSE_TRANSLATION_DOWNLOAD:  'scripture:pauseTranslationDownload',   // invoke
    REFRESH_OFFLINE_TRANSLATION: 'scripture:refreshOfflineTranslation',  // invoke
    REMOVE_OFFLINE_TRANSLATION:  'scripture:removeOfflineTranslation',   // invoke
    OFFLINE_DOWNLOAD_PROGRESS:   'scripture:offlineDownloadProgress',    // push
    SET_AUTO_MODE:          'scripture:setAutoMode',             // invoke
    SET_CONFIDENCE:         'scripture:setConfidenceThreshold',  // invoke
    SUGGESTION:             'scripture:suggestion',              // push
  },
  TRANSCRIPTION: {
    GET_HISTORY:    'transcription:getHistory',     // invoke
    CLEAR_HISTORY:  'transcription:clearHistory',   // invoke
    TRANSCRIPT:     'transcription:transcript',     // push
    INTERIM:        'transcription:interim',        // push
  },
  LYRICS: {
    SEARCH:          'lyrics:search',               // invoke
    SEARCH_ONLINE:   'lyrics:searchOnline',         // invoke
    PREVIEW_ONLINE:  'lyrics:previewOnline',        // invoke
    IMPORT:          'lyrics:import',               // invoke
    GET_LIBRARY:     'lyrics:getLibrary',           // invoke
    GET_SONG:        'lyrics:getSong',              // invoke
    UPDATE:          'lyrics:update',               // invoke
    DELETE:          'lyrics:delete',               // invoke
    TOGGLE_FAVORITE: 'lyrics:toggleFavorite',       // invoke
    SEND_TO_PP:      'lyrics:sendToProPresenter',   // invoke
    ADD_TO_PLAYLIST: 'lyrics:addToPlaylist',        // invoke
    TRANSLATE:       'lyrics:translate',            // invoke
  },
  SETTINGS: {
    GET:            'settings:get',                 // invoke
    SET:            'settings:set',                 // invoke
    GET_ALL:        'settings:getAll',              // invoke
  },
  ORCHESTRATOR: {
    START:        'orchestrator:start',         // invoke
    STOP:         'orchestrator:stop',          // invoke
    GET_STATUS:   'orchestrator:getStatus',     // invoke
    GET_STATS:    'orchestrator:getStats',      // invoke
    APPROVE:      'orchestrator:approve',       // invoke
    DISMISS:      'orchestrator:dismiss',       // invoke
    DISMISS_AUTO: 'orchestrator:dismissAuto',   // invoke
    STATUS:       'orchestrator:status',        // push (OrchestratorStatus)
    PENDING_AUTO: 'orchestrator:pendingAuto',   // push (PendingAutoPresent)
  },
  RESILIENCE: {
    GET_STATUS:    'resilience:getStatus',        // invoke
    RESTORE:       'resilience:restore',          // invoke
    DISCARD:       'resilience:discard',          // invoke
    STATUS_CHANGE: 'resilience:statusChange',     // push (ResilienceStatus)
  },
  NDI: {
    GET_STATUS:         'ndi:getStatus',         // invoke — { available, sending, ppInputConfigured, outputs }
    GET_VIDEO_INPUTS:   'ndi:getVideoInputs',    // invoke — PPVideoInputInfo[]
    PICK_OVERLAY_MEDIA: 'ndi:pickOverlayMedia',  // invoke — native file dialog → absolute path | null
  },
} as const
