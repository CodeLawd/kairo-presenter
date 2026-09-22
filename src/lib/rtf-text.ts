/**
 * Plain text out of an RTF document.
 *
 * Song sheets get passed around as RTF because that is what TextEdit and
 * WordPad save by default, so an operator's folder of songs is often a folder
 * of .rtf files. RTF is plain ASCII markup, so this is a small reader rather
 * than a dependency: control words, groups, escapes and the tables that carry
 * no text.
 *
 * It keeps line and paragraph breaks, because that is what the lyrics parser
 * reads sections from. Everything else — fonts, colours, styles, embedded
 * pictures — is dropped.
 */

/** Groups whose entire contents are formatting metadata, never body text. */
const SKIPPED_DESTINATIONS = new Set([
  'fonttbl',
  'colortbl',
  'stylesheet',
  'listtable',
  'listoverridetable',
  'revtbl',
  'rsidtbl',
  'generator',
  'info',
  'pict',
  'object',
  'themedata',
  'colorschememapping',
  'latentstyles',
  'datastore',
  'xmlnstbl',
  'fldinst',
  'expandedcolortbl',
])

/** Control words that produce a line break rather than text. */
const BREAK_WORDS = new Set(['par', 'line', 'sect', 'page', 'column', 'softline'])

/** Control words that produce a literal character. */
const LITERAL_WORDS: Record<string, string> = {
  tab: '\t',
  emdash: '—',
  endash: '–',
  emspace: ' ',
  enspace: ' ',
  qmspace: ' ',
  bullet: '•',
  lquote: '‘',
  rquote: '’',
  ldblquote: '“',
  rdblquote: '”',
  nbsp: ' ',
}

/**
 * Windows-1252 has printable characters where Latin-1 has control codes, and
 * RTF writes them as `\'hh`. Without this map, a curly quote or dash written
 * by Word comes out as an invisible control character mid-lyric.
 */
const CP1252_HIGH: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…',
  0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š',
  0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’',
  0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
  0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ',
  0x9e: 'ž', 0x9f: 'Ÿ',
}

interface GroupState {
  /** Characters to skip after a `\uN` — set by `\ucN`, inherited by children. */
  unicodeSkip: number
  /** True when this group's text is metadata and must not be emitted. */
  ignoring: boolean
}

/** Cheap check for RTF content, for callers that only have the bytes. */
export function looksLikeRtf(raw: string): boolean {
  return raw.trimStart().startsWith('{\\rtf')
}

/**
 * Converts an RTF document to plain text.
 *
 * Returns '' for input that is not RTF at all; callers treat that as "not a
 * song file" rather than importing an empty song.
 */
export function rtfToPlainText(raw: string): string {
  if (!raw || !looksLikeRtf(raw)) return ''

  const out: string[] = []
  const stack: GroupState[] = []
  let state: GroupState = { unicodeSkip: 1, ignoring: false }
  /** Characters still to be swallowed as a `\uN` fallback. */
  let skipChars = 0

  const emit = (text: string): void => {
    if (state.ignoring) return
    if (skipChars > 0) {
      // The fallback for a \uN is plain text; drop exactly as many as \uc said.
      const drop = Math.min(skipChars, text.length)
      skipChars -= drop
      const rest = text.slice(drop)
      if (!rest) return
      out.push(rest)
      return
    }
    out.push(text)
  }

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i]

    if (char === '{') {
      stack.push(state)
      state = { ...state }
      continue
    }

    if (char === '}') {
      state = stack.pop() ?? { unicodeSkip: 1, ignoring: false }
      skipChars = 0
      continue
    }

    if (char === '\r' || char === '\n') continue

    if (char !== '\\') {
      emit(char)
      continue
    }

    // ── from here on: a control sequence ──
    const next = raw[i + 1]

    if (next === undefined) break

    // Escaped literals: \\ \{ \}
    if (next === '\\' || next === '{' || next === '}') {
      emit(next)
      i++
      continue
    }

    // A backslash before a newline is a paragraph break in some writers.
    if (next === '\n' || next === '\r') {
      if (!state.ignoring) out.push('\n')
      i++
      continue
    }

    // \'hh — a raw byte in the document's codepage.
    if (next === "'") {
      const hex = raw.slice(i + 2, i + 4)
      const code = parseInt(hex, 16)
      i += 3
      if (!Number.isNaN(code)) emit(CP1252_HIGH[code] ?? String.fromCharCode(code))
      continue
    }

    // `{\*\destination …}` marks a group a reader is free to skip. TextEdit
    // writes `{\*\expandedcolortbl;;}` on every save, and without this the
    // group's `;;` lands at the top of the document — in practice, as the
    // song's title.
    if (next === '*') {
      state.ignoring = true
      i++
      continue
    }

    // Non-alphabetic control symbols: \~ \- \_ and friends.
    if (!/[a-zA-Z]/.test(next)) {
      if (next === '~') emit(' ')
      // \- (optional hyphen) and \_ (non-breaking hyphen) carry no text we want.
      i++
      continue
    }

    // \word, optionally followed by a numeric parameter and one space.
    const match = raw.slice(i + 1).match(/^([a-zA-Z]+)(-?\d+)?[ ]?/)
    if (!match) {
      i++
      continue
    }
    const word = match[1]
    const param = match[2] === undefined ? null : parseInt(match[2], 10)
    i += match[0].length

    if (word === 'u' && param !== null) {
      if (!state.ignoring) {
        // Surrogate halves arrive as two \u words with negative parameters.
        out.push(String.fromCharCode(param < 0 ? param + 65536 : param))
      }
      skipChars = state.unicodeSkip
      continue
    }

    if (word === 'uc' && param !== null) {
      state.unicodeSkip = Math.max(0, param)
      continue
    }

    if (SKIPPED_DESTINATIONS.has(word.toLowerCase())) {
      state.ignoring = true
      continue
    }

    if (BREAK_WORDS.has(word)) {
      if (!state.ignoring) out.push('\n')
      skipChars = 0
      continue
    }

    const literal = LITERAL_WORDS[word]
    if (literal !== undefined) {
      emit(literal)
      continue
    }

    // Any other control word is formatting — it produces no text.
  }

  return tidy(out.join(''))
}

/** Collapses the whitespace RTF writers scatter, keeping stanza breaks. */
function tidy(text: string): string {
  return text
    // A stray NUL comes from a truncated \'00 escape; a regex for it trips
    // the control-character lint rule, so split/join does the same job.
    .split('\u0000')
    .join('')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
