// ─── Common ───────────────────────────────────────────────────────────────────

import type {
  PPResourceBindings,
  PPResourceCatalogue,
  PPResourceKind,
  PPResourcePreview,
} from './propresenter-resources'

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
    /** Model name for scripture detection. Empty = the provider's default. */
    llmModel: string
    bibleApiKey: string
    language: string
  }
  scripture: {
    defaultTranslation: ScriptureTranslation
    showVerseNumbers: boolean
    autoMode: boolean
    confidenceThreshold: number
    /**
     * Seconds between a detection and the verse going live, so an operator can
     * catch a wrong call before the congregation sees it.
     *
     * This is the single largest component of user-visible latency — far larger
     * than everything Kairo does to produce the verse — so it is a deliberate
     * choice, not an accident to optimize away.
     */
    autoPresentDelaySec: AutoPresentDelaySec
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
    shortcuts?: import('./keyboard-shortcuts').ShortcutBindings
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
  media: MediaSettings
  /** House-audio folder. Empty until derived from the media sibling or picked. */
  tracks: TracksSettings
  church: ChurchProfile
  /** Stable ProPresenter UUIDs selected for ProAutomate roles. */
  propresenterResources: PPResourceBindings
}

// ─── Church profile (onboarding) ──────────────────────────────────────────────

export interface ChurchServiceTime {
  /** 0 = Sunday … 6 = Saturday. */
  day: number
  /** 24h 'HH:MM'. */
  time: string
  label: string
}

export interface ChurchProfile {
  name: string
  /** IANA zone, e.g. 'Africa/Lagos'. '' until the operator picks one. */
  timezone: string
  /** What the person running this machine does, free text. */
  role: string
  serviceTimes: ChurchServiceTime[]
}

// ─── Cloud account ────────────────────────────────────────────────────────────
// Shapes live in `cloud/contracts.ts` so the server compiles against the same
// definitions; re-exported here because `ipc.ts` is the API surface everything
// else imports.

export type {
  CloudOrg,
  CloudResult,
  CloudSessionState,
  CloudUser,
  DevicePairingState,
  SessionSnapshot,
  SignInInput,
  SignUpInput,
} from './cloud/contracts'

export type { SecretsConfigured } from './cloud/org-secrets'

/** Secret field names that settings.set can clear without revealing values. */
export type SettingsSecretClearKey =
  | 'apiKey'
  | 'anthropicApiKey'
  | 'deepseekApiKey'
  | 'bibleApiKey'
  | 'braveApiKey'
  | 'googleTranslateApiKey'

export type SettingsSectionPatch<K extends keyof AppSettings> = K extends 'stt' | 'lyrics'
  ? AppSettings[K] & { clearKeys?: SettingsSecretClearKey[] }
  : AppSettings[K] | Partial<AppSettings[K]>

export type SettingsWithSecretsStatus = AppSettings & {
  secretsConfigured: import('./cloud/org-secrets').SecretsConfigured
}

// ─── Onboarding ───────────────────────────────────────────────────────────────

export type OnboardingStepId =
  | 'account'
  | 'propresenter'
  | 'propresenterResources'
  | 'output'
  | 'apiKeys'
  | 'church'

export interface OnboardingState {
  completedSteps: OnboardingStepId[]
  /** Answered with "not now" — resolved, but not done. */
  skippedSteps: OnboardingStepId[]
  currentStep: OnboardingStepId
  /** Null while the wizard is still open. */
  completedAt: number | null
  /** 'legacy' = derived from an install that predates the wizard. */
  source: 'fresh' | 'legacy'
}

// ─── Media (background dock) ──────────────────────────────────────────────────
// Backgrounds are FOLDER-BACKED: the app indexes a directory the user picks and
// never copies, imports or writes to it. A background is pushed live from the
// dock rather than saved into a theme, because it changes every song while a
// theme is configured once.

