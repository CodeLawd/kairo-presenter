// Shared routing for Kairo screens, devices and independent NDI feeds.

import type {
  AppSettings,
  OverlayContentKind,
  OverlayOutput,
  OverlayOutputKind,
  OverlayOutputVariant,
  OverlayTheme,
} from './ipc'

// ─── Layer map ─────────────────────────────────────────────────────────────────

export const OVERLAY_OUTPUT_KINDS: readonly OverlayOutputKind[] = ['ndi', 'screen', 'device', 'syphon']
export const MAX_NDI_OUTPUTS = 4
export const MAX_SYPHON_OUTPUTS = 4

export function outputDestinationLabel(kind: OverlayOutputKind): string {
  return { screen: 'Kairo screen', device: 'Video card', ndi: 'NDI feed', syphon: 'Syphon' }[kind]
}

/** Kinds Kairo renders through a ProgramSurface. */
export function isRenderedKind(kind: OverlayOutputKind): boolean {
  return kind === 'ndi' || kind === 'screen' || kind === 'device' || kind === 'syphon'
}

/**
 * Kairo drives a physical output directly — a display or a video card. These
 * count as the "screen" route and can run their own playlist instead of the service.
 */
export function isLocalKind(kind: OverlayOutputKind): boolean {
  return kind === 'screen' || kind === 'device'
}

/**
 * Whether an output takes service pushes. False only for a `screen` running
 * its own playlist (a lobby display) — it ignores pushes and Clear alike.
 */
export function followsProgram(output: Pick<OverlayOutput, 'kind' | 'source'>): boolean {
  return !(isLocalKind(output.kind) && output.source === 'playlist')
}

/** Enabled outputs Kairo renders itself — documents and backgrounds go to these. */
export function surfaceOutputs(outputs: readonly OverlayOutput[]): OverlayOutput[] {
  return outputs.filter((o) => o.enabled && isRenderedKind(o.kind) && followsProgram(o))
}

/**
 * The rendered output a preview (or "apply this theme") should target: an
 * enabled screen, else an enabled NDI output, else any NDI output.
 */
export function primaryRenderedOutput(outputs: readonly OverlayOutput[]): OverlayOutput | null {
  return (
    outputs.find((o) => o.kind === 'screen' && o.enabled) ??
    outputs.find((o) => o.kind === 'device' && o.enabled) ??
    outputs.find((o) => o.kind === 'ndi' && o.enabled) ??
    findNdiOutput(outputs)
  )
}

/** Every enabled program destination takes part independently. */
export function renderedOutputs(
  outputs: readonly OverlayOutput[],
  include: (output: OverlayOutput) => boolean = () => true,
): OverlayOutput[] {
  return outputs.filter(o => o.enabled && !o.fallbackOnly && followsProgram(o) && include(o))
}

export function fallbackOutputs(outputs: readonly OverlayOutput[]): OverlayOutput[] {
  return outputs.filter(o => o.enabled && o.fallbackOnly && followsProgram(o)).sort((a, b) => a.order - b.order)
}

/** First enabled NDI output retains the established sender identity. */
export function primaryNdiOutputId(outputs: readonly OverlayOutput[]): string | null {
  return outputs.find((o) => o.kind === 'ndi' && o.enabled)?.id ?? null
}

/**
 * The NDI output settings pages talk about: the primary (first enabled) one,
 * else the first configured, so a disabled NDI output can still be edited.
 */
export function findNdiOutput(outputs: readonly OverlayOutput[]): OverlayOutput | null {
  return outputs.find((o) => o.kind === 'ndi' && o.enabled) ?? outputs.find((o) => o.kind === 'ndi') ?? null
}

export interface OverlayDispatchPlan {
  rendered: OverlayOutput[]
  fallbacks: OverlayOutput[]
}

export function getDispatchPlan(
  outputs: readonly OverlayOutput[],
  include: (output: OverlayOutput) => boolean = () => true,
): OverlayDispatchPlan {
  return { rendered: renderedOutputs(outputs, include), fallbacks: fallbackOutputs(outputs).filter(include) }
}

// ─── Content kinds ─────────────────────────────────────────────────────────────

export const OVERLAY_CONTENT_KINDS: readonly OverlayContentKind[] = ['scripture', 'lyrics'] as const

export function contentKindLabel(kind: OverlayContentKind): string {
  return kind === 'lyrics' ? 'Lyrics' : 'Scripture'
}

/**
 * What the two text layers are *called* for a given content kind. The theme
 * shape is shared — `verse` is the body, `reference` is the line above or below
 * it — but "Reference" reads as a Bible citation, which is meaningless on a
 * lyric slide where that line holds the song and section.
 */
export function overlayLayerLabel(kind: OverlayContentKind, layer: 'verse' | 'reference'): string {
  if (kind === 'lyrics') return layer === 'verse' ? 'Lyrics' : 'Song title'
  return layer === 'verse' ? 'Scripture' : 'Reference'
}

/**
 * Look lyrics inherit from scripture when no lyrics theme is applied: the type
 * and boxes only. The scripture background, backdrop box and theme elements
 * stay behind — a song with no theme of its own takes the dock's motion loop
 * with nothing of the scripture overlay drawn over it. A lyrics theme can add
 * any of them on purpose.
 * Fit-to-box stays off — that toggle lives on the scripture theme and must
 * not grow a couplet to fill the verse box on a lyric push.
 */
