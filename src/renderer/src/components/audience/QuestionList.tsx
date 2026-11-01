import { QuestionReplies } from './QuestionReplies'
import { useEffect, useState } from 'react'
import { sortAudienceQuestions, type AudienceQuestionState, type AudienceState } from '@shared/audience'
import { ArrowUp, Check, Eye, EyeOff, MonitorPlay, RotateCcw, X } from '@/icons'
import { SegmentedControl } from '@/components/shared/SegmentedControl'
import { cn } from '@/lib/utils'

type QuestionTab = 'approved' | 'answered' | 'hidden'

const TABS: Array<{ value: QuestionTab; label: string }> = [
  { value: 'approved', label: 'Open' },
  { value: 'answered', label: 'Answered' },
  { value: 'hidden', label: 'Hidden' },
]

const EMPTY_COPY: Record<QuestionTab, { title: string; body: string }> = {
  approved: { title: 'No open questions', body: 'Questions from the room appear here ready to show on screen.' },
  answered: { title: 'Nothing answered yet', body: 'Mark a question answered and it moves here.' },
  hidden: { title: 'Nothing hidden', body: 'Hidden questions stay out of view.' },
}

const ICON_BUTTON =
  'grid size-7 place-items-center rounded-md text-zinc-400 transition-colors hover:bg-surface-elevated hover:text-white disabled:pointer-events-none disabled:opacity-40'

function matchesTab(state: AudienceQuestionState, tab: QuestionTab): boolean {
  if (tab === 'approved') return state === 'approved' || state === 'review'
  return state === tab
}

