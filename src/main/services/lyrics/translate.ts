import axios, { AxiosError } from 'axios'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import log from 'electron-log/main'
import type { LyricsSongSection } from '@shared/ipc'
import {
  applyLineGlosses,
  collectTranslatableIndices,
  isLikelyEnglishLyric,
  shouldApplyGloss,
  stripLineGlosses,
} from '@shared/lyrics-translate'
import { fetchOnlineGlossMap, lookupOnlineGloss } from './online-glosses'

const TRANSLATE_URL = 'https://translation.googleapis.com/language/translate/v2'
const REQUEST_TIMEOUT_MS = 45_000
const BATCH_SIZE = 100
const LLM_BATCH_SIZE = 40
const DEFAULT_MODEL_ANTHROPIC = 'claude-haiku-4-5-20251001'
const DEFAULT_MODEL_DEEPSEEK = 'deepseek-v4-flash'
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com'

export interface TranslateSectionsOptions {
  target?: string
  /** BCP-47 / Google code, or 'auto'. Yoruba=yo, Igbo=ig, Hausa=ha. */
  sourceLanguage?: string
  apiKey: string
  title?: string
  artist?: string
  braveApiKey?: string
  llm?: { provider: 'anthropic' | 'deepseek'; apiKey: string } | null
}

interface TranslatedLine {
  text: string
  detectedSourceLanguage?: string
}

/**
 * Builds bilingual glosses under each lyric line.
 *
 * Order of preference:
 * 1. English already published on gospel lyric sites (best for Odudu / Amioluwa)
 * 2. Configured LLM (Anthropic / DeepSeek)
 * 3. Google Cloud Translation
 */
export async function translateSections(
  sections: LyricsSongSection[],
  options: TranslateSectionsOptions
): Promise<LyricsSongSection[]> {
  const apiKey = options.apiKey?.trim()
  const target = (options.target ?? 'en').trim() || 'en'
  const sourceLanguage = normalizeSource(options.sourceLanguage)

  // Always start from bare lyrics so "Translate again" replaces old glosses
  // instead of leaving unmatched lines with the previous machine translation.
  const bareSections = sections.map((section) => ({
    ...section,
    lines: stripLineGlosses(section.lines),
  }))

  const jobs: { sectionIndex: number; lineIndex: number; text: string }[] = []
  for (let s = 0; s < bareSections.length; s++) {
    const lines = bareSections[s].lines
    for (const lineIndex of collectTranslatableIndices(lines)) {
      jobs.push({ sectionIndex: s, lineIndex, text: lines[lineIndex] })
    }
  }

  if (jobs.length === 0) {
    return bareSections.map((section) => ({ ...section, lines: [...section.lines] }))
  }

  const onlinePairs =
    options.title?.trim()
      ? await fetchOnlineGlossMap({
          title: options.title,
          artist: options.artist,
          braveApiKey: options.braveApiKey,
        })
      : new Map<string, string>()

  const glossMaps = bareSections.map(() => new Map<number, string>())
  const pending: { jobIndex: number; text: string }[] = []
  let fromWeb = 0
  let skippedEnglish = 0

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i]
    if (isLikelyEnglishLyric(job.text)) {
      skippedEnglish++
      continue
    }
    const online = lookupOnlineGloss(job.text, onlinePairs)
    if (online && shouldApplyGloss(job.text, online, 'und')) {
      glossMaps[job.sectionIndex].set(job.lineIndex, online)
      fromWeb++
      continue
    }
    pending.push({ jobIndex: i, text: job.text })
  }

  let engine: 'web-only' | 'llm' | 'google' | 'web+llm' | 'web+google' = 'web-only'
  let fromMachine = 0

  // Google / LLM invent nonsense for Igbo/Yoruba/Igala worship. Once a real
  // lyric-site edition covers a solid share of lines, leave the rest bare
  // rather than filling with machine junk — and never keep stale glosses
  // (caller strips first).
  const coverage = fromWeb / Math.max(1, jobs.length - skippedEnglish)
  const trustWebEdition = fromWeb >= 2 && coverage >= 0.4
  const pendingForMachine = trustWebEdition ? [] : pending

  if (pendingForMachine.length > 0) {
    const llm = resolveLlmClient(options.llm)
    let translations: TranslatedLine[]

    if (llm) {
      engine = fromWeb > 0 ? 'web+llm' : 'llm'
      translations = await translateWithLlm(
        pendingForMachine.map((item) => item.text),
        llm,
        sourceLanguage
      )
    } else if (!apiKey) {
      if (fromWeb > 0) {
        engine = 'web-only'
        translations = []
      } else {
        throw new Error(
          'No online glosses found. Add a Google Translate API key — or an Anthropic/DeepSeek key — in Settings.'
        )
      }
    } else {
      engine = fromWeb > 0 ? 'web+google' : 'google'
      translations = await translateBatch(
        pendingForMachine.map((item) => item.text),
        apiKey,
        target,
        sourceLanguage
      )
    }

    for (let p = 0; p < pendingForMachine.length; p++) {
      const item = pendingForMachine[p]
      const job = jobs[item.jobIndex]
      const result = translations[p]
      if (!result) continue
      const detected =
        sourceLanguage !== 'auto' && engine.includes('google')
          ? sourceLanguage
          : result.detectedSourceLanguage
      if (!shouldApplyGloss(job.text, result.text, detected)) {
        skippedEnglish++
        continue
      }
      glossMaps[job.sectionIndex].set(job.lineIndex, result.text)
      fromMachine++
    }
  } else if (trustWebEdition) {
    engine = 'web-only'
  }

  log.info('[LyricsTranslate] done', {
    engine,
    jobs: jobs.length,
    fromWeb,
    fromMachine,
    skippedEnglish,
    target,
    sourceLanguage,
  })

  return bareSections.map((section, s) => ({
    ...section,
    lines: applyLineGlosses(section.lines, glossMaps[s]),
  }))
}

