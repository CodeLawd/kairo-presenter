import type { PollView } from './engage'
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

export type ProgramQuestion = { text: string; author: string | null } | { kind: 'join'; code: string; url: string; qrDataUrl: string }

export type ProgramQuestionFont = 'sans' | 'serif' | 'mono'

export interface ProgramQuestionStyle {
  position: 'top' | 'center' | 'bottom'
  align: 'left' | 'center'
  fontFamily: ProgramQuestionFont
  fontSizePx: number
  color: string
  background: string
  /** Card background opacity, 0–100. */
  backgroundOpacity: number
  /** Card corner radius, 0–48 px. */
  borderRadiusPx: number
  /** Card width as percentage of the 1600px container, 50–100. */
  widthPct: number
  /** Whether to show the question author name on screen. */
  showAuthor: boolean
  /** Join screen prompt headline ("Ask a question"). */
  joinHeadline: string
  /** QR code size on screen, 160–400 px. */
  qrSizePx: number
  /** Whether to show the join URL under the code on screen. */
  showJoinUrl: boolean
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

/** How the countdown looks and behaves on screens and stage displays. */
export interface ProgramTimerStyle {
  /** Keep counting past 0:00 into overtime (-0:12). Off: stop at 0:00. */
  rollover: boolean
  color: string
  /** Overtime, or 0:00 once time is up without roll over. */
  overrunColor: string
  /** A dark bar behind the clock and countdown on screens, for legibility over slides. */
  backdrop: boolean
}

/** Where an old one-image prop was pinned; read only to convert saved props. */
export type PropPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'

/**
 * Where an object sits on the frame, each a share of it (0–1) so a prop looks
 * the same on any screen shape: x/y from the top-left, w/h its size.
 */
export interface PropBox {
  x: number
  y: number
  w: number
  h: number
}

interface PropObjectCommon extends PropBox {
  id: string
  opacity: number
}

export interface PropTextObject extends PropObjectCommon {
  kind: 'text'
  text: string
  /** Pixels on a 1920-wide frame, like every other overlay size. */
  fontSizePx: number
  color: string
  bold: boolean
  align: 'left' | 'center' | 'right'
}

/**
 * The live countdown as part of a prop. Its time comes from the timer on
 * screens; the box, size and colour are the prop's own, so a church can place
 * and style it anywhere — the Props editor is where it is built.
 */
export interface PropTimerObject extends PropObjectCommon {
  kind: 'timer'
  /** Pixels on a 1920-wide frame, like every other overlay size. */
  fontSizePx: number
  color: string
  /** Overtime, or 0:00 once time is up without roll over. */
  overrunColor: string
  bold: boolean
  align: 'left' | 'center' | 'right'
}

export interface PropShapeObject extends PropObjectCommon {
  kind: 'shape'
  shape: 'rectangle' | 'ellipse'
  fill: string
  /** Corner rounding for a rectangle, frame pixels. */
  radiusPx: number
}

export interface PropImageObject extends PropObjectCommon {
  kind: 'image'
  mediaPath: string
  fit: 'contain' | 'cover'
}

export type PropObject = PropTextObject | PropTimerObject | PropShapeObject | PropImageObject
export type PropObjectKind = PropObject['kind']

/**
 * Something laid over the slide — a logo bug, a "Welcome" card, a lower
 * banner — built like a ProPresenter prop: text, a timer, shapes and images, stacked
 * in order (first is at the back), on a clear or coloured frame.
 */
export interface ProgramProp {
  id: string
  name: string
  /** A colour behind the whole frame; null = clear, the slide shows through. */
  background: string | null
  objects: PropObject[]
}

/** Limits that keep a saved prop sane. */
export const MAX_PROP_OBJECTS = 40
export const MAX_PROP_TEXT_LENGTH = 1000

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
   * NDI 6 (grandi) binding.
   */
  ndi: boolean
}

/** How a live video input sits with the presentation on screen. */
export type VideoLayout = 'full' | 'pip' | 'split'

/** The PiP box as shares of the frame (0–100), so it can sit anywhere. */
export interface VideoBox {
  xPct: number
  yPct: number
  widthPct: number
  heightPct: number
}

export interface VideoSettings {
  /** Full screen behind the words, a picture-in-picture inset, or side by side. */
  layout: VideoLayout
  /** PiP: where the video sits and how large it is. */
  box: VideoBox
  /** PiP: rounded corners in 1920-frame pixels. */
  radiusPx: number
  /** Side by side: which side the video takes. */
  side: 'left' | 'right'
  /** Side by side: the video's share of the width, percent. */
  splitPct: number
}

export const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  layout: 'full',
  box: { xPct: 68, yPct: 68, widthPct: 30, heightPct: 30 },
  radiusPx: 12,
  side: 'right',
  splitPct: 50,
}

/** A message kept ready to show, like ProPresenter's Messages list. */
export interface ProgramSavedMessage {
  id: string
  text: string
}

/** How many saved messages are kept, and how long one may be. */
export const MAX_SAVED_MESSAGES = 50
export const MAX_SAVED_MESSAGE_LENGTH = 500

/** How one timer is drawn on screens: the same object model as a prop. */
export interface TimerTheme {
  /** A colour behind the whole frame; null = clear, the slide shows through. */
  background: string | null
  /** Text, shapes, images and the readout itself, back to front. */
  objects: PropObject[]
}

