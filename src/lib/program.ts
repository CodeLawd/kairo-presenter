// ─── Program layers, stage displays and show controls (standalone phases 2–3) ──
// Pure — no Node/DOM APIs — importable from main, preload, and renderer alike.
//
// `presentation` (settings) is what the operator configures once: transition,
// message style, props, logo, stage displays, program audio. `ProgramState` is
// what is happening right now — the message on screen, the running timer, the
// slide that is live and the one after it. It is never persisted.
//
// Everything that turns operator text into markup lives here and escapes it,
// so the program windows only ever receive finished, safe HTML.

import { escapeAndBreak, escapeHtml, overlayMediaUrl } from './overlay-template'
import { formatMediaClock } from './media-playback'
import { asObject, clampNum, safeBool, safeColor, safeEnum, safeString } from './normalize'
import type { Unsubscribe } from './ipc'

// ─── Settings ──────────────────────────────────────────────────────────────────

export type TransitionKind = 'cut' | 'fade'

export interface ProgramTransition {
  kind: TransitionKind
  /** Fade length. Ignored for `cut`. 50–3000. */
  durationMs: number
}

export interface ProgramMessageStyle {
  position: 'bottom' | 'top'
  /** 16–160, in 1920-wide frame pixels. */
  fontSizePx: number
  color: string
  background: string
  /** Scroll right-to-left as a ticker instead of sitting still. */
  scroll: boolean
}

export type PropPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'

/** An image pinned over the slide — a logo bug, a "Welcome" corner card. */
export interface ProgramProp {
  id: string
  name: string
  mediaPath: string
  position: PropPosition
  /** Width as a share of the frame. 2–100. */
  widthPct: number
  /** Distance from the edges, as a share of the frame width. 0–20. */
  marginPct: number
  opacity: number
}

/** "To logo": one image on a colour, covering everything. */
export interface ProgramLogo {
  mediaPath: string
  background: string
}

/** A confidence monitor on its own display: current, next, clock, countdown. */
export interface StageDisplayConfig {
  id: string
  name: string
  enabled: boolean
  displayId: number | null
  displayLabel: string
  displaySize: { width: number; height: number } | null
  showNext: boolean
  showClock: boolean
  showTimer: boolean
}

/** Sound from video backgrounds and the camera input. Played by exactly one program surface. */
export interface ProgramAudioSettings {
  /** Sound from background videos (camera sound follows its own audio-input choice). */
  enabled: boolean
  /** 0–1. */
  volume: number
  /** Output device label; '' = system default. */
  outputLabel: string
  /**
   * Also send program sound (videos, camera) with every NDI feed. Needs the
   * NDI 6 (grandi) binding — the legacy grandiose-mac sender has no audio.
   */
  ndi: boolean
}

export interface PresentationSettings {
  transition: ProgramTransition
  message: ProgramMessageStyle
  props: ProgramProp[]
  logo: ProgramLogo
  stageDisplays: StageDisplayConfig[]
  audio: ProgramAudioSettings
}

export const DEFAULT_PRESENTATION_SETTINGS: PresentationSettings = {
  transition: { kind: 'cut', durationMs: 400 },
  message: {
    position: 'bottom',
    fontSizePx: 44,
    color: '#ffffff',
    background: 'rgba(0,0,0,0.72)',
    scroll: false,
  },
  props: [],
  logo: { mediaPath: '', background: '#000000' },
  stageDisplays: [],
  // Video sound on by default, as in ProPresenter: a countdown or a clip with
  // audio should be heard; silent motion loops are unaffected.
  audio: { enabled: true, volume: 1, outputLabel: '', ndi: false },
}

// ─── Normalizer ────────────────────────────────────────────────────────────────

const PROP_POSITIONS: readonly PropPosition[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center']

function normalizeProps(raw: unknown): ProgramProp[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const props: ProgramProp[] = []
  for (const item of raw) {
    const r = asObject(item)
    const id = safeString(r.id, '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    props.push({
      id,
      name: safeString(r.name, 'Prop').trim() || 'Prop',
      mediaPath: safeString(r.mediaPath, '').trim(),
      position: safeEnum(r.position, PROP_POSITIONS, 'top-right'),
      widthPct: clampNum(r.widthPct, 2, 100, 12),
      marginPct: clampNum(r.marginPct, 0, 20, 2),
      opacity: clampNum(r.opacity, 0, 1, 1),
    })
  }
  return props
}

