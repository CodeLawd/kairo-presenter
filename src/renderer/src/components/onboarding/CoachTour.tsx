import { useEffect, useRef, useState } from 'react'
import type { NavRoute } from '@/App'

export interface CoachStep {
  /** CSS selector; the first match that is actually on screen is used. */
  target: string
  title: string
  body: string
}

/** Where things are, right after setup — a short walk round the Operator, or one tip on a quick-start tab. */
export const COACH_TOURS: Record<'operator' | 'scripture' | 'lyrics' | 'documents', CoachStep[]> = {
  // The Operator is the live desk: listen, catch verses, show them, stay safe.
  operator: [
    { target: 'nav[aria-label="Workspaces"]', title: 'Your workspaces', body: 'Scripture, Lyrics, Documents and Themes live here.' },
    { target: '[data-tour="transcript-start"]', title: 'Start listening', body: 'Hit Start when the message begins. Kairo transcribes the sermon live.' },
    { target: '[data-tour="detected"]', title: 'Detected verses', body: 'Verses the preacher reads land here as slides. Click one to send it live.' },
    { target: '[data-tour="automation"]', title: 'Automation', body: 'When it’s sure of a single verse, Kairo puts it on screen after a short countdown you can cancel.' },
    { target: '[data-tour="live-preview"]', title: 'What the room sees', body: 'This preview always shows what’s on screen right now.' },
    { target: '.header-live', title: 'Your safety net', body: 'Clear takes text and backgrounds off the screen instantly.' },
    { target: '.header-statuses > :first-child', title: 'Screens', body: 'Choose which display your audience sees.' },
  ],
  scripture: [
    { target: 'input[name="scripture-query"]', title: 'Find any verse', body: 'Type a reference like John 3:16, or words you remember.' },
  ],
  lyrics: [
    { target: '[data-tour="lyrics-new"]', title: 'Add your first song', body: 'Type it in or import lyrics — it’s saved to your Songs folder.' },
  ],
  documents: [
    { target: '[data-tour="documents-import"]', title: 'Bring in a deck', body: 'Import a PowerPoint or PDF to present it page by page.' },
  ],
}

/** Ask the app to replay the Operator tips (Settings → Account → Show tips again). */
export const COACH_TOUR_EVENT = 'kairo:coach-tour'
export function requestCoachTour(): void {
  window.dispatchEvent(new Event(COACH_TOUR_EVENT))
}

export function coachTourFor(route: NavRoute | undefined): CoachStep[] | null {
  const key = route ?? 'operator'
  return key in COACH_TOURS ? COACH_TOURS[key as keyof typeof COACH_TOURS] : null
}

const PAD = 6
const CARD_W = 280
const GAP = 14

function findVisible(selector: string): DOMRect | null {
  for (const node of Array.from(document.querySelectorAll(selector))) {
    const rect = node.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) return rect
  }
  return null
}

/** Beside the target where it fits: right, below, left, then above — kept inside the window. */
function placeCard(rect: DOMRect, height: number): { left: number; top: number } {
  const vw = window.innerWidth, vh = window.innerHeight
  const clampX = (x: number): number => Math.min(Math.max(12, x), vw - CARD_W - 12)
  const clampY = (y: number): number => Math.min(Math.max(12, y), vh - height - 12)
  if (rect.right + GAP + CARD_W < vw) return { left: rect.right + GAP + PAD, top: clampY(rect.top) }
  if (rect.bottom + GAP + height < vh) return { left: clampX(rect.left), top: rect.bottom + GAP + PAD }
  if (rect.left - GAP - CARD_W > 0) return { left: rect.left - GAP - CARD_W - PAD, top: clampY(rect.top) }
  return { left: clampX(rect.left), top: clampY(rect.top - height - GAP - PAD) }
}

/**
 * A few spotlight tips over the real UI. The rest of the window dims, the
 * target shows through a cutout, and the card sits beside it. Clicking the
 * highlighted control works and moves on; Escape or Skip ends it. A target
 * that never appears is skipped rather than blocking the tour.
 */
export default function CoachTour({ steps, onDone }: { steps: CoachStep[]; onDone: () => void }): React.ReactElement | null {
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const [cardHeight, setCardHeight] = useState(140)
  const step = steps[index]
  const last = index === steps.length - 1

  const next = (): void => (last ? onDone() : setIndex((i) => i + 1))

  // Follow the target every frame (layouts settle, rails resize); give up on a
  // missing target after a moment and move to the next tip.
  useEffect(() => {
    if (!step) return
    let frame = 0
    const started = performance.now()
    const tick = (): void => {
      const found = findVisible(step.target)
      if (found) {
        setRect((prev) => (prev && prev.x === found.x && prev.y === found.y && prev.width === found.width && prev.height === found.height ? prev : found))
      } else if (performance.now() - started > 1500) {
        if (last) onDone(); else setIndex((i) => i + 1)
        return
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [step, last, onDone])

  // Clicking the highlighted control does its job and advances the tour.
  useEffect(() => {
    if (!step) return
    const onClick = (event: MouseEvent): void => {
      const target = event.target as Element | null
      if (target?.closest(step.target) && !cardRef.current?.contains(target)) next()
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  })

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); onDone() }
      else if (event.key === 'ArrowRight' || event.key === 'Enter') { event.preventDefault(); next() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  useEffect(() => {
    if (cardRef.current) setCardHeight(cardRef.current.offsetHeight)
  }, [index, rect])

  if (!step || !rect) return null
  const spot = { left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }
  const card = placeCard(rect, cardHeight)

  return (
    <div className="coach-root" role="dialog" aria-modal="false" aria-labelledby="coach-title">
      <div className="coach-spot" style={spot} aria-hidden="true" />
      <div ref={cardRef} key={index} className="coach-card" style={{ left: card.left, top: card.top, width: CARD_W }}>
        {steps.length > 1 && <p className="text-[11px] font-medium tabular-nums text-slate-500">{index + 1} of {steps.length}</p>}
        <h3 id="coach-title" className="mt-1 text-[15px] font-semibold text-white">{step.title}</h3>
        <p className="mt-1 text-[13px] leading-snug text-slate-400">{step.body}</p>
        <div className="mt-4 flex items-center justify-between">
          {steps.length > 1 && !last
            ? <button type="button" className="text-[12px] text-slate-500 transition-colors hover:text-white" onClick={onDone}>Skip</button>
            : <span />}
          <button type="button" className="btn-primary px-4 py-1 text-[12px]" onClick={next} autoFocus>{last ? 'Got it' : 'Next'}</button>
        </div>
      </div>
    </div>
  )
}
