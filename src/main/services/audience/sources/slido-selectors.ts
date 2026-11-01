/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

/** All third-party DOM assumptions live here; verified against event 9374525. */
export const SLIDO_SELECTORS = {
  publicCards: '.question-item[data-qid]',
  publicText: '[data-testid="question-text"], .question-item__body',
  publicAuthor: '[data-testid="question-author"]',
  publicVotes: '.score__btn--plus > span',
  moderatorCards: '[data-question-id][data-testid="question"]',
  moderatorText: '[class*="questionText-"]',
  moderatorAuthor: '[data-testid="user-name"]',
  moderatorVotes: '[class*="srOnly-"]',
  moderatorCard: '[data-item-question-card]',
  pendingButton: 'button',
  joinInput: 'input[placeholder="enter code here"]',
  joinButton: '#search__btn-submit',
  /** The public page's ask box: present means the Q&A page loaded, even with no questions yet. */
  publicAskBox: '[placeholder*="question" i]',
} as const

/** Slido's message for a code with no live event, on the join page. */
const NOT_FOUND = /no such slido/i
/** Event pages are titled "Q&A on <event name>". */
const TITLE_PREFIX = /^(?:Q&A|Polls|Quiz|Ideas|Survey)\s+on\s+/i

export interface SlidoPageRead {
  questions: SlidoExtractedQuestion[]
  /** The page is the event's question view and simply has none yet. */
  empty: boolean
  notFound: boolean
  eventName: string | null
}

/** Everything the source needs from one look at the page. */
export function readSlidoPage(document: Document, location: Location, mode: 'public' | 'moderator'): SlidoPageRead {
  const onEvent = location.pathname.startsWith('/event/')
  const questions = onEvent ? extractSlidoQuestions(document, mode) : []
  return {
    questions,
    empty: onEvent && mode === 'public' && !questions.length && !!document.querySelector(SLIDO_SELECTORS.publicAskBox),
    notFound: !onEvent && NOT_FOUND.test(document.body?.innerText ?? ''),
    eventName: onEvent && location.hostname === 'app.sli.do' && TITLE_PREFIX.test(document.title) ? document.title.replace(TITLE_PREFIX, '').trim() || null : null,
  }
}

export interface SlidoExtractedQuestion { externalId: string; text: string; author: string | null; votes: number }

/** Visible DOM only: never reads internal state, network responses or private APIs. */
export function extractSlidoQuestions(document: Document, mode: 'public' | 'moderator'): SlidoExtractedQuestion[] {
  const moderator = mode === 'moderator'
  const cards = document.querySelectorAll<HTMLElement>(moderator ? SLIDO_SELECTORS.moderatorCards : SLIDO_SELECTORS.publicCards)
  const result = new Map<string, SlidoExtractedQuestion>()
  for (const card of cards) {
    if (!card.getClientRects().length || card.closest('[aria-hidden="true"], [hidden]')) continue
    const text = card.querySelector<HTMLElement>(moderator ? SLIDO_SELECTORS.moderatorText : SLIDO_SELECTORS.publicText)?.innerText?.trim()
    const externalId = card.getAttribute(moderator ? 'data-question-id' : 'data-qid')
    const author = card.querySelector<HTMLElement>(moderator ? SLIDO_SELECTORS.moderatorAuthor : SLIDO_SELECTORS.publicAuthor)?.innerText?.trim()
    let voteText = card.querySelector<HTMLElement>(moderator ? SLIDO_SELECTORS.moderatorVotes : SLIDO_SELECTORS.publicVotes)?.innerText?.trim()
    if (moderator && !voteText) voteText = card.closest(SLIDO_SELECTORS.moderatorCard)?.getAttribute('aria-label')?.match(/([\d,]+) votes?\s*$/)?.[1]
    const voteMatch = voteText?.match(/^([\d,\s]+)(?:\s+votes?)?$/)
    if (!text || !externalId || !voteMatch) continue
    const votes = Number(voteMatch[1].replace(/[,\s]/g, ''))
    if (!Number.isSafeInteger(votes) || votes < 0) continue
    result.set(externalId, { externalId, text, author: !author || author === 'Anonymous' ? null : author, votes })
  }
  return [...result.values()]
}

/** Search/queue navigation only; these selectors never address moderation controls. */
export function pendingQueueButton(document: Document): HTMLButtonElement | null {
  return [...document.querySelectorAll<HTMLButtonElement>(SLIDO_SELECTORS.pendingButton)].find(button => /^Pending\s+[1-9]\d*$/.test(button.innerText.trim()) && !button.disabled) ?? null
}