export interface MediaSettings {
  /** Absolute path of the watched backgrounds folder. '' until the user picks one. */
  folder: string
  /**
   * @deprecated Playlists now live in `<folder>/.proautomate/playlists.json` so
   * they travel with the media. Read once on first scan to migrate, then empty.
   */
  playlists: MediaPlaylist[]
}

export interface TracksSettings {
  /** Absolute path of the house-audio folder. '' until created next to Media. */
  folder: string
}

export interface TrackItem {
  id: string
  name: string
  path: string
  ext: string
  size: number
}

export interface TracksLibrary {
  folder: string
  items: TrackItem[]
  liveId: string | null
  livePaused: boolean
  error: string | null
}

export type MediaKind = 'video' | 'image'

export interface MediaItem {
  /** Stable id derived from the absolute path — survives rescans. */
  id: string
  /** Filename without extension. */
  name: string
  path: string
  kind: MediaKind
  /** Lowercased extension without the dot, e.g. 'mp4'. */
  ext: string
  /** Subfolder name relative to the root, or '' for files sitting at the root. */
  folder: string
  sizeBytes: number
}

/** A subfolder of the watched root, including empty shelves the operator just created. */
export interface MediaFolder {
  /** Folder name relative to the root; '' is the root itself. */
  id: string
  name: string
  count: number
}

/** An operator-built collection. Holds item ids and can span folders. */
export interface MediaPlaylist {
  id: string
  name: string
  /**
   * Item ids, which are paths relative to the media root. An id that no longer
   * resolves is KEPT so the dock can report it as missing rather than quietly
   * shrinking the playlist.
   */
  itemIds: string[]
  createdAt: number
}

/** Per-file playback — loop and a light color grade. Lives in the media manifest. */
export interface MediaPlayback {
  loop: boolean
  /** Degrees, −180 to 180. Identity is 0. */
  hue: number
  /** Multiplier, 0 to 2. Identity is 1. */
  saturation: number
  /** Multiplier, 0.25 to 1.75. Identity is 1. */
  brightness: number
  /** Multiplier, 0.25 to 1.75. Identity is 1. */
  contrast: number
}

export interface MediaLibrary {
  folder: string
  folders: MediaFolder[]
  items: MediaItem[]
  playlists: MediaPlaylist[]
  /** Custom loop / color per item id. Missing keys use the identity defaults. */
  playback: Record<string, MediaPlayback>
  /** Item currently pushed to screen, or null. */
  liveItemId: string | null
  /** True when the live video is paused. Images ignore this. Reset on every push. */
  livePaused: boolean
  /** Set when the last scan failed — e.g. the folder was moved or unmounted. */
  error: string | null
}

export interface CustomOverlayTheme {
  id: string
  name: string
  /**
   * What this theme is for. A lyric look and a verse look are not
   * interchangeable — one fills the frame, the other sits in a third of it — so
   * the library keeps them apart instead of offering every theme everywhere.
   * Themes saved before this field existed normalize to 'scripture'.
   */
  kind: OverlayContentKind
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
    /** Videos only. Default false — loop is an explicit choice. */
    mediaLoop?: boolean
    hue?: number
    saturation?: number
    brightness?: number
    contrast?: number
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
    /** Auto-size verse text to the box: shrink long passages, keep short lines a natural size. */
    autoFitText: boolean
  }
}

// ─── Overlay outputs (phase 3 — one push, many destinations) ──────────────────
// ProPresenter has no "send this to screen 2" API. The routing primitive is the
// LAYER, and a Look decides which layers each screen shows. So a destination is
// a (PP layer, content, styling) triple. Defaults, normalizer and the layer map
// live in src/lib/overlay-outputs.ts.

export type OverlayOutputKind = 'ndi' | 'library' | 'message' | 'stage'

/**
 * What is being pushed. Scripture and lyrics land on the same outputs but rarely
 * want the same look — a verse reads as a lower third, a lyric slide fills the
 * frame — so each output can carry a per-kind override (`OverlayOutput.lyrics`).
 */
export type OverlayContentKind = 'scripture' | 'lyrics'