function normalizeStageDisplays(raw: unknown): StageDisplayConfig[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const taken = new Set<number>()
  const displays: StageDisplayConfig[] = []
  for (const item of raw) {
    const r = asObject(item)
    const id = safeString(r.id, '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    const displayId = typeof r.displayId === 'number' && Number.isSafeInteger(r.displayId) ? r.displayId : null
    let enabled = safeBool(r.enabled, false)
    // Two stage windows on one display would sit on top of each other.
    if (enabled && displayId !== null) {
      if (taken.has(displayId)) enabled = false
      else taken.add(displayId)
    }
    const size = asObject(r.displaySize)
    const width = size.width
    const height = size.height
    displays.push({
      id,
      name: safeString(r.name, 'Stage display').trim() || 'Stage display',
      enabled,
      displayId,
      displayLabel: safeString(r.displayLabel, '').trim(),
      displaySize:
        typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0
          ? { width, height }
          : null,
      showNext: safeBool(r.showNext, true),
      showClock: safeBool(r.showClock, true),
      showTimer: safeBool(r.showTimer, true),
    })
  }
  return displays
}

export function normalizePresentationSettings(raw: unknown): PresentationSettings {
  const d = DEFAULT_PRESENTATION_SETTINGS
  const r = asObject(raw)
  const t = asObject(r.transition)
  const m = asObject(r.message)
  const l = asObject(r.logo)
  const a = asObject(r.audio)
  return {
    transition: {
      kind: safeEnum(t.kind, ['cut', 'fade'] as const, d.transition.kind),
      durationMs: Math.round(clampNum(t.durationMs, 50, 3000, d.transition.durationMs)),
    },
    message: {
      position: safeEnum(m.position, ['bottom', 'top'] as const, d.message.position),
      fontSizePx: Math.round(clampNum(m.fontSizePx, 16, 160, d.message.fontSizePx)),
      color: safeColor(m.color, d.message.color),
      background: safeColor(m.background, d.message.background),
      scroll: safeBool(m.scroll, d.message.scroll),
    },
    props: normalizeProps(r.props),
    logo: {
      mediaPath: safeString(l.mediaPath, '').trim(),
      background: safeColor(l.background, d.logo.background),
    },
    stageDisplays: normalizeStageDisplays(r.stageDisplays),
    audio: {
      enabled: safeBool(a.enabled, d.audio.enabled),
      volume: clampNum(a.volume, 0, 1, d.audio.volume),
      outputLabel: safeString(a.outputLabel, '').trim(),
      ndi: safeBool(a.ndi, d.audio.ndi),
    },
  }
}

/** The fade length a program window should use; 0 = cut. */
export function transitionMs(transition: ProgramTransition): number {
  return transition.kind === 'fade' ? transition.durationMs : 0
}

/** Media the pa-media:// protocol may serve on behalf of `presentation`. */
export function presentationMediaPaths(raw: unknown): string[] {
  const settings = normalizePresentationSettings(raw)
  return [settings.logo.mediaPath, ...settings.props.map((p) => p.mediaPath)].filter((p) => p !== '')
}

// ─── Runtime state ─────────────────────────────────────────────────────────────

export interface ProgramSlideInfo {
  /** Song and section, Bible reference, or "Page 3 of 12". */
  reference: string
  text: string
}

/**
 * A countdown. Running: `endsAt` is set and remaining time is derived from the
 * clock, so nothing has to tick over IPC. Paused / stopped: `remainingSec`.
 */
export interface ProgramTimerState {
  durationSec: number
  endsAt: number | null
  remainingSec: number
}

export interface ProgramState {
  /** Audience message on the program screens, or null. */
  message: string | null
  /** Message for the stage displays only. */
  stageMessage: string | null
  activePropIds: string[]
  logo: boolean
  /** Label of the live camera / capture input, or null. */
  camera: string | null
  /** Label of the audio input played with the camera, or null for a silent camera. */
  cameraAudio: string | null
  timer: ProgramTimerState
  current: ProgramSlideInfo | null
  next: ProgramSlideInfo | null
}

export const EMPTY_PROGRAM_STATE: ProgramState = {
  message: null,
  stageMessage: null,
  activePropIds: [],
  logo: false,
  camera: null,
  cameraAudio: null,
  timer: { durationSec: 300, endsAt: null, remainingSec: 300 },
  current: null,
  next: null,
}

/** Seconds left on the countdown at `now`. Goes negative once it overruns. */
export function timerRemainingSec(timer: ProgramTimerState, now: number): number {
  if (timer.endsAt === null) return timer.remainingSec
  return Math.ceil((timer.endsAt - now) / 1000)
}

export function timerRunning(timer: ProgramTimerState): boolean {
  return timer.endsAt !== null
}

/** `5:00`, `1:02:03`, `-0:12` for an overrun. */
export function formatTimer(seconds: number): string {
  return `${seconds < 0 ? '-' : ''}${formatMediaClock(Math.abs(Math.trunc(seconds)))}`
}

export function startTimer(timer: ProgramTimerState, now: number): ProgramTimerState {
  if (timer.endsAt !== null) return timer
  return { ...timer, endsAt: now + timer.remainingSec * 1000 }
}

export function pauseTimer(timer: ProgramTimerState, now: number): ProgramTimerState {
  if (timer.endsAt === null) return timer
  return { ...timer, endsAt: null, remainingSec: timerRemainingSec(timer, now) }
}

export function resetTimer(timer: ProgramTimerState, durationSec = timer.durationSec): ProgramTimerState {
  const duration = Math.max(0, Math.min(24 * 3600, Math.round(durationSec)))
  return { durationSec: duration, endsAt: null, remainingSec: duration }
}

// ─── Markup for the program layers ─────────────────────────────────────────────

/** Audience message bar. Empty text → '' (layer cleared). */
export function renderMessageHTML(text: string | null, style: ProgramMessageStyle): string {
  const body = (text ?? '').trim()
  if (!body) return ''
  const edge = style.position === 'top' ? 'top:0;' : 'bottom:0;'
  const bar = [
    'position:absolute;left:0;right:0;',
    edge,
    `background:${style.background};`,
    `color:${style.color};`,
    `font-size:${style.fontSizePx}px;`,
    "font-family:'Source Sans 3','Helvetica Neue',Arial,sans-serif;",
    'font-weight:600;line-height:1.25;',
    `padding:${Math.round(style.fontSizePx * 0.45)}px ${Math.round(style.fontSizePx * 0.8)}px;`,
    'overflow:hidden;white-space:nowrap;',
  ].join('')
  if (style.scroll) {
    // Starts off the right edge (padding-left:100%) and runs until it has left
    // the left edge. Speed scales with the text so a long notice is readable.
    const seconds = Math.max(8, Math.round(body.length * 0.22))
    return `<div class="pa-message"><div style="${bar}"><div style="display:inline-block;padding-left:100%;animation:pa-ticker ${seconds}s linear infinite;">${escapeHtml(body.replace(/\s*\n\s*/g, '   ·   '))}</div></div></div>`
  }
  return `<div class="pa-message"><div style="${bar}white-space:normal;text-align:center;">${escapeAndBreak(body)}</div></div>`
}

function propPlacement(prop: ProgramProp): string {
  const margin = `${prop.marginPct}%`
  switch (prop.position) {
    case 'top-left':
      return `top:${margin};left:${margin};`
    case 'bottom-left':
      return `bottom:${margin};left:${margin};`
    case 'bottom-right':
      return `bottom:${margin};right:${margin};`
    case 'center':
      return 'top:50%;left:50%;transform:translate(-50%,-50%);'
    case 'top-right':
    default:
      return `top:${margin};right:${margin};`
  }
}

/** Every active prop in one layer. No active props → ''. */
export function renderPropsHTML(props: readonly ProgramProp[], activeIds: readonly string[]): string {
  const active = props.filter((p) => activeIds.includes(p.id) && p.mediaPath)
  if (active.length === 0) return ''
  const images = active
    .map(
      (p) =>
        `<img src="${escapeHtml(overlayMediaUrl(p.mediaPath))}" alt="" style="position:absolute;${propPlacement(p)}width:${p.widthPct}%;height:auto;opacity:${p.opacity};">`,
    )
    .join('')
  return `<div class="pa-props">${images}</div>`
}

/** Full-frame logo. Off → ''. A logo with no image is just the colour. */
export function renderLogoHTML(logo: ProgramLogo, on: boolean): string {
  if (!on) return ''
  const image = logo.mediaPath
    ? `<img src="${escapeHtml(overlayMediaUrl(logo.mediaPath))}" alt="" style="width:100%;height:100%;object-fit:contain;display:block;">`
    : ''
  return `<div class="pa-logo" style="background:${logo.background};">${image}</div>`
}

// ─── Per-output content filters (E8) ───────────────────────────────────────────

/** What a rendered output (`ndi` / `screen`) is allowed to show. */
export interface OutputShowFilter {
  scripture: boolean
  lyrics: boolean
  documents: boolean
  backgrounds: boolean
  messages: boolean
  /** Logo and props. */
  overlays: boolean
}

export const SHOW_EVERYTHING: OutputShowFilter = {
  scripture: true,
  lyrics: true,
  documents: true,
  backgrounds: true,
  messages: true,
  overlays: true,
}

export const OUTPUT_SHOW_KEYS: readonly (keyof OutputShowFilter)[] = [
  'scripture',
  'lyrics',
  'documents',
  'backgrounds',
  'messages',
  'overlays',
]

export function outputShowLabel(key: keyof OutputShowFilter): string {
  switch (key) {
    case 'scripture': return 'Scripture'
    case 'lyrics': return 'Lyrics'
    case 'documents': return 'Documents'
    case 'backgrounds': return 'Backgrounds'
    case 'messages': return 'Messages'
    case 'overlays': return 'Logo & props'
  }
}

export function normalizeShowFilter(raw: unknown): OutputShowFilter {
  const r = asObject(raw)
  return {
    scripture: safeBool(r.scripture, true),
    lyrics: safeBool(r.lyrics, true),
    documents: safeBool(r.documents, true),
    backgrounds: safeBool(r.backgrounds, true),
    messages: safeBool(r.messages, true),
    overlays: safeBool(r.overlays, true),
  }
}

// ─── Stage display status ──────────────────────────────────────────────────────

export interface StageDisplayStatus {
  id: string
  ready: boolean
  reason: string
}

// ─── IPC ───────────────────────────────────────────────────────────────────────

export const PROGRAM = {
  GET_STATE: 'program:getState',
  STATE: 'program:state', // push (ProgramState)
  SHOW_MESSAGE: 'program:showMessage',
  CLEAR_MESSAGE: 'program:clearMessage',
  SET_STAGE_MESSAGE: 'program:setStageMessage',
  SET_PROP: 'program:setProp',
  CLEAR_PROPS: 'program:clearProps',
  SET_LOGO: 'program:setLogo',
  SET_CAMERA: 'program:setCamera',
  TIMER_SET: 'program:timerSet',
  TIMER_START: 'program:timerStart',
  TIMER_PAUSE: 'program:timerPause',
  TIMER_RESET: 'program:timerReset',
  PICK_IMAGE: 'program:pickImage',
  STAGE_STATUS: 'program:stageStatus',
  /** push (StageDisplayStatus[]) — whenever a reconcile changes it. */
  STAGE_STATUS_CHANGED: 'program:stageStatusChanged',
  /** send (program window → main): a block of program sound for NDI. */
  NDI_AUDIO: 'program:ndiAudio',
  NDI_AUDIO_SUPPORTED: 'program:ndiAudioSupported',
} as const

export interface ProgramAPI {
  getState: () => Promise<ProgramState>
  onState: (callback: (state: ProgramState) => void) => Unsubscribe
  showMessage: (text: string) => Promise<ProgramState>
  clearMessage: () => Promise<ProgramState>
  setStageMessage: (text: string | null) => Promise<ProgramState>
  setProp: (id: string, on: boolean) => Promise<ProgramState>
  clearProps: () => Promise<ProgramState>
  setLogo: (on: boolean) => Promise<ProgramState>
  /**
   * Camera label, or null to take the camera down. `audioLabel` is the audio
   * input played with it (a capture card's own, or a mic); null = silent.
   */
  setCamera: (label: string | null, audioLabel?: string | null) => Promise<ProgramState>
  timer: {
    set: (durationSec: number) => Promise<ProgramState>
    start: () => Promise<ProgramState>
    pause: () => Promise<ProgramState>
    reset: () => Promise<ProgramState>
  }
  /** Native image picker for logo / props. Null when cancelled. */
  pickImage: () => Promise<string | null>
  stageStatus: () => Promise<StageDisplayStatus[]>
  onStageStatus: (callback: (status: StageDisplayStatus[]) => void) => Unsubscribe
  /** Whether NDI feeds can carry sound here (the NDI 6 binding is loaded). */
  ndiAudioSupported: () => Promise<boolean>
}
