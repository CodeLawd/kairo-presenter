import type { LyricsSectionType } from '@shared/ipc'

/**
 * One colour per section type, shared by the song view and the editor so a
 * chorus reads as the same red everywhere. ProPresenter-style group colours:
 * deep enough that `SECTION_TEXT` on a solid fill reads at 5:1 or better, since
 * every use is a solid bar or chip carrying the label.
 *
 * Colour follows the type, like ProPresenter groups: every verse is blue, the
 * label ("Verse 2") tells them apart.
 */
export const SECTION_COLOR: Record<LyricsSectionType, string> = {
  verse: '#3B63D9',
  chorus: '#C8372D',
  'pre-chorus': '#0E7490',
  bridge: '#7C3AED',
  tag: '#A15C07',
  intro: '#565449',
  outro: '#4F46E5',
  ending: '#BE123C',
}

/** Text on a section-coloured fill (brand paper). */
export const SECTION_TEXT = '#FFFBF4'

/** Solid fill + text for a section label chip or bar. */
export function sectionFill(type: LyricsSectionType): { backgroundColor: string; color: string } {
  return { backgroundColor: sectionColor(type), color: SECTION_TEXT }
}

/** `#RRGGBB` at the given opacity, for borders and tints. */
export function sectionColor(type: LyricsSectionType, alpha = 1): string {
  const hex = SECTION_COLOR[type] ?? SECTION_COLOR.verse
  if (alpha >= 1) return hex
  const value = parseInt(hex.slice(1), 16)
  return `rgb(${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255} / ${alpha})`
}

/** The labels offered when labelling selected slides. */
export const SLIDE_LABEL_CHOICES: Array<{ type: LyricsSectionType; label: string }> = [
  { type: 'verse', label: 'Verse 1' },
  { type: 'verse', label: 'Verse 2' },
  { type: 'verse', label: 'Verse 3' },
  { type: 'verse', label: 'Verse 4' },
  { type: 'pre-chorus', label: 'Pre-Chorus' },
  { type: 'chorus', label: 'Chorus' },
  { type: 'chorus', label: 'Chorus 2' },
  { type: 'bridge', label: 'Bridge' },
  { type: 'tag', label: 'Tag' },
  { type: 'intro', label: 'Intro' },
  { type: 'outro', label: 'Outro' },
  { type: 'ending', label: 'Ending' },
]