/**
 * A content-kind override on one output: the styling and token template used
 * when that kind is pushed. `null` on an output means "use the output's own
 * theme/template", which is what keeps scripture behaviour unchanged.
 */
export interface OverlayOutputVariant {
  /** Source theme in `themeLibrary`, or null when `theme` is a one-off. Display only. */
  themeId: string | null
  /** Resolved copy — rendering never depends on the library still holding `themeId`. */
  theme: OverlayTheme
  /** Token template for `message`/`stage` kinds; same {Reference}/{Text} syntax. */
  template: string
}

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
  /**
   * Lyrics-specific styling and template. `null` — the default — means lyric
   * pushes reuse the scripture theme and template above, so turning the
   * override off anywhere always falls back to one configured look.
   */
  lyrics: OverlayOutputVariant | null
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
  | 'onboarding'
  | 'account'

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
  settings: SettingsWithSecretsStatus | null
  orchestrator: OrchestratorStatus | null
  propresenter: ProPresenterStatus | null
  transcription: TranscriptResult[]
  translations: ScriptureTranslationOption[]
  sermonPlans: SermonPlan[]
  livePlan: LivePlanState | null
  lyrics: LyricsSong[]
  /** Read from disk like everything else here — never from the network. */
  onboarding: OnboardingState
  /** Decrypted from the local token vault. No network call at launch. */
  account: import('./cloud/contracts').SessionSnapshot
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
  /**
   * Ties this suggestion to its latency trace, from transcript to screen.
   * Minted once at detection and never regenerated downstream.
   */
  correlationId?: string
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
  sourceText?: string
  id: string
  title: string
  sourceFileName: string
  items: SermonScriptureItem[]
  createdAt: number
  updatedAt: number
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

/** Grow an existing playlist item with the previous/next verse (same row). */
export function extendSermonPlanItemWithAdjacent(
  plan: SermonPlan,
  itemId: string,
  adjacent: ScriptureResult,
  direction: 'previous' | 'next',
  updatedAt = Date.now(),
): SermonPlan {
  const items = [...plan.items]
  const index = items.findIndex((item) => item.id === itemId)
  if (index < 0) return plan

  const item = items[index]
  const seen = new Set(
    item.verses.map((verse) => `${verse.book}:${verse.chapter}:${verse.verse}`),
  )
  const incoming = adjacent.verses.filter(
    (verse) => !seen.has(`${verse.book}:${verse.chapter}:${verse.verse}`),
  )
  if (incoming.length === 0) return plan

  const verses =
    direction === 'next'
      ? [...item.verses, ...incoming]
      : [...incoming, ...item.verses]
  const first = verses[0]
  const last = verses.at(-1)
  if (!first || !last) return plan

  let reference: string
  if (first.book !== last.book) {
    reference = `${first.book} ${first.chapter}:${first.verse}, ${last.book} ${last.chapter}:${last.verse}`
  } else if (first.chapter !== last.chapter) {
    reference = `${first.book} ${first.chapter}:${first.verse}–${last.chapter}:${last.verse}`
  } else if (first.verse !== last.verse) {
    reference = `${first.book} ${first.chapter}:${first.verse}–${last.verse}`
  } else {
    reference = `${first.book} ${first.chapter}:${first.verse}`
  }

  items[index] = {
    ...item,
    reference,
    verses,
    translation: adjacent.translation || item.translation,
    available: true,
    error: undefined,
  }
  return { ...plan, items, updatedAt }
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
  nextReference?: string | null
  nextPlanItemId?: string | null
  planId: string | null
  title: string | null
  itemCount: number
  /** Items with no resolved verse text — they cannot be matched by reading. */
  unavailableCount: number
}

export interface SermonPlanDraft {
  title: string
  sourceFileName: string
  text: string
  /** TipTap/HTML body that preserves document formatting when available. */
  html: string
  matches: SermonReferenceMatch[]
  items: Array<Pick<SermonScriptureItem, 'id' | 'reference' | 'translation'>>
}

