import { Clock, MessageSquare, Music2, Search } from '@/icons'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useBoothToolboxStore, type BoothToolboxTab } from '@/stores/useBoothToolboxStore'
import { TracksPanel } from '@/components/tracks/TracksPanel'
import { OperatorQueueSearch } from '@/components/operator/OperatorQueueSearch'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'
import { useAppStore } from '@/stores/useAppStore'
import type { ScriptureResult, ScriptureSuggestion } from '@shared/ipc'

const TABS: Array<{ id: BoothToolboxTab; label: string; icon: typeof Search }> = [
  { id: 'search', label: 'Search', icon: Search },
  { id: 'audio', label: 'Audio', icon: Music2 },
  { id: 'timers', label: 'Timers', icon: Clock },
  { id: 'messages', label: 'Messages', icon: MessageSquare },
]

export function BoothToolbox({
  search,
}: {
  /** Operator scripture lookup + queue. Other screens get a direct-send search. */
  search?: ReactNode
}): React.ReactElement {
  const tab = useBoothToolboxStore((state) => state.tab)
  const setTab = useBoothToolboxStore((state) => state.setTab)
  const active = TABS.some((item) => item.id === tab) ? tab : 'search'

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-secondary">
      <div
        className="flex shrink-0 items-stretch bg-surface-tertiary/40"
        role="tablist"
        aria-label="Booth tools"
      >
        {TABS.map(({ id, label, icon: Icon }) => {
          const selected = id === active
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={selected}
              title={label}
              onClick={() => setTab(id)}
              className={cn(
                'relative flex h-9 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium last:border-r-0',
                selected
                  ? 'text-teal-400'
                  : 'text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-300',
              )}
            >
              <Icon size={14} aria-hidden="true" />
              <span>{label}</span>
              {selected && (
                <span
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-teal-500"
                  aria-hidden="true"
                />
              )}
            </button>
          )
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden bg-transparent" role="tabpanel">
        {active === 'search' && (search ?? <DefaultBoothSearch />)}
        {active === 'audio' && <TracksPanel />}
        {active === 'timers' && (
          <ComingSoon title="Timers" body="Countdowns will live here — same place as ProPresenter, after house audio." />
        )}
        {active === 'messages' && (
          <ComingSoon title="Messages" body="Quick booth messages will land here. Theme still owns the output style." />
        )}
      </div>
    </div>
  )
}

function suggestionFromResult(result: ScriptureResult): ScriptureSuggestion {
  return {
    id: `manual-${result.reference}-${Date.now()}`,
    reference: result.reference,
    verses: result.verses,
    translation: result.translation,
    confidence: 1,
    source: 'manual',
    triggerText: result.reference,
  }
}

function DefaultBoothSearch(): React.ReactElement {
  const translation = useBootstrapStore((state) => state.settings.scripture.defaultTranslation)

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      <div className="flex shrink-0 items-center px-3 py-1.5">
        <p className="text-[11px] font-medium text-zinc-400">Search</p>
      </div>
      <div className="px-3 py-2.5">
        <OperatorQueueSearch
          translation={translation}
          onEnqueue={(results) => {
            const first = results[0]
            if (!first) return
            const suggestion = suggestionFromResult(first)
            void window.api.scripture.presentDirectly(suggestion).then(() => {
              useAppStore.getState().setLiveOutputPreview({
                kind: 'scripture',
                reference: first.reference,
                text: first.verses.map((verse) => verse.text).join(' '),
              })
              useAppStore.getState().markLiveOutput(first.reference)
            })
          }}
        />
      </div>
      <p className="px-4 text-[10px] leading-relaxed text-zinc-600">
        Type a reference or phrase. Enter sends it to ProPresenter.
      </p>
    </div>
  )
}

function ComingSoon({ title, body }: { title: string; body: string }): React.ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center px-5 text-center">
      <p className="text-[11px] font-medium text-zinc-400">{title}</p>
      <p className="mt-1 max-w-[16rem] text-[10px] leading-relaxed text-zinc-600">{body}</p>
    </div>
  )
}