/** A readout in the top centre, styled like the old on-screen countdown. */
export function defaultTimerTheme(color = '#5eead4', overrunColor = '#f87171'): TimerTheme {
  return {
    background: null,
    objects: [{
      id: 'timer-readout',
      kind: 'timer',
      x: 0.3, y: 0.05, w: 0.4, h: 0.12, opacity: 1,
      fontSizePx: 96, color, overrunColor, bold: true, align: 'center',
    }],
  }
}

/**
 * A timer the operator keeps ready, like ProPresenter's Timers list: a
 * countdown of a set length, or a countdown to a time of day ("service
 * starts at 10:00").
 */
export interface ProgramTimerDef {
  id: string
  name: string
  kind: 'countdown' | 'countdownTo'
  /** Length of a countdown, seconds. */
  durationSec: number
  /** Time of day a countdownTo runs to, 24-hour `HH:MM`. */
  targetTime: string
  /** Keep counting into overtime (-0:12) after 0:00, rather than stopping. */
  overrun: boolean
  /** How it renders on screens, designed in the Timers editor. */
  theme: TimerTheme
}

export const MAX_PROGRAM_TIMERS = 20

export interface PresentationSettings {
  transition: ProgramTransition
  question: ProgramQuestionStyle
  message: ProgramMessageStyle
  /** Messages the operator keeps for reuse ("Parents of child…", "Cars in the red zone…"). */
  messages: ProgramSavedMessage[]
  props: ProgramProp[]
  logo: ProgramLogo
  stageDisplays: StageDisplayConfig[]
  audio: ProgramAudioSettings
  /** Video input layout on screens (full, picture-in-picture, side by side). */
  video: VideoSettings
  /** The timers, in list order. Never empty: there is always one to show. */
  timers: ProgramTimerDef[]
}

export const DEFAULT_TIMER: ProgramTimerDef = {
  id: 'timer-main',
  name: 'Countdown',
  kind: 'countdown',
  durationSec: 300,
  targetTime: '10:00',
  overrun: true,
  theme: defaultTimerTheme(),
}

export const DEFAULT_PRESENTATION_SETTINGS: PresentationSettings = {
  transition: { kind: 'cut', durationMs: 400 },
  question: {
    position: 'center',
    align: 'left',
    fontFamily: 'sans',
    fontSizePx: 64,
    color: '#ffffff',
    background: '#18212d',
    backgroundOpacity: 95,
    borderRadiusPx: 24,
    widthPct: 85,
    showAuthor: true,
    joinHeadline: 'Ask a question',
    qrSizePx: 280,
    showJoinUrl: true,
  },
  message: {
    position: 'bottom',
    fontSizePx: 44,
    color: '#ffffff',
    background: 'rgba(0,0,0,0.72)',
    scroll: false,
  },
  messages: [],
  props: [],
  logo: { mediaPath: '', background: '#000000' },
  stageDisplays: [],
  // Video sound on by default, as in ProPresenter: a countdown or a clip with
  // audio should be heard; silent motion loops are unaffected.
  audio: { enabled: true, volume: 1, outputLabel: '', ndi: false },
  video: DEFAULT_VIDEO_SETTINGS,
  timers: [DEFAULT_TIMER],
}

// ─── Normalizer ────────────────────────────────────────────────────────────────

