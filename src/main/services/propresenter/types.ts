// ─── Shared primitives ────────────────────────────────────────────────────────

/** ProPresenter identifies most resources with a composite ID object. */
export interface PPItemId {
  uuid: string
  name: string
  index: number
}

// ─── Version ──────────────────────────────────────────────────────────────────

export interface PPVersionResponse {
  major: number
  minor: number
  patch: number
  build_number: string
  os_version?: string
}

// ─── Library ──────────────────────────────────────────────────────────────────

export interface PPLibraryItem {
  id: PPItemId
  playlist?: PPItemId
}

export interface PPLibrary {
  id: PPItemId
  items?: PPLibraryItem[]
}

// ─── Playlists ────────────────────────────────────────────────────────────────

export type PPPlaylistItemType = 'presentation' | 'header' | 'video' | 'audio'

export interface PPPlaylistItem {
  id: PPItemId
  type: PPPlaylistItemType
  location?: string
  is_header?: boolean
}

export interface PPPlaylist {
  id: PPItemId
  /** Present on GET /v1/playlist/{id}; often omitted on the /v1/playlists index. */
  items?: PPPlaylistItem[]
}

// ─── Slides & Presentations ───────────────────────────────────────────────────

export interface PPTextElement {
  text: string
  position: {
    x: number
    y: number
    width: number
    height: number
  }
}

export interface PPSlide {
  id: PPItemId
  label: string
  notes: string
  thumbnail?: string
  text_elements?: PPTextElement[]
}

export interface PPSlideGroup {
  id: PPItemId
  slides: PPSlide[]
  group_color?: string
}

export interface PPPresentation {
  id: PPItemId
  slide_groups: PPSlideGroup[]
  total_count?: number
  has_timeline?: boolean
}

export interface PPActivePresentationResponse {
  presentation: PPPresentation
  current_slide: number
  total_slides: number
}

// ─── Status ───────────────────────────────────────────────────────────────────

export interface PPPresentationStatus {
  slide_index: number | null
  presentation_id: PPItemId | null
  playlist_id: PPItemId | null
}

export interface PPStageDisplayStatus {
  message: string | null
  layout_uuid: string | null
}

export interface PPAudioStatus {
  is_playing: boolean
  volume: number
  position: number
  duration: number
}

export interface PPStatusResponse {
  presentation?: PPPresentationStatus
  stage_display?: PPStageDisplayStatus
  audio?: PPAudioStatus
}

// ─── Streaming updates ────────────────────────────────────────────────────────

export interface PPStreamUpdate {
  url: string
  data: unknown
}

// ─── Create presentation ──────────────────────────────────────────────────────

export interface PPCreateSlide {
  label: string
  notes?: string
  lines: string[]
}

/** A named group of slides — used for multi-section song presentations. */
export interface PPSlideGroupSpec {
  name: string
  slides: PPCreateSlide[]
}

export interface PPCreatePresentationRequest {
  id: {
    name: string
    uuid?: string
  }
  slide_groups: {
    id: { name: string }
    slides: {
      id: { name: string }
      label: string
      notes?: string
      text_elements: PPTextElement[]
    }[]
  }[]
}

// ─── Messages ─────────────────────────────────────────────────────────────────

export interface PPMessageToken {
  name: string
  uuid?: string
  text: { text: string }
}

export interface PPMessage {
  id: PPItemId
  message: string
  tokens: PPMessageToken[]
  theme: PPItemId
  visible_on_network: boolean
  is_active: boolean
}

// ─── Stage display ────────────────────────────────────────────────────────────

export interface PPStageMessageRequest {
  message: string
}

// ─── Video inputs (NDI overlay, phase 2) ───────────────────────────────────────

/** Normalized shape of a `GET /v1/video_inputs` entry — PP's raw JSON may nest under `id`. */
export interface PPVideoInput {
  uuid: string
  name: string
}

// ─── Looks (phase 3 — per-screen layer visibility) ─────────────────────────────

/**
 * Normalized shape of a `GET /v1/looks` entry. A Look is what actually decides
 * which layers each configured screen shows, so it is the only lever this app
 * has over "pastor sees X, main screen sees Y".
 */
export interface PPLookSummary {
  id: string
  name: string
}

// ─── Connection events ────────────────────────────────────────────────────────

export type PPConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface PPClientEvents {
  connected: (version: PPVersionResponse) => void
  disconnected: () => void
  error: (err: Error) => void
  reconnecting: (attempt: number, delayMs: number) => void
  update: (update: PPStreamUpdate) => void
  'status-change': (state: PPConnectionState) => void
}
