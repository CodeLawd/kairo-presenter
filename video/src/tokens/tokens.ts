/**
 * Colours lifted from the app's dark theme (src/renderer/src/index.css) and the
 * brand palette (CLAUDE.md). Keep these in step with the app; never invent chrome.
 */
const rgb = (v: string, a = 1): string => (a === 1 ? `rgb(${v})` : `rgb(${v} / ${a})`)

const raw = {
  surface: '17 19 25',
  surface2: '24 27 35',
  surface3: '33 37 48',
  elevated: '42 46 59',
  rail: '28 31 40',
  border: '56 61 76',
  line: '38 42 54',
  stage: '10 11 16',
  display: '76 81 98',
  accent: '59 107 255',
  accent200: '176 202 255',
  accent300: '138 180 255',
  accent600: '47 91 224',
  live: '240 68 56',
  tintLive: '74 40 44',
  tintTeal: '33 37 48',
  text: '238 238 242',
  fg300: '214 217 226',
  fg400: '186 190 204',
  fg500: '157 163 182',
  fg600: '125 131 153',
  green: '94 204 140',
  blue: '110 172 255',
  violet: '167 139 245',
  cyan: '72 194 216',
  pink: '236 120 178',
  orange: '240 152 84',
} as const

export type Token = keyof typeof raw

export const c = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, rgb(v)])) as Record<Token, string>

/** A token at some opacity, for washes and focus dimming. */
export const ca = (token: Token, alpha: number): string => rgb(raw[token], alpha)

/** Brand marks only. */
export const brand = {
  ink: '#0C111D',
  paper: '#F9FAFB',
  stone: '#374151',
} as const

/** The website's radiant-lines palette (ThesisLines.tsx). */
export const RADIANT = ['#FF6B4A', '#2DD4BF', '#FBBF24', '#60A5FA', '#F472B6', '#A3E635', '#94A3B8']
