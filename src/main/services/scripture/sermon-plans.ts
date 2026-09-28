import fs from 'fs/promises'
import path from 'path'
import Store from 'electron-store'
import { renamedStore } from '../../db/legacy-store'
import mammoth from 'mammoth'
import pdfParse from 'pdf-parse'
import type {
  ScriptureTranslation,
  SermonNotesAnalysis,
  SermonPlan,
  SermonPlanDraft,
} from '@shared/ipc'
import { plainTextToEditorHtml } from '@shared/sermon-notes-review'
import { buildTranslationAliasMap } from '@shared/bible-translations'
import { BOOKS } from './bible-db'

export interface SermonDocumentContent {
  text: string
  html: string
}

// Derived from the bible-translations registry — new translations (and their
// aliases) are detected in sermon notes with no code change here.
const TRANSLATION_ALIASES: Record<string, ScriptureTranslation> = buildTranslationAliasMap()

const translationPattern = Object.keys(TRANSLATION_ALIASES)
  .sort((a, b) => b.length - a.length)
  .map(escapeRegex)
  .join('|')

const bookAliases = BOOKS.flatMap((book) => [book.name, book.abbr, ...book.aliases]
  .map((alias) => ({ alias, name: book.name })))
  .sort((a, b) => b.alias.length - a.alias.length)

const bookPattern = bookAliases.map(({ alias }) => escapeRegex(alias)).join('|')
const trailingTranslationsPattern = `(?:${translationPattern})(?:\\s*[,/]\\s*(?:${translationPattern}))*`
const referencePattern = new RegExp(
  `(?:\\b(${translationPattern})\\b[\\s:,-]*)?\\b(${bookPattern})\\s+(\\d{1,3})(?:\\s*:\\s*|\\s+)(\\d{1,3})(?:\\s*[-–—]\\s*(\\d{1,3}))?(?:\\s*[([]?(${trailingTranslationsPattern})[)\\]]?)?`,
  'gi',
)

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function canonicalBook(value: string): string {
  const normalized = value.toLowerCase().replace(/\s+/g, '')
  return bookAliases.find(({ alias }) => alias.toLowerCase().replace(/\s+/g, '') === normalized)?.name ?? value
}

function normalizeTranslation(value: string | undefined, fallback: ScriptureTranslation): ScriptureTranslation {
  if (!value) return fallback
  return TRANSLATION_ALIASES[value.toUpperCase().replace(/\s+/g, ' ')] ?? fallback
}

export function extractScriptureReferences(
  text: string,
  defaultTranslation: ScriptureTranslation,
): SermonPlanDraft['items'] {
  return analyzeScriptureReferences(text, defaultTranslation).items
}

export function analyzeScriptureReferences(
  text: string,
  defaultTranslation: ScriptureTranslation,
): SermonNotesAnalysis {
  const items: SermonPlanDraft['items'] = []
  const matches: SermonNotesAnalysis['matches'] = []
  const seen = new Set<string>()
  referencePattern.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = referencePattern.exec(text)) !== null) {
    const book = canonicalBook(match[2])
    const range = match[5] ? `–${match[5]}` : ''
    const reference = `${book} ${match[3]}:${match[4]}${range}`
    const translations = match[6]
      ? match[6].split(/\s*[,/]\s*/).map((value) => normalizeTranslation(value, defaultTranslation))
      : [normalizeTranslation(match[1], defaultTranslation)]
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[0],
      reference,
      translations,
    })
    for (const translation of translations) {
      const key = `${reference}|${translation}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push({ id: `verse-${items.length + 1}-${Date.now()}`, reference, translation })
    }
  }
  return { matches, items }
}

export async function readSermonDocument(filePath: string): Promise<SermonDocumentContent> {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.docx') {
    const [htmlResult, textResult] = await Promise.all([
      mammoth.convertToHtml({ path: filePath }),
      mammoth.extractRawText({ path: filePath }),
    ])
    return { text: textResult.value, html: htmlResult.value || plainTextToEditorHtml(textResult.value) }
  }
  if (ext === '.pdf') {
    const text = (await pdfParse(await fs.readFile(filePath))).text
    return { text, html: plainTextToEditorHtml(text) }
  }
  if (ext === '.txt' || ext === '.md' || ext === '.rtf') {
    const text = await fs.readFile(filePath, 'utf8')
    return { text, html: plainTextToEditorHtml(text) }
  }
  throw new Error('Unsupported document. Choose a DOCX, PDF, TXT, MD, or RTF file.')
}

interface SermonPlanSchema {
  plans: SermonPlan[]
  /** Playlist referenced by live transcription. null = none. */
  livePlanId: string | null
}

class SermonPlanStore {
  private readonly store = new Store<SermonPlanSchema>({
    name: renamedStore('proautomate-sermon-plans', 'kairo-sermon-plans'),
    defaults: { plans: [], livePlanId: null },
  })

  list(): SermonPlan[] {
    return this.store.get('plans').sort((a, b) => b.updatedAt - a.updatedAt)
  }

  get(id: string): SermonPlan | null {
    return this.store.get('plans').find((plan) => plan.id === id) ?? null
  }

  // electron-store shallow-merges `defaults`, so installs that predate this key
  // read back undefined — never assume the field exists.
  getLivePlanId(): string | null {
    return this.store.get('livePlanId') ?? null
  }

  setLivePlanId(id: string | null): void {
    this.store.set('livePlanId', id)
  }

  save(plan: SermonPlan): SermonPlan {
    const plans = this.store.get('plans')
    const index = plans.findIndex((candidate) => candidate.id === plan.id)
    const saved = { ...plan, updatedAt: Date.now() }
    if (index >= 0) plans[index] = saved
    else plans.unshift(saved)
    this.store.set('plans', plans)
    return saved
  }

  delete(id: string): void {
    this.store.set('plans', this.store.get('plans').filter((plan) => plan.id !== id))
    if (this.getLivePlanId() === id) this.setLivePlanId(null)
  }
}

export const sermonPlanStore = new SermonPlanStore()
