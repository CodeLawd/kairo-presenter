import type { LyricsSectionType, LyricsSongSection } from './ipc'

/** A valid section hotkey, upper-cased — or undefined for anything else. */
export function normalizeHotkey(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const key = raw.trim().toUpperCase()
  return /^[A-Z0-9]$/.test(key) ? key : undefined
}

/** The key a pressed `KeyboardEvent.key` stands for, or null if it cannot be a hotkey. */
export function hotkeyFromEvent(key: string): string | null {
  return key.length === 1 ? normalizeHotkey(key) ?? null : null
}

/** Index of the section a key belongs to, or -1. */
export function sectionForHotkey(sections: readonly Pick<LyricsSongSection, 'hotkey'>[], key: string): number {
  return sections.findIndex((section) => section.hotkey === key)
}

const TYPE_KEY: Partial<Record<LyricsSectionType, string>> = {
  chorus: 'C',
  bridge: 'B',
  'pre-chorus': 'P',
  tag: 'T',
  intro: 'I',
  outro: 'O',
  ending: 'E',
}

/**
 * Suggested hotkeys, ProPresenter-style: Verse 1–9 → 1–9, Chorus → C, Bridge →
 * B, Pre-chorus → P, Tag → T, Intro → I, Outro → O, Ending → E. Keys already
 * set are kept; a section whose suggestion is taken (Chorus 2 after Chorus)
 * stays unassigned rather than stealing it.
 */
export function autoAssignHotkeys<T extends Pick<LyricsSongSection, 'type' | 'hotkey'>>(sections: readonly T[]): T[] {
  const used = new Set(sections.map((s) => s.hotkey).filter(Boolean) as string[])
  let verse = 0
  return sections.map((section) => {
    if (section.type === 'verse') verse++
    if (section.hotkey) return section
    const suggestion = section.type === 'verse' ? (verse <= 9 ? String(verse) : undefined) : TYPE_KEY[section.type]
    if (!suggestion || used.has(suggestion)) return section
    used.add(suggestion)
    return { ...section, hotkey: suggestion }
  })
}

/** Gives `key` to section `index`, taking it off any other section that had it. */
export function setSectionHotkey<T extends Pick<LyricsSongSection, 'hotkey'>>(sections: readonly T[], index: number, key: string | undefined): T[] {
  const next = normalizeHotkey(key)
  return sections.map((section, i) => {
    if (i === index) {
      const { hotkey: _old, ...rest } = section
      return (next ? { ...rest, hotkey: next } : rest) as T
    }
    if (next && section.hotkey === next) {
      const { hotkey: _taken, ...rest } = section
      return rest as T
    }
    return section
  })
}
