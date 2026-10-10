import type { LyricsSectionType, LyricsSongSection } from './ipc'

interface SlideBlock { source: number; lines: string[]; colors: (string | null)[] }

/** One block per slide (blank line = slide break), remembering its section. */
function slideBlocks(sections: LyricsSongSection[]): SlideBlock[] {
  const blocks: SlideBlock[] = []
  sections.forEach((section, source) => {
    let block: SlideBlock = { source, lines: [], colors: [] }
    section.lines.forEach((line, index) => {
      if (!line.trim()) {
        if (block.lines.length) { blocks.push(block); block = { source, lines: [], colors: [] } }
      } else { block.lines.push(line); block.colors.push(section.lineColors?.[index] ?? null) }
    })
    if (block.lines.length || !section.lines.some(line => line.trim())) blocks.push(block)
  })
  return blocks
}

/** Move raw slide blocks, preserving line colors and section identity. */
export function reorderLyricSlide(sections: LyricsSongSection[], from: number, to: number): LyricsSongSection[] {
  const blocks = slideBlocks(sections)
  if (from === to || from < 0 || to < 0 || from >= blocks.length || to >= blocks.length) return sections
  const [moved] = blocks.splice(from, 1)
  blocks.splice(to, 0, moved)
  const result: LyricsSongSection[] = []
  let previous = -1
  for (const block of blocks) {
    if (previous !== block.source || !block.lines.length || !result.at(-1)?.lines.length) {
      result.push({ ...sections[block.source], lines: [...block.lines], lineColors: [...block.colors] })
    } else {
      result.at(-1)!.lines.push('', ...block.lines)
      result.at(-1)!.lineColors!.push(null, ...block.colors)
    }
    previous = block.source
  }
  return uniqueHotkeys(result)
}

/**
 * Gives the chosen slides a section label ("Chorus", "Verse 2" …), keeping
 * their order and line colours. Neighbouring slides that end up with the same
 * type and label merge into one section, so labelling slides 5–8 of a long
 * "Verse 1" as Chorus leaves Verse 1 / Chorus / Verse 1.
 */
export function labelLyricSlides(
  sections: LyricsSongSection[],
  slideIndexes: Iterable<number>,
  target: { type: LyricsSectionType; label: string },
): LyricsSongSection[] {
  const chosen = new Set(slideIndexes)
  const blocks = slideBlocks(sections)
  if (![...chosen].some(index => index >= 0 && index < blocks.length)) return sections

  const result: LyricsSongSection[] = []
  blocks.forEach((block, index) => {
    const base = sections[block.source]
    const type = chosen.has(index) ? target.type : base.type
    const label = chosen.has(index) ? target.label : base.label
    const last = result.at(-1)
    if (last && last.type === type && last.label === label && last.lines.length && block.lines.length) {
      last.lines.push('', ...block.lines)
      last.lineColors!.push(null, ...block.colors)
    } else {
      result.push({ ...base, type, label, lines: [...block.lines], lineColors: [...block.colors] })
    }
  })
  return uniqueHotkeys(result)
}

/**
 * Removes slides (by flat index) and rejoins what is left. A section whose
 * every slide is removed disappears; neighbours that now touch and share a
 * label merge, the same as after a move.
 */
export function deleteLyricSlides(sections: LyricsSongSection[], slideIndexes: Iterable<number>): LyricsSongSection[] {
  const chosen = new Set(slideIndexes)
  const blocks = slideBlocks(sections)
  if (![...chosen].some(index => index >= 0 && index < blocks.length)) return sections
  return joinBlocks(sections, blocks.filter((_, index) => !chosen.has(index)))
}

/** A slide's own lyric lines (before display wrapping), or null when out of range. */
export function lyricSlideLines(sections: LyricsSongSection[], index: number): string[] | null {
  const block = slideBlocks(sections)[index]
  return block ? [...block.lines] : null
}

/**
 * Replaces one slide's lines (Quick Edit). A line left unchanged keeps its
 * colour; edited lines go back to automatic. A blank line in the new text
 * starts another slide in the same section, as everywhere else.
 */
export function replaceLyricSlide(sections: LyricsSongSection[], index: number, lines: string[]): LyricsSongSection[] {
  const blocks = slideBlocks(sections)
  const block = blocks[index]
  if (!block) return sections
  const tidy = lines
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line, i, all) => line.trim() || (i > 0 && all[i - 1].trim()))
  while (tidy.length && !tidy.at(-1)!.trim()) tidy.pop()
  if (!tidy.length) return sections
  blocks[index] = {
    ...block,
    lines: tidy,
    colors: tidy.map((line, i) => (line.trim() && block.lines[i] === line ? block.colors[i] : null)),
  }
  return joinBlocks(sections, blocks)
}

/** Rebuilds sections from blocks, merging neighbours that share a type and label. */
function joinBlocks(sections: LyricsSongSection[], blocks: SlideBlock[]): LyricsSongSection[] {
  const result: LyricsSongSection[] = []
  for (const block of blocks) {
    const base = sections[block.source]
    const last = result.at(-1)
    if (last && last.type === base.type && last.label === base.label && last.lines.length && block.lines.length) {
      last.lines.push('', ...block.lines)
      last.lineColors!.push(null, ...block.colors)
    } else {
      result.push({ ...base, lines: [...block.lines], lineColors: [...block.colors] })
    }
  }
  return uniqueHotkeys(result)
}

/**
 * Moves a slide next to another and makes it part of that slide's section —
 * drop a verse slide among the chorus slides and it becomes chorus. Sections
 * that end up side by side with the same label merge, so moving slides never
 * leaves a trail of one-slide "Verse 2" fragments.
 */
export function moveLyricSlide(
  sections: LyricsSongSection[],
  from: number,
  target: number,
  side: 'before' | 'after',
): LyricsSongSection[] {
  const blocks = slideBlocks(sections)
  if (from < 0 || target < 0 || from >= blocks.length || target >= blocks.length) return sections
  const insertAt = side === 'before' ? target : target + 1
  if (insertAt === from || insertAt === from + 1) {
    // Same place — but it may still be joining the neighbouring section.
    if (blocks[from].source === blocks[target].source) return sections
  }
  const moved = { ...blocks[from], source: blocks[target].source }
  const rest = blocks.filter((_, index) => index !== from)
  rest.splice(from < insertAt ? insertAt - 1 : insertAt, 0, moved)
  return joinBlocks(sections, rest)
}

/**
 * A section split by a move or relabel copies its fields to both halves; a
 * hotkey must stay on one of them (the first), or one key would mean two places.
 */
function uniqueHotkeys(sections: LyricsSongSection[]): LyricsSongSection[] {
  const seen = new Set<string>()
  return sections.map((section) => {
    if (!section.hotkey) return section
    if (!seen.has(section.hotkey)) {
      seen.add(section.hotkey)
      return section
    }
    const { hotkey: _duplicate, ...rest } = section
    return rest
  })
}
