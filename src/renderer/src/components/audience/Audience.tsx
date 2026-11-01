import { useEffect, useState } from 'react'
import { cleanIpcError } from '@shared/ipc-error'
import type { AudienceState } from '@shared/audience'
import { useSidebarWidth } from '@/components/layout/useSidebarWidth'
import { BoothWorkspace } from '@/components/layout/BoothWorkspace'
import { LiveOutputRail } from '@/components/operator/LiveOutputRail'
import { SegmentedControl } from '@/components/shared/SegmentedControl'
import { useLiveRailWidth } from '@/components/operator/useLiveRailWidth'
import { AudienceSidebar } from './AudienceSidebar'
import { Polls } from './Polls'
import { QuestionList } from './QuestionList'

const EMPTY: AudienceState = { sampleAvailable: false, questions: [], sources: [], session: null, liveId: null }

/**
 * Engage, laid out like Web and Documents: engagements and sources in the page
 * sidebar, the open activity (Q&A or Polls) in the middle, the live rail on the right.
 */
export default function Audience(): React.ReactElement {
  const [state, setState] = useState(EMPTY)
  const [initialLoading, setInitialLoading] = useState(true)
  const [activity, setActivity] = useState<'qa' | 'polls'>('qa')
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const sidebar = useSidebarWidth()
  const liveRail = useLiveRailWidth()

  useEffect(() => {
    let alive = true
    let updated = false
    const unsubscribe = window.api.audience.onChanged((next) => {
      updated = true
      if (alive) {
        setState(next)
        setInitialLoading(false)
      }
    })
    void window.api.audience
      .getState()
      .then((next) => {
        if (alive && !updated) setState(next)
      })
      .catch((e) => {
        if (alive) setError(cleanIpcError(e))
      })
      .finally(() => {
        if (alive) setInitialLoading(false)
      })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  /** Runs an action; a form that shows its own errors passes `onError`. */
  const act = (action: () => Promise<AudienceState>, onError: (message: string) => void = setError): void => {
    setBusy(true)
    setError('')
    void action()
      .then(setState)
      .catch((e) => onError(cleanIpcError(e)))
      .finally(() => setBusy(false))
  }

  const runningSources = state.sources.filter((s) => s.state !== 'stopped')
  const activeSourceId =
    selectedSourceId && runningSources.some((s) => s.id === selectedSourceId)
      ? selectedSourceId
      : runningSources[runningSources.length - 1]?.id ?? null
  const activeSource = runningSources.find((s) => s.id === activeSourceId)
  const activeQuestionsCount = activeSourceId
    ? state.questions.filter((q) => q.sourceId === activeSourceId).length
    : state.questions.length
  const loadingQueue = initialLoading || (activeSource?.state === 'connecting' && activeQuestionsCount === 0)
  const loadingPolls = initialLoading || (state.sources.some((s) => s.id === 'kairo' && s.state === 'connecting') && !state.engage)
  const pollsAvailable = !activeSourceId || activeSourceId === 'kairo'
  const effectiveActivity = pollsAvailable ? activity : 'qa'

  return (
    <BoothWorkspace
      rail={<LiveOutputRail width={liveRail.width} onResizeStart={liveRail.onResizeStart} onResizeKeyDown={liveRail.onResizeKeyDown} />}
    >
      <section className="page-with-sidebar flex h-full min-h-0 w-full flex-col bg-surface" aria-label="Engage">
        <div ref={sidebar.containerRef} className="page-with-sidebar flex min-h-0 flex-1">
          <aside className="page-sidebar hairline-r flex min-h-0 shrink-0 flex-col bg-surface-secondary" style={{ width: sidebar.width }} aria-label="Session and sources">
            <AudienceSidebar
              state={state}
              activeSourceId={activeSourceId}
              busy={busy}
              act={act}
              onState={setState}
              onSelectSource={setSelectedSourceId}
            />
          </aside>
          <button
            type="button"
            {...sidebar.separatorProps}
            aria-label="Resize sidebar"
            title="Drag to resize · double-click to reset"
            className="page-sidebar-handle z-10 w-1.5 shrink-0 cursor-col-resize bg-surface-secondary hover:bg-surface-elevated focus-visible:bg-surface-elevated focus-visible:outline-none"
          />
          <div className="flex min-w-0 flex-1 flex-col">
            {error && (
              <p role="alert" className="mx-4 mt-3 shrink-0 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error}
              </p>
            )}
            <div className="flex shrink-0 items-center justify-center px-4 pb-2 pt-3">
              <SegmentedControl
                label="Activity"
                role="tablist"
                fit
                className="h-9 bg-surface-secondary p-1"
                itemClassName="px-5 text-[13px]"
                selectedClassName="bg-surface-elevated text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]"
                value={effectiveActivity}
                onChange={setActivity}
                options={
                  pollsAvailable
                    ? [
                        { value: 'qa', label: 'Q&A' },
                        { value: 'polls', label: 'Polls' },
                      ]
                    : [{ value: 'qa', label: 'Q&A' }]
                }
              />
            </div>
            {effectiveActivity === 'qa' ? (
              <QuestionList state={state} sourceId={activeSourceId} loading={loadingQueue} busy={busy} act={act} />
            ) : (
              <Polls state={state} loading={loadingPolls} busy={busy} act={act} />
            )}
          </div>
        </div>
      </section>
    </BoothWorkspace>
  )
}
