import type { LyricsSectionType } from '@shared/ipc'

/**
 * One colour per section type, shared by the song view and the editor so a
 * chorus reads as the same green everywhere. Apple system colours (dark
 * appearance) — distinct at a glance, none of them the amber that means "live".
 *
 * Colour follows the type, like ProPresenter groups: every verse is blue, the
 * label ("Verse 2") tells them apart.
 */
export const SECTION_COLOR: Record<LyricsSectionType, string> = {
  verse: '#0A84FF',
  chorus: '#30D158',
  'pre-chorus': '#64D2FF',
  bridge: '#BF5AF2',
  tag: '#FFD60A',
  intro: '#98989D',
  outro: '#5E5CE6',
  ending: '#FF375F',
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