export function inheritLyricsTheme(scriptureTheme: OverlayTheme): OverlayTheme {
  return {
    ...scriptureTheme,
    elements: [],
    background: { ...scriptureTheme.background, type: 'transparent' },
    layout: { ...scriptureTheme.layout, backdropBox: false, autoFitText: false },
  }
}

/**
 * The override an output carries for `kind`, or null when it has none.
 * Scripture is never an override — it *is* the output's own theme/template — so
 * asking for it always returns null and every resolver below falls through to
 * the base fields.
 */
export function outputVariant(
  output: OverlayOutput,
  kind: OverlayContentKind,
): OverlayOutputVariant | null {
  return kind === 'lyrics' ? output.lyrics ?? null : null
}

/** True when `kind` has its own styling rather than inheriting scripture's. */
export function hasContentOverride(output: OverlayOutput, kind: OverlayContentKind): boolean {
  return outputVariant(output, kind) !== null
}

/** The theme an output renders `kind` with. */
export function outputThemeFor(output: OverlayOutput, kind: OverlayContentKind): OverlayTheme {
  const variant = outputVariant(output, kind)
  if (variant) return variant.theme
  return kind === 'lyrics' ? inheritLyricsTheme(output.theme) : output.theme
}

/** The `themeId` shown as the source of `kind`'s look. Display only. */
export function outputThemeIdFor(output: OverlayOutput, kind: OverlayContentKind): string | null {
  const variant = outputVariant(output, kind)
  return variant ? variant.themeId : output.themeId
}

/** The token template an output pushes `kind` with. */
export function outputTemplateFor(output: OverlayOutput, kind: OverlayContentKind): string {
  return outputVariant(output, kind)?.template ?? output.template
}

/**
 * Writes a patch to whichever slot holds `kind`'s config — the override when one
 * exists, the base fields otherwise. Lets every editor surface stay unaware of
 * which kind it is currently pointed at.
 */
export function withContentPatch(
  output: OverlayOutput,
  kind: OverlayContentKind,
  patch: Partial<OverlayOutputVariant>,
): OverlayOutput {
  const variant = outputVariant(output, kind)
  if (!variant) return { ...output, ...patch }
  return { ...output, lyrics: { ...variant, ...patch } }
}

/**
 * Turns `kind`'s override on (seeded from the output's scripture config, so the
 * first thing the operator sees is what they already had) or off.
 */
export function setContentOverride(
  output: OverlayOutput,
  kind: OverlayContentKind,
  on: boolean,
): OverlayOutput {
  if (kind !== 'lyrics') return output
  if (!on) return { ...output, lyrics: null }
  if (output.lyrics) return output
  const theme = structuredClone(output.theme)
  return {
    ...output,
    lyrics: {
      themeId: output.themeId,
      theme: inheritLyricsTheme({
        ...theme,
        // A lyric slide has no citation to print. Seeding this on would make
        // every new override start by showing "Song — Verse 1" on the wall,
        // which is the first thing an operator would turn off.
        reference: { ...theme.reference, show: false },
      }),
      // Same reasoning for the token template on message/stage outputs.
      template: '{Text}',
    },
  }
}

// ─── Theme selection ───────────────────────────────────────────────────────────

/**
 * The theme currently on the rendered output for `kind` — the single answer to
 * "what does a push look like right now". Every preview surface must go through
 * this, and it is the one place the deprecated `overlay.theme` fallback has to
 * be deleted when the legacy field finally goes.
 */
export function liveOverlayTheme(
  overlay: AppSettings['overlay'],
  kind: OverlayContentKind = 'scripture',
): OverlayTheme {
  const rendered = primaryRenderedOutput(overlay.outputs)
  return rendered ? outputThemeFor(rendered, kind) : overlay.theme
}

// ─── Media allowlist ───────────────────────────────────────────────────────────

/**
 * Every background media path the user has configured — the definition of what
 * the `pa-media://` protocol is allowed to serve, in one greppable place.
 *
 * Reads RAW stored values rather than normalized ones on purpose: this runs once
 * per media request (and `stream: true` means a <video> issues many), and
 * validating a file path does not need clamped fonts, boxes or colors.
 */
export function configuredMediaPaths(storedOverlay: unknown, storedThemeLibrary: unknown): string[] {
  const paths: string[] = []

  const add = (mediaPath: unknown): void => {
    if (typeof mediaPath === 'string' && mediaPath.trim() !== '') paths.push(mediaPath)
  }
  const collect = (theme: unknown): void => {
    const t = theme as { background?: { mediaPath?: unknown }; elements?: unknown } | null
    add(t?.background?.mediaPath)
    // Image and video elements are configured media too.
    if (Array.isArray(t?.elements)) for (const el of t.elements) add((el as { mediaPath?: unknown })?.mediaPath)
  }

  const overlay = storedOverlay as { theme?: unknown; outputs?: unknown } | null
  collect(overlay?.theme)
  if (Array.isArray(overlay?.outputs)) {
    for (const output of overlay.outputs) {
      collect((output as { theme?: unknown })?.theme)
      // Per-content-kind overrides carry their own background media.
      collect((output as { lyrics?: { theme?: unknown } })?.lyrics?.theme)
    }
  }
  if (Array.isArray(storedThemeLibrary)) {
    for (const item of storedThemeLibrary) {
      collect((item as { theme?: unknown })?.theme)
      // Reset brings the default back, so its media has to stay servable.
      collect((item as { baseline?: unknown })?.baseline)
    }
  }

  return paths
}
