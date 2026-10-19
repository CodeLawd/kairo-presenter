import { BookOpen, Clock, Layers, MessageSquare, Music2, Search, Video } from '@/icons'
import { LivePanel, MessagesPanel, ProgramSoundSection, PropsPanel, TimersPanel } from '@/components/operator/ProgramPanels'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useBoothToolboxStore, type BoothToolboxTab } from '@/stores/useBoothToolboxStore'
import { TracksPanel } from '@/components/tracks/TracksPanel'
import { OperatorQueueSearch } from '@/components/operator/OperatorQueueSearch'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'
import { useAppStore } from '@/stores/useAppStore'
import type { ScriptureResult, ScriptureSuggestion } from '@shared/ipc'

const TABS: Array<{ id: BoothToolboxTab; label: string; icon: typeof Search }> = [
  { id: 'search', label: 'Scripture', icon: BookOpen },
  { id: 'audio', label: 'Audio', icon: Music2 },
  { id: 'timers', label: 'Timers', icon: Clock },
  { id: 'messages', label: 'Messages', icon: MessageSquare },
  // 'show' kept as the id so a remembered tab still lands on props.
  { id: 'show', label: 'Props', icon: Layers },
  { id: 'live', label: 'Camera', icon: Video },
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
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-rail">
      {/* As ProPresenter draws it: one bar of equal cells across the panel,
          split by thin lines, the open tool filled blue. */}
      <div className="hairline-b shrink-0">
        <div
          className="flex items-stretch divide-x divide-surface-rail bg-surface-tertiary"
          role="tablist"
          aria-label="Presentation tools"
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
                  'flex h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60',
                  // Picked is filled with the blue accent, as on every other picked tab.
                  selected
                    ? 'bg-teal-500 text-on-accent'
                    : 'text-zinc-400 hover:bg-surface-elevated hover:text-white',
                )}
              >
                <Icon size={14} aria-hidden="true" />
                <span className="max-w-full truncate px-0.5">{label}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden bg-transparent" role="tabpanel">
        {active === 'search' && (search ?? <DefaultBoothSearch />)}
        {active === 'audio' && (
          <div className="h-full overflow-y-auto">
            <TracksPanel />
            <ProgramSoundSection />
          </div>
        )}
        {active === 'timers' && <TimersPanel />}
        {active === 'messages' && <MessagesPanel />}
        {active === 'show' && <PropsPanel />}
        {active === 'live' && <LivePanel />}
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
      <div className="px-3 pb-2.5 pt-3">
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
        Type a reference or phrase. Enter puts it on screen.
      </p>
    </div>
  )
}