export interface SermonReferenceMatch {
  start: number
  end: number
  text: string
  reference: string
  translations: ScriptureTranslation[]
}

export interface SermonNotesAnalysis {
  matches: SermonReferenceMatch[]
  items: SermonPlanDraft['items']
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
  /** Clears verse/lyric text and leaves the dock background running. */
  clearText: () => Promise<boolean>
  /** Clears text, dock background, and every layer this app most recently pushed to. */
  clearOverlay: () => Promise<boolean>
  /** PP Looks — a Look defines which layers are visible on which screens. */
  getLooks: () => Promise<PPLook[]>
  getResourceCatalogue: (options?: { refresh?: boolean }) => Promise<PPResourceCatalogue>
  getResourceDetails: (kind: PPResourceKind, id: string) => Promise<Record<string, unknown> | null>
  getResourcePreview: (kind: PPResourceKind, id: string, childId?: string) => Promise<PPResourcePreview>
  setResourceBindings: (bindings: PPResourceBindings) => Promise<PPResourceBindings>
  /** Returns cleanup fn — call when component unmounts. */
  onStatusChange: (callback: (status: ProPresenterStatus) => void) => Unsubscribe
}

/** One entry from PP's `GET /v1/looks`. */
export interface PPLook {
  id: string
  name: string
}

export interface AudioAPI {
  stopCapture: () => Promise<void>
  /** Send raw Int16 PCM chunk (16kHz mono) from renderer to main for Deepgram. */
  sendPCMChunk: (buffer: ArrayBuffer) => void
  /** Returns cleanup fn. */
  onLevel: (callback: (level: AudioLevel) => void) => Unsubscribe
  /** Returns cleanup fn. */
  onError: (callback: (error: AudioError) => void) => Unsubscribe
}

/** One traced projection plus its derived timings, for the diagnostics view. */
export interface ScriptureTraceRecord {
  trace: import('./scripture-trace').ScriptureLatencyTrace
  metrics: import('./scripture-trace').ScriptureLatencyMetrics
}