function normalizeSource(raw?: string): string {
  const code = (raw ?? 'auto').trim().toLowerCase()
  if (!code || code === 'auto' || code === 'detect') return 'auto'
  return code
}

function resolveLlmClient(
  llm: TranslateSectionsOptions['llm']
):
  | { provider: 'anthropic'; client: Anthropic; model: string }
  | { provider: 'deepseek'; client: OpenAI; model: string }
  | null {
  if (!llm?.apiKey?.trim()) return null
  if (llm.provider === 'deepseek') {
    return {
      provider: 'deepseek',
      client: new OpenAI({ apiKey: llm.apiKey.trim(), baseURL: DEEPSEEK_BASE_URL }),
      model: DEFAULT_MODEL_DEEPSEEK,
    }
  }
  return {
    provider: 'anthropic',
    client: new Anthropic({ apiKey: llm.apiKey.trim() }),
    model: DEFAULT_MODEL_ANTHROPIC,
  }
}

async function translateWithLlm(
  texts: string[],
  llm: NonNullable<ReturnType<typeof resolveLlmClient>>,
  sourceLanguage: string
): Promise<TranslatedLine[]> {
  const out: TranslatedLine[] = []
  for (let i = 0; i < texts.length; i += LLM_BATCH_SIZE) {
    const chunk = texts.slice(i, i + LLM_BATCH_SIZE)
    out.push(...(await translateLlmChunk(chunk, llm, sourceLanguage)))
  }
  return out
}

async function translateLlmChunk(
  texts: string[],
  llm: NonNullable<ReturnType<typeof resolveLlmClient>>,
  sourceLanguage: string
): Promise<TranslatedLine[]> {
  const sourceHint =
    sourceLanguage === 'auto'
      ? 'Auto-detect each line’s language (often Yoruba, Igbo, or mixed Nigerian worship).'
      : `Source language code: ${sourceLanguage}. Treat every line as that language unless it is clearly already English.`

  const system = `You translate Christian / African gospel worship lyrics into clear English for a church operator cue sheet.
Rules:
- Return ONLY a JSON array of strings with the SAME length and order as the input.
- One English gloss per input line. No markdown, no commentary.
- Preserve proper names and titles (Amioluwa, Odudu, Jesus, Jehovah, Eje Jesu, etc.) when they function as names.
- Keep meaning faithful; do not invent new theology or rewrite the song.
- If a line is already English (or mostly English), return that line unchanged.
- ${sourceHint}`

  const user = JSON.stringify(texts)

  let raw: string
  try {
    if (llm.provider === 'anthropic') {
      const response = await llm.client.messages.create({
        model: llm.model,
        max_tokens: 4096,
        temperature: 0.2,
        system,
        messages: [{ role: 'user', content: user }],
      })
      const block = response.content.find((part) => part.type === 'text')
      raw = block && block.type === 'text' ? block.text : ''
    } else {
      const response = await llm.client.chat.completions.create({
        model: llm.model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      })
      raw = response.choices[0]?.message?.content ?? ''
    }
  } catch (err) {
    throw new Error(`LLM translation failed. ${(err as Error).message || 'Unknown error.'}`)
  }

  const parsed = parseJsonStringArray(raw, texts.length)
  return parsed.map((text, i) => ({
    text: text.trim() || texts[i],
    detectedSourceLanguage:
      text.trim().toLowerCase() === texts[i].trim().toLowerCase()
        ? 'en'
        : sourceLanguage === 'auto'
          ? 'und'
          : sourceLanguage,
  }))
}