/** "now", "4m", "2h", "3d" — enough to tell fresh questions from old ones. */
function age(createdAt: number, now: number): string {
  const minutes = Math.floor((now - createdAt) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}

/** Re-renders once a minute so ages stay current. */
function useNow(): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

export function QuestionList({
  state,
  sourceId = null,
  loading = false,
  busy,
  act,
}: {
  state: AudienceState
  sourceId?: string | null
  loading?: boolean
  busy: boolean
  act: (action: () => Promise<AudienceState>) => void
}): React.ReactElement {
  const [tab, setTab] = useState<QuestionTab>('approved')
  const [sort, setSort] = useState<'votes' | 'newest'>('votes')
  const now = useNow()
  const sourceQuestions = sourceId ? state.questions.filter((q) => q.sourceId === sourceId) : state.questions
  const count = (value: QuestionTab): number => sourceQuestions.filter((q) => matchesTab(q.state, value)).length
  const questions = sortAudienceQuestions(sourceQuestions.filter((q) => matchesTab(q.state, tab)), sort)
  const moderate = (id: string, next: AudienceQuestionState): void => act(() => window.api.audience.setQuestionState(id, next))

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="hairline-b flex shrink-0 items-center gap-2 px-4 pb-3">
        <SegmentedControl
          label="Question status"
          role="tablist"
          fit
          className="h-8 bg-surface-secondary p-0.5"
          itemClassName="px-3 text-[12px]"
          selectedClassName="bg-surface-tertiary text-white"
          value={tab}
          onChange={setTab}
          options={TABS.map((t) => ({
            value: t.value,
            label: (
              <span className="flex items-center gap-1.5">
                {t.label}
                {!loading && count(t.value) > 0 && (
                  <span className={cn('min-w-4 rounded-full px-1 text-[10px] tabular-nums', t.value === 'approved' ? 'bg-teal-500 text-on-accent' : 'bg-surface-elevated text-zinc-300')}>{count(t.value)}</span>
                )}
              </span>
            ),
          }))}
        />
        <SegmentedControl
          label="Sort questions"
          fit
          className="ml-auto h-8 bg-surface-secondary p-0.5"
          itemClassName="px-3 text-[12px]"
          selectedClassName="bg-surface-tertiary text-white"
          value={sort}
          onChange={setSort}
          options={[
            { value: 'votes', label: 'Popular' },
            { value: 'newest', label: 'Recent' },
          ]}
        />
      </div>

      {loading ? (
        <div className="mx-auto min-h-0 w-full max-w-3xl flex-1 space-y-2 overflow-y-auto px-4 py-4" role="status" aria-label="Loading questions">
          {[0, 1, 2].map((index) => (
            <div key={index} className="animate-pulse rounded-xl bg-surface-secondary p-4">
              <div className="flex items-center gap-3">
                <div className="size-8 shrink-0 rounded-full bg-surface-tertiary" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="h-3.5 w-24 rounded bg-surface-tertiary" />
                  <div className="h-2.5 w-14 rounded bg-surface-tertiary" />
                </div>
                <div className="h-8 w-14 shrink-0 rounded-full bg-surface-tertiary" />
              </div>
              <div className="mt-3.5 h-3.5 w-11/12 rounded bg-surface-tertiary" />
              <div className="mt-2 h-3.5 w-2/3 rounded bg-surface-tertiary" />
              <div className="mt-3 flex justify-end gap-1.5">
                <div className="size-7 rounded-md bg-surface-tertiary" />
                <div className="size-7 rounded-md bg-surface-tertiary" />
                <div className="h-7 w-16 rounded-md bg-surface-tertiary" />
              </div>
            </div>
          ))}
        </div>
      ) : questions.length === 0 ? (
        <div className="grid flex-1 place-items-center px-8 text-center">
          <div className="max-w-xs">
            <p className="text-sm font-medium text-zinc-300">{EMPTY_COPY[tab].title}</p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">{EMPTY_COPY[tab].body}</p>
          </div>
        </div>
      ) : (
        <ul className="mx-auto min-h-0 w-full max-w-3xl flex-1 space-y-2 overflow-y-auto px-4 py-4" aria-label={`${TABS.find((t) => t.value === tab)?.label} questions`}>
          {questions.map((q) => {
            const live = state.liveId === q.id
            return (
              <li key={q.id} className={cn('rounded-xl p-4 transition-colors', live ? 'bg-tint-live ring-1 ring-live/60' : 'bg-surface-secondary')}>
                {/* Who and when first, the question largest, votes in the corner. */}
                <div className="flex items-center gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-tertiary text-[12px] font-semibold text-zinc-300" aria-hidden="true">
                    {(q.author || '?').trim().charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-zinc-100">{q.author || 'Anonymous'}</p>
                    <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                      <span className="tabular-nums">{age(q.createdAt, now)}</span>
                      {live && (
                        <>
                          <span className="text-zinc-600">·</span>
                          <span className="flex items-center gap-1 font-semibold text-live">
                            <span className="size-1.5 rounded-full bg-live" aria-hidden="true" />
                            On screens
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                  <span className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-surface-tertiary px-3 text-[13px] font-medium tabular-nums text-zinc-200" title={`${q.votes} ${q.votes === 1 ? 'vote' : 'votes'}`}>
                    {q.votes}
                    <ArrowUp size={13} className="text-zinc-400" aria-hidden="true" />
                  </span>
                </div>
                <p className="mt-3 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-white">{q.text}</p>
                <div className="mt-3 flex items-end gap-3">
                  <div className="min-w-0 flex-1">
                    <QuestionReplies question={q} state={state} busy={busy} act={act} />
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {q.state === 'review' && (
                      <>
                        <button type="button" className={ICON_BUTTON} disabled={busy} aria-label="Hide question" title="Hide" onClick={() => moderate(q.id, 'hidden')}>
                          <EyeOff size={15} aria-hidden="true" />
                        </button>
                        <button type="button" className={ICON_BUTTON} disabled={busy} aria-label="Mark answered" title="Mark answered" onClick={() => moderate(q.id, 'answered')}>
                          <Check size={15} aria-hidden="true" />
                        </button>
                        <button type="button" className="btn-primary h-7 px-3 py-0 text-xs" disabled={busy} onClick={() => moderate(q.id, 'approved')}>
                          Approve
                        </button>
                      </>
                    )}
                    {q.state === 'approved' && (
                      <>
                        <button type="button" className={ICON_BUTTON} disabled={busy} aria-label="Hide question" title="Hide" onClick={() => moderate(q.id, 'hidden')}>
                          <EyeOff size={15} aria-hidden="true" />
                        </button>
                        <button type="button" className={ICON_BUTTON} disabled={busy} aria-label="Mark answered" title="Mark answered" onClick={() => moderate(q.id, 'answered')}>
                          <Check size={15} aria-hidden="true" />
                        </button>
                        {live ? (
                          <button type="button" className="btn-secondary flex h-7 items-center gap-1.5 px-3 py-0 text-xs" disabled={busy} onClick={() => act(() => window.api.audience.clear())}>
                            <X size={13} aria-hidden="true" />
                            Clear
                          </button>
                        ) : (
                          <button type="button" className="btn-primary flex h-7 items-center gap-1.5 px-3 py-0 text-xs" disabled={busy} onClick={() => act(() => window.api.audience.show(q.id))}>
                            <MonitorPlay size={13} aria-hidden="true" />
                            Show
                          </button>
                        )}
                      </>
                    )}
                    {q.state === 'answered' && (
                      <button type="button" className={ICON_BUTTON} disabled={busy} aria-label="Move back to open" title="Move back to open" onClick={() => moderate(q.id, 'approved')}>
                        <RotateCcw size={15} aria-hidden="true" />
                      </button>
                    )}
                    {q.state === 'hidden' && (
                      <button type="button" className="btn-secondary flex h-7 items-center gap-1.5 px-3 py-0 text-xs" disabled={busy} onClick={() => moderate(q.id, 'approved')}>
                        <Eye size={13} aria-hidden="true" />
                        Restore
                      </button>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