export interface ScriptureAPI {
  /** Recent scripture projections with their per-stage latency. Newest first. */
  recentTraces: (limit?: number) => Promise<ScriptureTraceRecord[]>
  /**
   * Report that a suggestion has been painted on Kairo's own screen.
   *
   * Fire-and-forget: this is telemetry, and an operator must never wait on it.
   */
  markRendered: (correlationId: string) => void
  /** Returns cleanup fn. Fires when auto-detection finds a scripture reference. */
  onSuggestion: (callback: (suggestion: ScriptureSuggestion) => void) => Unsubscribe
  approve: (suggestionId: string) => Promise<void>
  dismiss: (suggestionId: string) => Promise<void>
  /** Register a manually-built suggestion so orchestrator.approveSuggestion can present it. */
  register: (suggestion: ScriptureSuggestion) => Promise<void>
  /** Present browsed scripture without publishing it as detected Operator content. */
  presentDirectly: (suggestion: ScriptureSuggestion) => Promise<void>
  search: (query: string, translation?: ScriptureTranslation) => Promise<ScriptureResult[]>
  getTranslations: (apiKey?: string) => Promise<ScriptureTranslationOption[]>
  setTranslation: (translation: ScriptureTranslation) => Promise<void>
  importSermonNotes: () => Promise<SermonPlanDraft | null>
  scanSermonNotes: (text: string) => Promise<SermonNotesAnalysis>
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
  /**
   * Pushes a single slide of a song to the configured overlay outputs.
   * `slideIndex` is zero-based into the song's flat slide list, built with the
   * same `buildSlides` the library grid renders from.
   */
  pushSlide: (songId: string, slideIndex: number) => Promise<void>
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
   * For `stt` / `lyrics`, empty secret strings leave the stored value alone unless
   * listed in `clearKeys`. Every other key is replaced wholesale.
   */
  set: <K extends keyof AppSettings>(key: K, value: SettingsSectionPatch<K>) => Promise<void>
  getAll: () => Promise<SettingsWithSecretsStatus>
  /**
   * Validate a key using the draft (when replacing) or the stored value
   * (when configured and write-only). Never returns the key itself.
   */
  testApiKey: (
    kind: 'deepgram' | 'anthropic' | 'bible',
    draft?: string,
  ) => Promise<{ ok: boolean; message: string }>
  /** Fires when main hydrates or saves API keys (e.g. after org vault pull). */
  onChanged: (callback: (settings: SettingsWithSecretsStatus) => void) => Unsubscribe
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/** Fixed choices: easier to reason about and to test than free-text milliseconds. */
export type AutoPresentDelaySec = 0 | 1 | 2 | 3

export interface OrchestratorConfig {
  audioDeviceId: string
  sttProvider: STTProvider
  sttApiKey: string
  sttLanguage: string
  /** LLM provider for scripture detection */
  llmProvider: 'anthropic' | 'deepseek'
  llmApiKey: string
  /** Model override (default: claude-haiku-4-5 for anthropic, deepseek-flash for deepseek) */
  scriptureModel?: string
  scriptureTranslation: ScriptureTranslation
  autoMode: boolean
  /** Minimum confidence (0–1) to trigger auto-present; default 0.7 */
  confidenceThreshold: number
  /** Seconds between detection and auto-present; default 1 */
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
  /**
   * Why detection fell back, for the operator.
   *
   * `offline` is the network. `provider` means the AI service answered and
   * refused — a bad key or a bad model name — which looks nothing like being
   * offline and is fixed somewhere completely different.
   */
  detectorFallbackReason: { kind: 'offline' | 'provider'; message: string } | null
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
  onImportRequested: (callback: (kind: import('./import-menu').ImportKind) => void) => Unsubscribe
  /** Loads every local resource the first render needs, in one round trip. */
  bootstrap: () => Promise<AppBootstrapSnapshot>
  /** Returns cleanup fn. Fires as each bootstrap resource settles. */
  onBootstrapProgress: (callback: (progress: BootstrapProgress) => void) => Unsubscribe
}

export interface OnboardingAPI {
  getState: () => Promise<OnboardingState>
  completeStep: (step: OnboardingStepId) => Promise<OnboardingState>
  skipStep: (step: OnboardingStepId) => Promise<OnboardingState>
  setCurrentStep: (step: OnboardingStepId) => Promise<OnboardingState>
  /** Ends the wizard wherever it stands. */
  finish: () => Promise<OnboardingState>
  /** "Run setup again" — reopens the wizard; settings are untouched. */
  reset: () => Promise<OnboardingState>
  onStateChange: (callback: (state: OnboardingState) => void) => Unsubscribe
}

export interface AccountAPI {
  /** From the local cache — never blocks on the network. */
  getSession: () => Promise<import('./cloud/contracts').SessionSnapshot>
  signUp: (
    input: import('./cloud/contracts').SignUpInput,
  ) => Promise<import('./cloud/contracts').CloudResult<import('./cloud/contracts').SessionSnapshot>>
  signIn: (
    input: import('./cloud/contracts').SignInInput,
  ) => Promise<import('./cloud/contracts').CloudResult<import('./cloud/contracts').SessionSnapshot>>
  signOut: () => Promise<import('./cloud/contracts').SessionSnapshot>
  requestPasswordReset: (
    email: string,
  ) => Promise<import('./cloud/contracts').CloudResult<null>>
  /** Re-sends the confirmation code for the signed-in account. */
  resendVerification: () => Promise<import('./cloud/contracts').CloudResult<null>>
  /** Confirms the address with the six-digit code from the email. */
  verifyEmailCode: (
    code: string,
  ) => Promise<import('./cloud/contracts').CloudResult<import('./cloud/contracts').SessionSnapshot>>
  /** Shows a code to approve elsewhere; resolves as soon as the code exists. */
  startDevicePairing: () => Promise<import('./cloud/contracts').DevicePairingState>
  cancelDevicePairing: () => Promise<import('./cloud/contracts').DevicePairingState>
  getDevicePairing: () => Promise<import('./cloud/contracts').DevicePairingState>
  /** Opens a page of the web app in the system browser. */
  openWeb: (path?: string) => Promise<void>
  /** Re-pull org API keys from the cloud vault into local settings. */
  syncOrgSecrets: () => Promise<void>
  onSessionChange: (
    callback: (session: import('./cloud/contracts').SessionSnapshot) => void,
  ) => Unsubscribe
  onPairingChange: (
    callback: (state: import('./cloud/contracts').DevicePairingState) => void,
  ) => Unsubscribe
}

export type UpdateStatus =
  | { state: 'idle'; currentVersion?: string }
  | { state: 'checking' }
  | { state: 'available'; version: string; notes?: string }
  | { state: 'downloading'; version?: string; notes?: string; percent?: number }
  | { state: 'downloaded'; version: string; notes?: string }
  | { state: 'error'; message: string }

export interface UpdatesAPI {
  /** Last known status; 'idle' in dev and in unpackaged builds. */
  getStatus: () => Promise<UpdateStatus>
  /** Manual check. Resolves once the check settles. */
  check: () => Promise<UpdateStatus>
  /** Downloads a pending update. No-op unless status is 'available'. */
  download: () => Promise<UpdateStatus>
  /** Quits and installs. No-op unless status is 'downloaded'. */
  install: () => Promise<void>
  onStatus: (callback: (status: UpdateStatus) => void) => Unsubscribe
}

export interface ProAutomateAPI {
  services: import('./service-records').ServicesAPI
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
  documents: import('./documents').DocumentsAPI
  media: MediaAPI
  tracks: TracksAPI
  onboarding: OnboardingAPI
  account: AccountAPI
  updates: UpdatesAPI
}

export interface MediaAPI {
  importFiles: (kind: 'image' | 'video') => Promise<MediaLibrary>
  getLibrary: () => Promise<MediaLibrary>
  /** Native folder picker; resolves to the library for the folder that was chosen. */
  chooseFolder: () => Promise<MediaLibrary>
  rescan: () => Promise<MediaLibrary>
  /** Creates an empty subfolder in the media folder. Never moves existing files. */
  createFolder: (name: string) => Promise<MediaLibrary>
  /**
   * Puts a background on screen and cuts ProPresenter to the NDI video input.
   * `applied` is false when the overlay could not be sent.
   */
  push: (itemId: string) => Promise<{ applied: boolean }>
  clear: () => Promise<MediaLibrary>
  createPlaylist: (name: string) => Promise<MediaLibrary>
  renamePlaylist: (id: string, name: string) => Promise<MediaLibrary>
  deletePlaylist: (id: string) => Promise<MediaLibrary>
  setPlaylistItems: (id: string, itemIds: string[]) => Promise<MediaLibrary>
  /** Saves the operator's order for "All backgrounds". */
  setItemOrder: (itemIds: string[]) => Promise<MediaLibrary>
  /** Deletes the file from the backgrounds folder and drops every reference. */
  deleteItem: (itemId: string) => Promise<MediaLibrary>
  renameItem: (itemId: string, name: string) => Promise<MediaLibrary>
  revealItem: (itemId: string) => Promise<void>
  copyItems: (itemIds: string[]) => Promise<void>
  cutItems: (itemIds: string[], fromPlaylistId?: string) => Promise<void>
  pasteItems: (playlistId?: string) => Promise<MediaLibrary>
  clipboardHasFiles: () => Promise<boolean>
  /**
   * Native file picker, then add those backgrounds to the playlist.
   * Files already in the media folder are referenced; anything else is copied in.
   */
  addMediaToPlaylist: (playlistId: string) => Promise<MediaLibrary>
  setPlayback: (itemId: string, playback: Partial<MediaPlayback>) => Promise<MediaLibrary>
  /** Pause or resume the video currently on screen. No-op when an image is live. */
  setPaused: (paused: boolean) => Promise<MediaLibrary>
  /** Scrub the live video. No-op when an image is live. */
  seek: (seconds: number) => Promise<void>
  onLibraryChange: (callback: (library: MediaLibrary) => void) => () => void
}

export interface TracksAPI {
  getLibrary: () => Promise<TracksLibrary>
  rescan: () => Promise<TracksLibrary>
  chooseFolder: () => Promise<TracksLibrary>
  importFiles: () => Promise<TracksLibrary>
  play: (itemId: string) => Promise<TracksLibrary>
  setPaused: (paused: boolean) => Promise<TracksLibrary>
  stop: () => Promise<TracksLibrary>
  onLibraryChange: (callback: (library: TracksLibrary) => void) => () => void
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
    CLEAR_TEXT:     'propresenter:clearText',       // invoke
    CLEAR_OVERLAY:  'propresenter:clearOverlay',    // invoke
    GET_LOOKS:      'propresenter:getLooks',        // invoke — PPLook[]
    GET_RESOURCE_CATALOGUE: 'propresenter:getResourceCatalogue',
    GET_RESOURCE_DETAILS:   'propresenter:getResourceDetails',
    GET_RESOURCE_PREVIEW:   'propresenter:getResourcePreview',
    SET_RESOURCE_BINDINGS:  'propresenter:setResourceBindings',
    STATUS_CHANGE:  'propresenter:statusChange',    // push
  },
  AUDIO: {
    STOP_CAPTURE:   'audio:stopCapture',            // invoke
    PCM_CHUNK:      'audio:pcmChunk',               // renderer→main send
    LEVEL:          'audio:level',                  // push
    ERROR:          'audio:error',                  // push
  },
  APP: {
    IMPORT_REQUESTED: 'app:importRequested',
    IMPORT_READY: 'app:importReady',
    BOOTSTRAP:          'app:bootstrap',          // invoke
    BOOTSTRAP_PROGRESS: 'app:bootstrapProgress',  // push
  },
  SCRIPTURE: {
    APPROVE:                'scripture:approve',                 // invoke
    DISMISS:                'scripture:dismiss',                 // invoke
    REGISTER:               'scripture:register',                // invoke
    PRESENT_DIRECTLY:       'scripture:presentDirectly',         // invoke
    SEARCH:                 'scripture:search',                  // invoke
    GET_TRANSLATIONS:       'scripture:getTranslations',         // invoke
    SET_TRANSLATION:        'scripture:setTranslation',         // invoke
    IMPORT_SERMON_NOTES:    'scripture:importSermonNotes',       // invoke
    SCAN_SERMON_NOTES:      'scripture:scanSermonNotes',         // invoke
    LIST_SERMON_PLANS:      'scripture:listSermonPlans',         // invoke
    SAVE_SERMON_PLAN:       'scripture:saveSermonPlan',          // invoke
    DELETE_SERMON_PLAN:     'scripture:deleteSermonPlan',        // invoke
    RECENT_TRACES:          'scripture:recentTraces',            // invoke
    MARK_RENDERED:          'scripture:markRendered',            // send
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
  MEDIA: {
    IMPORT_FILES: 'media:importFiles',
    GET_LIBRARY:     'media:getLibrary',            // invoke
    CHOOSE_FOLDER:   'media:chooseFolder',          // invoke
    RESCAN:          'media:rescan',                // invoke
    CREATE_FOLDER:   'media:createFolder',           // invoke
    PUSH:            'media:push',                  // invoke
    CLEAR:           'media:clear',                 // invoke
    CREATE_PLAYLIST: 'media:createPlaylist',        // invoke
    RENAME_PLAYLIST: 'media:renamePlaylist',        // invoke
    DELETE_PLAYLIST: 'media:deletePlaylist',        // invoke
    SET_PLAYLIST_ITEMS: 'media:setPlaylistItems',   // invoke
    SET_ITEM_ORDER:  'media:setItemOrder',          // invoke
    DELETE_ITEM:     'media:deleteItem',            // invoke
    RENAME_ITEM:     'media:renameItem',            // invoke
    REVEAL_ITEM:     'media:revealItem',            // invoke
    COPY_ITEMS:      'media:copyItems',             // invoke
    CUT_ITEMS:       'media:cutItems',              // invoke
    PASTE_ITEMS:     'media:pasteItems',            // invoke
    CLIPBOARD_HAS_FILES: 'media:clipboardHasFiles', // invoke
    ADD_MEDIA_TO_PLAYLIST: 'media:addMediaToPlaylist', // invoke
    SET_PLAYBACK:    'media:setPlayback',           // invoke
    SET_PAUSED:      'media:setPaused',             // invoke
    SEEK:            'media:seek',                  // invoke
    LIBRARY:         'media:library',               // push (MediaLibrary)
  },
  TRACKS: {
    GET_LIBRARY:     'tracks:getLibrary',
    RESCAN:          'tracks:rescan',
    CHOOSE_FOLDER:   'tracks:chooseFolder',
    IMPORT_FILES:    'tracks:importFiles',
    PLAY:            'tracks:play',
    SET_PAUSED:      'tracks:setPaused',
    STOP:            'tracks:stop',
    LIBRARY:         'tracks:library',
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
    PUSH_SLIDE:      'lyrics:pushSlide',             // invoke
    ADD_TO_PLAYLIST: 'lyrics:addToPlaylist',        // invoke
    TRANSLATE:       'lyrics:translate',            // invoke
  },
  UPDATES: {
    GET_STATUS: 'updates:getStatus',   // invoke — UpdateStatus
    CHECK:      'updates:check',       // invoke — UpdateStatus
    DOWNLOAD:   'updates:download',    // invoke — UpdateStatus
    INSTALL:    'updates:install',     // invoke — quits the app
    STATUS:     'updates:status',      // push (UpdateStatus)
  },
  SETTINGS: {
    GET:            'settings:get',                 // invoke
    SET:            'settings:set',                 // invoke
    GET_ALL:        'settings:getAll',              // invoke
    TEST_API_KEY:   'settings:testApiKey',          // invoke
    CHANGED:        'settings:changed',             // push — secrets hydrated / saved
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
  ACCOUNT: {
    GET_SESSION:            'account:getSession',            // invoke — SessionSnapshot
    SIGN_UP:                'account:signUp',                // invoke
    SIGN_IN:                'account:signIn',                // invoke
    SIGN_OUT:               'account:signOut',               // invoke
    REQUEST_PASSWORD_RESET: 'account:requestPasswordReset',  // invoke
    RESEND_VERIFICATION:    'account:resendVerification',    // invoke
    VERIFY_EMAIL_CODE:      'account:verifyEmailCode',       // invoke
    START_DEVICE_PAIRING:   'account:startDevicePairing',    // invoke
    CANCEL_DEVICE_PAIRING:  'account:cancelDevicePairing',   // invoke
    GET_DEVICE_PAIRING:     'account:getDevicePairing',      // invoke
    OPEN_WEB:               'account:openWeb',               // invoke
    SYNC_ORG_SECRETS:       'account:syncOrgSecrets',        // invoke — pull vault → local
    SESSION_CHANGED:        'account:sessionChanged',        // push (SessionSnapshot)
    PAIRING_CHANGED:        'account:pairingChanged',        // push (DevicePairingState)
  },
  ONBOARDING: {
    GET_STATE:     'onboarding:getState',       // invoke — OnboardingState
    COMPLETE_STEP: 'onboarding:completeStep',   // invoke
    SKIP_STEP:     'onboarding:skipStep',       // invoke
    SET_CURRENT:   'onboarding:setCurrent',     // invoke
    FINISH:        'onboarding:finish',         // invoke
    RESET:         'onboarding:reset',          // invoke
    STATE:         'onboarding:state',          // push (OnboardingState)
  },
} as const