function parseJsonStringArray(raw: string, expected: number): string[] {
  const trimmed = raw.trim()
  const start = trimmed.indexOf('[')
  const end = trimmed.lastIndexOf(']')
  if (start < 0 || end < start) {
    throw new Error('LLM returned an unexpected translation format.')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed.slice(start, end + 1))
  } catch {
    throw new Error('LLM returned invalid JSON for translations.')
  }
  if (!Array.isArray(parsed) || parsed.length !== expected) {
    throw new Error('LLM returned the wrong number of translated lines.')
  }
  return parsed.map((entry) => String(entry ?? ''))
}

async function translateBatch(
  texts: string[],
  apiKey: string,
  target: string,
  sourceLanguage: string
): Promise<TranslatedLine[]> {
  const out: TranslatedLine[] = []
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const chunk = texts.slice(i, i + BATCH_SIZE)
    out.push(...(await translateChunk(chunk, apiKey, target, sourceLanguage)))
  }
  return out
}

async function translateChunk(
  texts: string[],
  apiKey: string,
  target: string,
  sourceLanguage: string
): Promise<TranslatedLine[]> {
  try {
    const body: Record<string, unknown> = { q: texts, target, format: 'text' }
    if (sourceLanguage !== 'auto') body.source = sourceLanguage

    const response = await axios.post(TRANSLATE_URL, body, {
      params: { key: apiKey },
      headers: { 'Content-Type': 'application/json' },
      timeout: REQUEST_TIMEOUT_MS,
    })
    const rows = (response.data as {
      data?: {
        translations?: { translatedText?: string; detectedSourceLanguage?: string }[]
      }
    })?.data?.translations

    if (!Array.isArray(rows) || rows.length !== texts.length) {
      throw new Error('Unexpected response from Google Translate.')
    }

    return rows.map((row, i) => ({
      text: (row.translatedText ?? texts[i]).trim(),
      detectedSourceLanguage:
        row.detectedSourceLanguage ?? (sourceLanguage !== 'auto' ? sourceLanguage : undefined),
    }))
  } catch (err) {
    throw toFriendlyError(err)
  }
}

function toFriendlyError(err: unknown): Error {
  const axiosErr = err as AxiosError<{ error?: { message?: string } }>
  if (axiosErr?.isAxiosError) {
    const status = axiosErr.response?.status
    const apiMessage = axiosErr.response?.data?.error?.message
    if (status === 400 && /API key|keyNotValid|invalid/i.test(apiMessage ?? axiosErr.message)) {
      return new Error('The Google Translate API key was rejected.')
    }
    if (status === 403) {
      return new Error(
        apiMessage?.includes('billing')
          ? 'Google Translate requires billing enabled on this Cloud project.'
          : 'Google Translate access was denied. Check the API key and that Cloud Translation API is enabled.'
      )
    }
    if (status === 429) return new Error('Google Translate quota reached for now.')
    if (axiosErr.code === 'ECONNABORTED') return new Error('Translation timed out.')
    if (axiosErr.code === 'ENOTFOUND' || axiosErr.code === 'EAI_AGAIN') {
      return new Error('No internet connection.')
    }
    if (apiMessage) return new Error(apiMessage)
  }
  if (err instanceof Error) return err
  return new Error('Translation failed.')
}
