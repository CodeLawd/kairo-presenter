import type { LyricsSongSection } from './ipc'

/** Move raw slide blocks, preserving line colors and section identity. */
export function reorderLyricSlide(sections: LyricsSongSection[], from: number, to: number): LyricsSongSection[] {
  const blocks: { source: number; lines: string[]; colors: (string | null)[] }[] = []
  sections.forEach((section, source) => {
    let block = { source, lines: [] as string[], colors: [] as (string | null)[] }
    section.lines.forEach((line, index) => {
      if (!line.trim()) {
        if (block.lines.length) { blocks.push(block); block = { source, lines: [], colors: [] } }
      } else { block.lines.push(line); block.colors.push(section.lineColors?.[index] ?? null) }
    })
    if (block.lines.length || !section.lines.some(line => line.trim())) blocks.push(block)
  })
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
  return result
}
