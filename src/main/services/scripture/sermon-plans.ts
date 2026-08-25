import fs from 'fs/promises'
import path from 'path'
import Store from 'electron-store'
import mammoth from 'mammoth'
import pdfParse from 'pdf-parse'
import type { ScriptureTranslation, SermonPlan, SermonPlanDraft } from '@shared/ipc'
import { BOOKS } from './bible-db'

const TRANSLATION_ALIASES: Record<string, ScriptureTranslation> = {
  NKJV: 'NKJV', KJV: 'KJV', BSB: 'BSB', WEB: 'WEB', ASV: 'ASV', OEB: 'OEB',
  NIV: 'NIV', NLT: 'NLT', NASB: 'NASB', MSG: 'MSG', MESSAGE: 'MSG',
  AMPC: 'AMPC', AMP: 'AMPC', 'AMPLIFIED CLASSIC': 'AMPC',
  TPT: 'TPT', PASSION: 'TPT', 'THE PASSION TRANSLATION': 'TPT',
  ESV: 'ESV', CSB: 'CSB',
}

const translationPattern = Object.keys(TRANSLATION_ALIASES)
  .sort((a, b) => b.length - a.length)
  .map(escapeRegex)
  .join('|')

const bookAliases = BOOKS.flatMap((book) => [book.name, book.abbr, ...book.aliases]
  .map((alias) => ({ alias, name: book.name })))
  .sort((a, b) => b.alias.length - a.alias.length)

const bookPattern = bookAliases.map(({ alias }) => escapeRegex(alias)).join('|')
const referencePattern = new RegExp(
  `(?:\\b(${translationPattern})\\b[\\s:,-]*)?\\b(${bookPattern})\\s+(\\d{1,3}):(\\d{1,3})(?:\\s*[-–—]\\s*(\\d{1,3}))?(?:\\s*[([]?(${translationPattern})[)\\]]?)?`,
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
  const items: SermonPlanDraft['items'] = []
  const seen = new Set<string>()
  referencePattern.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = referencePattern.exec(text)) !== null) {
    const translation = normalizeTranslation(match[1] || match[6], defaultTranslation)
    const book = canonicalBook(match[2])
    const range = match[5] ? `–${match[5]}` : ''
    const reference = `${book} ${match[3]}:${match[4]}${range}`
    const key = `${reference}|${translation}`
    if (seen.has(key)) continue
    seen.add(key)
    items.push({ id: `verse-${items.length + 1}-${Date.now()}`, reference, translation })
  }
  return items
}

export async function readSermonDocument(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.docx') return (await mammoth.extractRawText({ path: filePath })).value
  if (ext === '.pdf') return (await pdfParse(await fs.readFile(filePath))).text
  if (ext === '.txt' || ext === '.md' || ext === '.rtf') return fs.readFile(filePath, 'utf8')
  throw new Error('Unsupported document. Choose a DOCX, PDF, TXT, MD, or RTF file.')
}

interface SermonPlanSchema {
  plans: SermonPlan[]
  /** Playlist referenced by live transcription. null = none. */
  livePlanId: string | null
}

class SermonPlanStore {
  private readonly store = new Store<SermonPlanSchema>({
    name: 'proautomate-sermon-plans',
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