const PROP_POSITIONS: readonly PropPosition[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center']

const PROP_ALIGNS = ['left', 'center', 'right'] as const

function normalizeBox(r: Record<string, unknown>): PropBox {
  const w = clampNum(r.w, 0.01, 1, 0.3)
  const h = clampNum(r.h, 0.01, 1, 0.2)
  return {
    x: clampNum(r.x, 0, 1 - w, 0.05),
    y: clampNum(r.y, 0, 1 - h, 0.05),
    w,
    h,
  }
}

function normalizePropObject(raw: unknown, seen: Set<string>): PropObject | null {
  const r = asObject(raw)
  const id = safeString(r.id, '').trim()
  if (!id || seen.has(id)) return null
  seen.add(id)
  const common = { id, ...normalizeBox(r), opacity: clampNum(r.opacity, 0, 1, 1) }
  switch (r.kind) {
    case 'text':
      return {
        ...common,
        kind: 'text',
        text: safeString(r.text, '').slice(0, MAX_PROP_TEXT_LENGTH),
        fontSizePx: Math.round(clampNum(r.fontSizePx, 8, 400, 72)),
        color: safeColor(r.color, '#ffffff'),
        bold: safeBool(r.bold, true),
        align: safeEnum(r.align, PROP_ALIGNS, 'center'),
      }
    case 'timer':
      return {
        ...common,
        kind: 'timer',
        fontSizePx: Math.round(clampNum(r.fontSizePx, 8, 400, 96)),
        color: safeColor(r.color, '#ffffff'),
        overrunColor: safeColor(r.overrunColor, '#f87171'),
        bold: safeBool(r.bold, true),
        align: safeEnum(r.align, PROP_ALIGNS, 'center'),
      }
    case 'shape':
      return {
        ...common,
        kind: 'shape',
        shape: safeEnum(r.shape, ['rectangle', 'ellipse'] as const, 'rectangle'),
        fill: safeColor(r.fill, '#315ede'),
        radiusPx: Math.round(clampNum(r.radiusPx, 0, 540, 0)),
      }
    case 'image': {
      const mediaPath = safeString(r.mediaPath, '').trim()
      if (!mediaPath) return null
      return { ...common, kind: 'image', mediaPath, fit: safeEnum(r.fit, ['contain', 'cover'] as const, 'contain') }
    }
    default:
      return null
  }
}

/**
 * A prop saved before props had objects: one image at a corner, `widthPct`
 * wide, `marginPct` in from the edges. It becomes one image object in the
 * same place. Its height assumes a square image; `contain` keeps the real
 * shape inside that box.
 */
function legacyPropObjects(r: Record<string, unknown>, propId: string): PropObject[] {
  const mediaPath = safeString(r.mediaPath, '').trim()
  if (!mediaPath) return []
  const w = clampNum(r.widthPct, 2, 100, 12) / 100
  const h = Math.min(1, (w * 16) / 9)
  const mx = clampNum(r.marginPct, 0, 20, 2) / 100
  const my = Math.min(0.5, (mx * 16) / 9)
  const position = safeEnum(r.position, PROP_POSITIONS, 'top-right')
  const left = position === 'top-left' || position === 'bottom-left'
  const top = position === 'top-left' || position === 'top-right'
  const x = position === 'center' ? (1 - w) / 2 : left ? mx : 1 - mx - w
  const y = position === 'center' ? (1 - h) / 2 : top ? my : 1 - my - h
  return [{
    id: `${propId}-image`,
    kind: 'image',
    mediaPath,
    fit: 'contain',
    x: Math.max(0, x),
    y: Math.max(0, y),
    w,
    h,
    opacity: clampNum(r.opacity, 0, 1, 1),
  }]
}

function normalizeProps(raw: unknown): ProgramProp[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const props: ProgramProp[] = []
  for (const item of raw) {
    const r = asObject(item)
    const id = safeString(r.id, '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    const objectIds = new Set<string>()
    const objects = Array.isArray(r.objects)
      ? r.objects.map((o) => normalizePropObject(o, objectIds)).filter((o): o is PropObject => o !== null)
      : legacyPropObjects(r, id)
    props.push({
      id,
      name: safeString(r.name, 'Prop').trim() || 'Prop',
      background: r.background == null || r.background === '' ? null : safeColor(r.background, '#000000'),
      objects: objects.slice(0, MAX_PROP_OBJECTS),
    })
  }
  return props
}

const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/

/**
 * Saved timers. Settings from before there was a list get one countdown that
 * keeps the old roll-over choice, so nothing changes on screen.
 */
/** A timer's design, made safe; it always keeps one readout to draw. */
function normalizeTimerTheme(raw: unknown, color: string, overrunColor: string): TimerTheme {
  const r = asObject(raw)
  const background = typeof r.background === 'string' ? safeColor(r.background, '') || null : null
  const seen = new Set<string>()
  const objects = (Array.isArray(r.objects) ? r.objects : [])
    .map((object) => normalizePropObject(object, seen))
    .filter((object): object is PropObject => object !== null)
    .slice(0, MAX_PROP_OBJECTS)
  if (!objects.some((object) => object.kind === 'timer')) objects.push(defaultTimerTheme(color, overrunColor).objects[0]!)
  return { background, objects }
}

function normalizeTimers(raw: unknown, rollover: boolean, color: string, overrunColor: string): ProgramTimerDef[] {
  const timers: ProgramTimerDef[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(raw) ? raw : []) {
    const r = asObject(item)
    const id = safeString(r.id, '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    const target = safeString(r.targetTime, '').trim()
    timers.push({
      id,
      name: safeString(r.name, '').trim().slice(0, 80) || 'Timer',
      kind: safeEnum(r.kind, ['countdown', 'countdownTo'] as const, 'countdown'),
      durationSec: Math.round(clampNum(r.durationSec, 0, 24 * 3600, DEFAULT_TIMER.durationSec)),
      targetTime: TIME_OF_DAY.test(target) ? target : DEFAULT_TIMER.targetTime,
      overrun: safeBool(r.overrun, rollover),
      theme: normalizeTimerTheme(r.theme, color, overrunColor),
    })
    if (timers.length === MAX_PROGRAM_TIMERS) break
  }
  return timers.length > 0
    ? timers
    : [{ ...DEFAULT_TIMER, overrun: rollover, theme: defaultTimerTheme(color, overrunColor) }]
}

function normalizeSavedMessages(raw: unknown): ProgramSavedMessage[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const messages: ProgramSavedMessage[] = []
  for (const item of raw) {
    const r = asObject(item)
    const id = safeString(r.id, '').trim()
    const text = safeString(r.text, '').trim().slice(0, MAX_SAVED_MESSAGE_LENGTH)
    if (!id || !text || seen.has(id)) continue
    seen.add(id)
    messages.push({ id, text })
    if (messages.length === MAX_SAVED_MESSAGES) break
  }
  return messages
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

function normalizeVideoSettings(raw: unknown): VideoSettings {
  const v = asObject(raw)
  // Saved before the freeform box: a corner and a width. Keep those readable.
  const legacyWidth = clampNum(v.sizePct, 10, 60, DEFAULT_VIDEO_SETTINGS.box.widthPct)
  const legacyMargin = clampNum(v.marginPct, 0, 8, 2)
  const legacyCorner = safeEnum(v.corner, ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const, 'bottom-right')
  const box = asObject(v.box)
  const widthPct = clampNum(box.widthPct, 10, 90, legacyWidth)
  const heightPct = clampNum(box.heightPct, 10, 90, legacyWidth)
  const legacyX = legacyCorner.includes('right') ? 100 - legacyWidth - legacyMargin : legacyMargin
  const legacyY = legacyCorner.includes('bottom') ? 100 - legacyWidth - legacyMargin : legacyMargin
  return {
    layout: safeEnum(v.layout, ['full', 'pip', 'split'] as const, DEFAULT_VIDEO_SETTINGS.layout),
    box: {
      xPct: clampNum(box.xPct, 0, 100 - widthPct, legacyX),
      yPct: clampNum(box.yPct, 0, 100 - heightPct, legacyY),
      widthPct,
      heightPct,
    },
    radiusPx: Math.round(clampNum(v.radiusPx, 0, 48, DEFAULT_VIDEO_SETTINGS.radiusPx)),
    side: safeEnum(v.side, ['left', 'right'] as const, DEFAULT_VIDEO_SETTINGS.side),
    splitPct: Math.round(clampNum(v.splitPct, 20, 80, DEFAULT_VIDEO_SETTINGS.splitPct)),
  }
}

export function normalizePresentationSettings(raw: unknown): PresentationSettings {
  const d = DEFAULT_PRESENTATION_SETTINGS
  const r = asObject(raw)
  const t = asObject(r.transition)
  const q = asObject(r.question)
  const m = asObject(r.message)
  const l = asObject(r.logo)
  const a = asObject(r.audio)
  // Saved before this was renamed: read the old key too.
  const vid = asObject(r.video ?? r.camera)
  const tm = asObject(r.timer)
  return {
    transition: {
      kind: safeEnum(t.kind, ['cut', 'fade'] as const, d.transition.kind),
      durationMs: Math.round(clampNum(t.durationMs, 50, 3000, d.transition.durationMs)),
    },
    question: {
      position: safeEnum(q.position, ['top', 'center', 'bottom'] as const, d.question.position),
      align: safeEnum(q.align, ['left', 'center'] as const, d.question.align),
      fontFamily: safeEnum(q.fontFamily, ['sans', 'serif', 'mono'] as const, d.question.fontFamily),
      fontSizePx: Math.round(clampNum(q.fontSizePx, 24, 100, d.question.fontSizePx)),
      color: safeColor(q.color, d.question.color),
      background: safeColor(q.background, d.question.background),
      backgroundOpacity: Math.round(clampNum(q.backgroundOpacity, 0, 100, d.question.backgroundOpacity)),
      borderRadiusPx: Math.round(clampNum(q.borderRadiusPx, 0, 48, d.question.borderRadiusPx)),
      widthPct: Math.round(clampNum(q.widthPct, 50, 100, d.question.widthPct)),
      showAuthor: safeBool(q.showAuthor, d.question.showAuthor),
      joinHeadline: safeString(q.joinHeadline, d.question.joinHeadline).slice(0, 80),
      qrSizePx: Math.round(clampNum(q.qrSizePx, 160, 400, d.question.qrSizePx)),
      showJoinUrl: safeBool(q.showJoinUrl, d.question.showJoinUrl),
    },
    message: {
      position: safeEnum(m.position, ['bottom', 'top'] as const, d.message.position),
      fontSizePx: Math.round(clampNum(m.fontSizePx, 16, 160, d.message.fontSizePx)),
      color: safeColor(m.color, d.message.color),
      background: safeColor(m.background, d.message.background),
      scroll: safeBool(m.scroll, d.message.scroll),
    },
    messages: normalizeSavedMessages(r.messages),
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
    video: normalizeVideoSettings(vid),
    timers: normalizeTimers(
      r.timers,
      safeBool(tm.rollover, true),
      safeColor(tm.color, '#5eead4'),
      safeColor(tm.overrunColor, '#f87171'),
    ),
  }
}

/** The fade length a program window should use; 0 = cut. */
export function transitionMs(transition: ProgramTransition): number {
  return transition.kind === 'fade' ? transition.durationMs : 0
}

/** Media the pa-media:// protocol may serve on behalf of `presentation`. */
export function presentationMediaPaths(raw: unknown): string[] {
  const settings = normalizePresentationSettings(raw)
  const propImages = settings.props.flatMap((p) =>
    p.objects.flatMap((o) => (o.kind === 'image' ? [o.mediaPath] : [])),
  )
  const timerImages = settings.timers.flatMap((timer) =>
    timer.theme.objects.flatMap((o) => (o.kind === 'image' ? [o.mediaPath] : [])),
  )
  return [settings.logo.mediaPath, ...propImages, ...timerImages].filter((p) => p !== '')
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

/** A web page live on the screens, behind the words. `reload` goes up to reload it everywhere. */
export interface ProgramWeb {
  url: string
  reload: number
}

export interface ProgramState {
  poll: PollView | null
  question: ProgramQuestion | null
  /** Audience message on the program screens, or null. */
  message: string | null
  /** Message for stage displays and screens showing the stage-message layer. */
  stageMessage: string | null
  activePropIds: string[]
  logo: boolean
  /** Label of the live camera / capture input, or null. */
  camera: string | null
  /** Label of the audio input played with the camera, or null for a silent camera. */
  cameraAudio: string | null
  /** The web page on screens, or null. */
  web: ProgramWeb | null
  /** The timer screens and stage displays show — a copy of `timers[screenTimerId]`. */
  timer: ProgramTimerState
  /** Each timer's run, by id. A timer not here hasn't been touched since launch. */
  timers: Record<string, ProgramTimerState>
  /** Which timer is the one on screens; null = the first in the list. */
  screenTimerId: string | null
  /** The operator put the countdown up. Screens show it only if their Look allows it. */
  countdownOnScreens: boolean
  /** The operator put the clock up. Screens show it only if their Look allows it. */
  clockOnScreens: boolean
  current: ProgramSlideInfo | null
  next: ProgramSlideInfo | null
}

export const EMPTY_PROGRAM_STATE: ProgramState = {
  poll: null,
  question: null,
  message: null,
  stageMessage: null,
  activePropIds: [],
  logo: false,
  camera: null,
  cameraAudio: null,
  web: null,
  timer: { durationSec: 300, endsAt: null, remainingSec: 300 },
  timers: {},
  screenTimerId: null,
  countdownOnScreens: false,
  clockOnScreens: false,
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

/**
 * Everything a countdown readout needs at `now`, so the booth, the preview and
 * the screen shells agree: the number to show (held at 0 without roll over),
 * whether time is up, and whether it is paused part-way.
 */
export function timerReadout(
  timer: ProgramTimerState,
  now: number,
  rollover: boolean,
): { seconds: number; timeUp: boolean; paused: boolean } {
  const raw = timerRemainingSec(timer, now)
  const running = timerRunning(timer)
  return {
    seconds: rollover ? raw : Math.max(0, raw),
    timeUp: timer.durationSec > 0 && (raw < 0 || (raw === 0 && running)),
    paused: !running && raw !== timer.durationSec,
  }
}

/** Wall clock as the screens show it: `9:05 PM`. */
export function formatClock(date: Date): string {
  const hours = date.getHours()
  return `${hours % 12 || 12}:${String(date.getMinutes()).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`
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

/**
 * The next moment the clock reads `HH:MM`, from `now` — today, or tomorrow
 * if that time has already passed.
 */
export function nextTimeOfDay(targetTime: string, now: number): number {
  const [hours, minutes] = targetTime.split(':').map(Number)
  const target = new Date(now)
  target.setHours(hours, minutes, 0, 0)
  if (target.getTime() <= now) target.setDate(target.getDate() + 1)
  return target.getTime()
}

/** A timer as it stands before it's started (or after a reset). */
export function idleTimer(def: ProgramTimerDef, now: number): ProgramTimerState {
  if (def.kind === 'countdownTo') {
    const seconds = Math.ceil((nextTimeOfDay(def.targetTime, now) - now) / 1000)
    return { durationSec: seconds, endsAt: null, remainingSec: seconds }
  }
  return resetTimer({ durationSec: def.durationSec, endsAt: null, remainingSec: def.durationSec })
}

/**
 * Starts (or resumes) a timer. A countdown to a time of day always runs to
 * that time, however long it was paused; a countdown carries on from where
 * it stopped.
 */
export function startTimerFor(def: ProgramTimerDef, run: ProgramTimerState, now: number): ProgramTimerState {
  if (run.endsAt !== null) return run
  if (def.kind === 'countdownTo') {
    const endsAt = nextTimeOfDay(def.targetTime, now)
    return { durationSec: Math.ceil((endsAt - now) / 1000), endsAt, remainingSec: 0 }
  }
  return startTimer(run, now)
}

/** The timer on screens: the chosen one if it still exists, else the first. */
export function screenTimerDef(presentation: Pick<PresentationSettings, 'timers'>, state: Pick<ProgramState, 'screenTimerId'>): ProgramTimerDef {
  return presentation.timers.find((t) => t.id === state.screenTimerId) ?? presentation.timers[0] ?? DEFAULT_TIMER
}

/** The timer's readout object — its colours are the timer's own. */
export function timerReadoutObject(def: ProgramTimerDef): PropTimerObject | null {
  return def.theme.objects.find((object): object is PropTimerObject => object.kind === 'timer') ?? null
}

/** The countdown look for stage displays, taken from the timer's design. */
export function screenTimerStyle(presentation: PresentationSettings, state: Pick<ProgramState, 'screenTimerId'>): ProgramTimerStyle {
  const def = screenTimerDef(presentation, state)
  const readout = timerReadoutObject(def)
  return {
    rollover: def.overrun,
    color: readout?.color ?? '#5eead4',
    overrunColor: readout?.overrunColor ?? '#f87171',
    backdrop: false,
  }
}

/** One timer's design as markup; its readout ticks from the run. */
export function renderTimerHTML(def: ProgramTimerDef, timer: PropTimerView): string {
  return renderPropHTML({ id: `timer-${def.id}`, name: def.name, background: def.theme.background, objects: def.theme.objects }, timer)
}

/** One timer's run as a drawing view; an untouched timer starts idle. */
export function timerViewFor(
  def: ProgramTimerDef,
  run: ProgramTimerState | null | undefined,
  now = Date.now(),
): PropTimerView {
  const state = run ?? idleTimer(def, now)
  return {
    durationSec: state.durationSec,
    endsAt: state.endsAt,
    remainingSec: state.remainingSec,
    rollover: def.overrun,
    now,
  }
}

/** The on-screens timer as a drawing view. */
export function propTimerViewFor(
  state: Pick<ProgramState, 'timer' | 'screenTimerId'>,
  presentation: Pick<PresentationSettings, 'timers'>,
  now = Date.now(),
): PropTimerView {
  return timerViewFor(screenTimerDef(presentation, state), state.timer, now)
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

const pct = (share: number): string => `${Math.round(share * 10_000) / 100}%`

/** What a timer object needs to draw: the run and the moment it is drawn at. */
export interface PropTimerView {
  durationSec: number
  endsAt: number | null
  remainingSec: number
  rollover: boolean
  now: number
}

const NO_TIMER: PropTimerView = { durationSec: 0, endsAt: null, remainingSec: 0, rollover: true, now: 0 }

/** One prop object as positioned markup. Shared by the screens and the Props editor. */
export function renderPropObjectHTML(object: PropObject, timer: PropTimerView = NO_TIMER): string {
  const box = `position:absolute;left:${pct(object.x)};top:${pct(object.y)};width:${pct(object.w)};height:${pct(object.h)};opacity:${object.opacity};`
  switch (object.kind) {
    case 'text': {
      const justify = object.align === 'left' ? 'flex-start' : object.align === 'right' ? 'flex-end' : 'center'
      const style = [
        box,
        'display:flex;align-items:center;',
        `justify-content:${justify};text-align:${object.align};`,
        `color:${object.color};font-size:${object.fontSizePx}px;`,
        `font-weight:${object.bold ? 700 : 400};line-height:1.2;`,
        "font-family:'Source Sans 3','Helvetica Neue',Arial,sans-serif;",
        'white-space:pre-wrap;overflow:hidden;',
      ].join('')
      return `<div style="${style}"><div>${escapeAndBreak(object.text)}</div></div>`
    }
    case 'timer': {
      const readout = timerReadout(
        { durationSec: timer.durationSec, endsAt: timer.endsAt, remainingSec: timer.remainingSec },
        timer.now,
        timer.rollover,
      )
      const justify = object.align === 'left' ? 'flex-start' : object.align === 'right' ? 'flex-end' : 'center'
      const style = [
        box,
        'display:flex;align-items:center;',
        `justify-content:${justify};text-align:${object.align};`,
        `color:${readout.timeUp ? object.overrunColor : object.color};`,
        `font-size:${object.fontSizePx}px;`,
        `font-weight:${object.bold ? 700 : 400};line-height:1.2;font-variant-numeric:tabular-nums;`,
        "font-family:'Source Sans 3','Helvetica Neue',Arial,sans-serif;",
        'white-space:nowrap;overflow:hidden;',
      ].join('')
      const attrs = [
        'data-kairo-timer',
        `data-duration-sec="${timer.durationSec}"`,
        `data-ends-at="${timer.endsAt ?? ''}"`,
        `data-remaining-sec="${timer.remainingSec}"`,
        `data-rollover="${timer.rollover}"`,
        `data-color="${escapeHtml(object.color)}"`,
        `data-overrun-color="${escapeHtml(object.overrunColor)}"`,
      ].join(' ')
      return `<div style="${style}" ${attrs}><span style="opacity:${readout.paused ? 0.55 : 1}">${formatTimer(readout.seconds)}</span></div>`
    }
    case 'shape': {
      const radius = object.shape === 'ellipse' ? '50%' : `${object.radiusPx}px`
      return `<div style="${box}background:${object.fill};border-radius:${radius};"></div>`
    }
    case 'image':
      return `<img src="${escapeHtml(overlayMediaUrl(object.mediaPath))}" alt="" style="${box}object-fit:${object.fit};">`
  }
}

/** One prop, full frame: its background (if any) and its objects, back to front. */
export function renderPropHTML(prop: ProgramProp, timer?: PropTimerView): string {
  const background = prop.background ? `background:${prop.background};` : ''
  return `<div style="position:absolute;inset:0;${background}">${prop.objects.map((o) => renderPropObjectHTML(o, timer)).join('')}</div>`
}

/** Every active prop in one layer, in list order. Nothing to draw → ''. */
export function renderPropsHTML(props: readonly ProgramProp[], activeIds: readonly string[], timer?: PropTimerView): string {
  const active = props.filter((p) => activeIds.includes(p.id) && (p.background || p.objects.length > 0))
  if (active.length === 0) return ''
  return `<div class="pa-props">${active.map((p) => renderPropHTML(p, timer)).join('')}</div>`
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
  poll: boolean
  question: boolean
  messages: boolean
  /** Logo and props. */
  overlays: boolean
  countdown: boolean
  clock: boolean
  stageMessage: boolean
}

/** Where the countdown, clock and stage message sit on a screen, and how big. */
export interface ConfidenceLayout {
  position: 'top' | 'bottom'
  size: 'small' | 'medium' | 'large'
}

export const DEFAULT_CONFIDENCE_LAYOUT: ConfidenceLayout = { position: 'top', size: 'medium' }

/** Font sizes (1920-wide frame px) for the clock/countdown bar and the stage message. */
export function confidenceSizes(size: ConfidenceLayout['size']): { barPx: number; messagePx: number } {
  return size === 'small' ? { barPx: 48, messagePx: 40 } : size === 'large' ? { barPx: 104, messagePx: 84 } : { barPx: 72, messagePx: 60 }
}

export function normalizeConfidenceLayout(raw: unknown): ConfidenceLayout {
  const r = asObject(raw)
  return {
    position: safeEnum(r.position, ['top', 'bottom'] as const, 'top'),
    size: safeEnum(r.size, ['small', 'medium', 'large'] as const, 'medium'),
  }
}

/** Everything the room sees; the confidence layers start off. */
export const DEFAULT_SHOW_FILTER: OutputShowFilter = {
  scripture: true,
  lyrics: true,
  documents: true,
  backgrounds: true,
  poll: true,
  question: true,
  messages: true,
  overlays: true,
  countdown: false,
  clock: false,
  stageMessage: false,
}

/** Layers a playlist (lobby) screen can still show on top of its playlist. */
export const PLAYLIST_SHOW_KEYS: readonly (keyof OutputShowFilter)[] = [
  'poll',
  'question',
  'messages',
  'overlays',
  'countdown',
  'clock',
  'stageMessage',
]

export function outputShowLabel(key: keyof OutputShowFilter): string {
  switch (key) {
    case 'scripture': return 'Scripture'
    case 'lyrics': return 'Lyrics'
    case 'documents': return 'Documents'
    case 'backgrounds': return 'Backgrounds'
    case 'poll': return 'Poll results'
    case 'question': return 'Audience questions'
    case 'messages': return 'Messages'
    case 'overlays': return 'Logo & props'
    case 'countdown': return 'Countdown'
    case 'clock': return 'Clock'
    case 'stageMessage': return 'Stage message'
  }
}

export function normalizeShowFilter(raw: unknown): OutputShowFilter {
  const r = asObject(raw)
  return {
    scripture: safeBool(r.scripture, true),
    lyrics: safeBool(r.lyrics, true),
    documents: safeBool(r.documents, true),
    backgrounds: safeBool(r.backgrounds, true),
    poll: safeBool(r.poll, true),
    question: safeBool(r.question, true),
    messages: safeBool(r.messages, true),
    overlays: safeBool(r.overlays, true),
    countdown: safeBool(r.countdown, false),
    clock: safeBool(r.clock, false),
    stageMessage: safeBool(r.stageMessage, false),
  }
}

// ─── What an output shows right now ────────────────────────────────────────────
// One rule for the screen windows (surface-manager) and the operator's preview.

/** Props, audience message and logo markup an output shows right now. '' = layer off. */
export function programLayersFor(
  output: Pick<import('./ipc').OverlayOutput, 'show'>,
  state: ProgramState,
  presentation: PresentationSettings,
  /** The moment the layer is drawn; a timer object uses it for its readout. */
  now = Date.now(),
): { props: string; timer: string; message: string; question: string; poll: string; logo: string } {
  const timerView = propTimerViewFor(state, presentation, now)
  return {
    poll: output.show.poll ? renderPollHTML(state.poll, presentation.question) : '',
    question: output.show.question ? renderQuestionHTML(state.question, presentation.question) : '',
    props: output.show.overlays ? renderPropsHTML(presentation.props, state.activePropIds, timerView) : '',
    timer: output.show.countdown && state.countdownOnScreens
      ? renderTimerHTML(screenTimerDef(presentation, state), timerView)
      : '',
    message: output.show.messages ? renderMessageHTML(state.message, presentation.message) : '',
    logo: output.show.overlays ? renderLogoHTML(presentation.logo, state.logo) : '',
  }
}

/** Countdown, clock and stage message for one output, with how to draw them. */
export interface ConfidenceInfo {
  clock: boolean
  stageMessage: string | null
  layout: ConfidenceLayout
  sizes: { barPx: number; messagePx: number }
  style: ProgramTimerStyle
}

/** Null when the output shows none of them right now (its Look allows it and the operator put it up). */
export function confidenceFor(
  output: Pick<import('./ipc').OverlayOutput, 'show' | 'confidence'>,
  state: ProgramState,
  presentation: PresentationSettings,
): ConfidenceInfo | null {
  const clock = output.show.clock && state.clockOnScreens
  const stageMessage = output.show.stageMessage ? state.stageMessage : null
  if (!clock && !stageMessage) return null
  return {
    clock,
    stageMessage,
    layout: output.confidence,
    sizes: confidenceSizes(output.confidence.size),
    style: screenTimerStyle(presentation, state),
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
  SET_WEB: 'program:setWeb',
  RELOAD_WEB: 'program:reloadWeb',
  /** send (x, y): the preview scrolled; screens showing its page follow. */
  SCROLL_WEB: 'program:scrollWeb',
  /** send (x, y) or (null, null): the operator's pointer over the live page. */
  WEB_POINTER: 'program:webPointer',
  /** push ({ url }) — the operator's web preview went to another page. */
  WEB_NAVIGATED: 'program:webNavigated',
  TIMER_SET: 'program:timerSet',
  TIMER_START: 'program:timerStart',
  TIMER_PAUSE: 'program:timerPause',
  TIMER_RESET: 'program:timerReset',
  /** Which timer screens and stage displays show. */
  TIMER_SHOW: 'program:timerShow',
  SET_ON_SCREENS: 'program:setOnScreens',
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
  /** Puts a web page on screens (an http(s) address), or null to take it down. */
  setWeb: (url: string | null) => Promise<ProgramState>
  /** Reloads the live web page on every screen. */
  reloadWeb: () => Promise<ProgramState>
  /** Scrolls the live web page on every screen to where the preview is. */
  scrollWeb: (x: number, y: number) => void
  /** Draws the pointer on screens at (x, y), or hides it with null. */
  webPointer: (x: number | null, y: number | null) => void
  /** The web preview in the operator window went to another page (link, redirect, search). */
  onWebNavigated: (callback: (event: { url: string }) => void) => Unsubscribe
  /** Each takes a timer id; without one, it acts on the timer on screens. */
  timer: {
    set: (durationSec: number, id?: string) => Promise<ProgramState>
    start: (id?: string) => Promise<ProgramState>
    pause: (id?: string) => Promise<ProgramState>
    reset: (id?: string) => Promise<ProgramState>
    /** Makes this the timer screens and stage displays show. */
    show: (id: string) => Promise<ProgramState>
  }
  /** Puts the countdown or clock up on (or takes it off) every screen whose Look allows it. */
  setOnScreens: (layer: 'countdown' | 'clock', on: boolean) => Promise<ProgramState>
  /** Native image picker for logo / props. Null when cancelled. */
  pickImage: () => Promise<string | null>
  stageStatus: () => Promise<StageDisplayStatus[]>
  onStageStatus: (callback: (status: StageDisplayStatus[]) => void) => Unsubscribe
  /** Whether NDI feeds can carry sound here (the NDI 6 binding is loaded). */
  ndiAudioSupported: () => Promise<boolean>
}

function questionFontStack(font: ProgramQuestionFont | undefined): string {
  if (font === 'serif') return "Georgia,'Times New Roman',serif"
  if (font === 'mono') return "'SF Mono',Menlo,Consolas,monospace"
  return "'Source Sans 3','Helvetica Neue',Arial,sans-serif"
}

function colorWithOpacity(color: string, opacityPct: number | undefined): string {
  const pct = opacityPct ?? 100
  if (pct >= 100) return color
  if (pct <= 0) return 'transparent'
  const hex = color.trim()
  const m6 = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex)
  if (m6) {
    return `rgba(${parseInt(m6[1], 16)},${parseInt(m6[2], 16)},${parseInt(m6[3], 16)},${Math.round(pct) / 100})`
  }
  const m3 = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(hex)
  if (m3) {
    return `rgba(${parseInt(m3[1] + m3[1], 16)},${parseInt(m3[2] + m3[2], 16)},${parseInt(m3[3] + m3[3], 16)},${Math.round(pct) / 100})`
  }
  return color
}

/** A separate, escaped question/join layer; never changes slide or message markup. */
export function renderQuestionHTML(question: ProgramQuestion | null, style: ProgramQuestionStyle): string {
  if (!question) return ''
  const align = style.position === 'top' ? 'flex-start' : style.position === 'bottom' ? 'flex-end' : 'center'
  const textAlign = style.align ?? 'left'
  const font = questionFontStack(style.fontFamily)
  const bg = colorWithOpacity(style.background, style.backgroundOpacity)
  const radius = style.borderRadiusPx ?? 24
  const maxWidth = Math.round(1760 * ((style.widthPct ?? 85) / 100))
  let content: string
  if ('kind' in question) {
    const qrSize = style.qrSizePx ?? 280
    // Only locally generated PNG QR images; never embed a remote URL or active SVG.
    const qr = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(question.qrDataUrl)
      ? `<img alt="Scan to join" src="${question.qrDataUrl}" style="width:${qrSize}px;height:${qrSize}px;background:white;padding:16px;border-radius:${Math.min(16, radius)}px;flex-shrink:0;" />` : ''
    const headline = (style.joinHeadline ?? 'Ask a question').trim()
    const headlineHtml = headline ? `<div style="font-size:32px;opacity:.85;margin-bottom:4px;">${escapeHtml(headline)}</div>` : ''
    const urlHtml = (style.showJoinUrl ?? true)
      ? `<div style="font-size:32px;opacity:.75;margin-top:8px;overflow-wrap:anywhere;">${escapeHtml(question.url)}</div>` : ''
    content = `<div style="display:flex;align-items:center;justify-content:center;gap:64px;text-align:left;">${qr}<div>${headlineHtml}<div style="font-size:96px;font-weight:700;letter-spacing:12px;line-height:1.1;">${escapeHtml(question.code)}</div>${urlHtml}</div></div>`
  } else {
    const showAuthor = style.showAuthor ?? true
    const authorHtml = showAuthor
      ? `<div style="font-size:${Math.max(22, Math.round(style.fontSizePx * 0.45))}px;margin-bottom:20px;opacity:.7;font-weight:600;">${escapeHtml(question.author || 'Anonymous')}</div>` : ''
    content = `<div style="text-align:${textAlign};">${authorHtml}<div style="white-space:pre-wrap;overflow-wrap:anywhere;">${escapeHtml(question.text)}</div></div>`
  }
  return `<div style="position:absolute;inset:0;display:flex;align-items:${align};justify-content:center;padding:72px;box-sizing:border-box;"><div style="box-sizing:border-box;width:100%;max-width:${maxWidth}px;max-height:100%;overflow:hidden;border-radius:${radius}px;padding:48px 64px;color:${style.color};background:${bg};font-family:${font};font-size:${style.fontSizePx}px;line-height:1.25;">${content}</div></div>`
}

/** Independent poll layer. Totals are supplied by the engagement, never recalculated by outputs. */
export function renderPollHTML(poll: PollView | null, style: ProgramQuestionStyle): string {
  if (!poll) return ''
  const font = questionFontStack(style.fontFamily)
  const bg = colorWithOpacity(style.background, style.backgroundOpacity)
  const radius = style.borderRadiusPx ?? 24
  const maxWidth = Math.round(1760 * ((style.widthPct ?? 85) / 100))
  const options=poll.options.map(o=>{
    const count=Math.max(0,poll.totals[o.id]??0), percent=poll.voters?Math.min(100,Math.round(100*count/poll.voters)):0
    return `<div style="margin-top:24px;"><div style="display:flex;justify-content:space-between;gap:24px;"><span>${escapeHtml(o.text)}</span><span>${percent}% · ${count}</span></div><div style="height:16px;background:#ffffff20;border-radius:999px;overflow:hidden;margin-top:10px;"><div style="height:100%;width:${percent}%;background:currentColor;border-radius:999px;"></div></div></div>`
  }).join('')
  return `<div style="position:absolute;inset:8%;display:flex;align-items:center;justify-content:center;pointer-events:none;"><div style="width:100%;max-width:${maxWidth}px;padding:48px;border-radius:${radius}px;background:${bg};color:${style.color};font-family:${font};font-size:${Math.round(style.fontSizePx*.55)}px;"><div style="font-size:${style.fontSizePx}px;font-weight:700;overflow-wrap:anywhere;">${escapeHtml(poll.title)}</div>${options}<div style="margin-top:24px;opacity:.7;font-size:24px;">${poll.voters} voted</div></div></div>`
}
