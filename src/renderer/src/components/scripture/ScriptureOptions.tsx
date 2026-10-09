import type { ReactNode } from 'react'
import { Popover } from 'radix-ui'
import { ChevronRight, SlidersHorizontal } from '@/icons'
import { cn } from '@/lib/utils'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'
import { useAppStore } from '@/stores/useAppStore'
import { Switch } from '@/components/ui/switch'
import type { AppSettings, ScriptureTranslation } from '@shared/ipc'

const AUTO_CLEAR: Array<{ value: number; label: string }> = [
  { value: 0, label: 'Never' },
  { value: 15, label: '15s' },
  { value: 30, label: '30s' },
  { value: 60, label: '1 min' },
]

/**
 * The few choices that change how scripture goes out, one short panel read top
 * to bottom: what a slide shows, when it clears, which Bible. Everything saves
 * as it changes. Downloads and detection live in Settings, one link away.
 */
export function ScriptureOptions(): React.ReactElement {
  const settings = useBootstrapStore((s) => s.settings)
  const translations = useBootstrapStore((s) => s.translations)
  const patchSettings = useBootstrapStore((s) => s.patchSettings)
  const { overlay, scripture } = settings

  const saveOverlay = (patch: Partial<AppSettings['overlay']>): void => {
    const next = { ...overlay, ...patch }
    patchSettings('overlay', next)
    void window.api.settings.set('overlay', next)
  }
  const saveScripture = (patch: Partial<AppSettings['scripture']>): void => {
    const next = { ...scripture, ...patch }
    patchSettings('scripture', next)
    void window.api.settings.set('scripture', next)
  }

  const ready = translations.filter((t) => t.available)

  return (
    <Popover.Root>
      <Popover.Trigger
        className="flex h-8 shrink-0 items-center gap-2 rounded-md border border-input bg-surface-secondary px-3 text-[13px] font-medium text-slate-200 transition-colors hover:bg-surface-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 data-[state=open]:bg-surface-tertiary"
        aria-label="Scripture options"
      >
        <SlidersHorizontal size={14} aria-hidden="true" />
        Options
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 w-72 overflow-hidden rounded-xl border border-zinc-700 bg-surface-elevated p-1.5 text-zinc-200 animate-spring-in"
        >
          <Section title="Slides">
            <ToggleRow
              label="Verse numbers"
              checked={overlay.showVerseNumbers}
              onChange={(on) => {
                // Two settings carry this; keep them in step.
                saveOverlay({ showVerseNumbers: on })
                saveScripture({ showVerseNumbers: on })
              }}
            />
            <ToggleRow
              label="Translation after reference"
              checked={overlay.showTranslation}
              onChange={(on) => saveOverlay({ showTranslation: on })}
            />
            <ToggleRow
              label="One verse per slide"
              checked={overlay.maxVerses === 1}
              onChange={(on) => saveOverlay({ maxVerses: on ? 1 : 0 })}
            />
          </Section>

          <Section title="Clear automatically">
            <div className="grid grid-cols-4 gap-1 px-2 pb-1.5" role="radiogroup" aria-label="Clear automatically">
              {AUTO_CLEAR.map((option) => {
                const on = overlay.autoClearSec === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => saveOverlay({ autoClearSec: option.value })}
                    className={cn(
                      'rounded-md border py-1 text-[12px] font-medium transition-colors',
                      on ? 'border-zinc-500 bg-surface-border text-white' : 'border-zinc-700 text-zinc-400 hover:text-zinc-200',
                    )}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
          </Section>

          <Section title="Bible" last>
            <div className="px-2 pb-1.5">
              <select
                className="input h-8 w-full py-0 text-[12px]"
                value={scripture.defaultTranslation}
                onChange={(e) => saveScripture({ defaultTranslation: e.target.value as ScriptureTranslation })}
                aria-label="Default Bible"
              >
                {!ready.some((t) => t.id === scripture.defaultTranslation) && (
                  <option value={scripture.defaultTranslation} disabled>
                    {scripture.defaultTranslation} (not installed)
                  </option>
                )}
                {ready.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <Popover.Close
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[12px] text-zinc-400 transition-colors hover:bg-surface-tertiary hover:text-zinc-200"
              onClick={() => useAppStore.getState().openSettings('scripture')}
            >
              Get more Bibles
              <ChevronRight size={12} aria-hidden="true" />
            </Popover.Close>
          </Section>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function Section({ title, last = false, children }: { title: string; last?: boolean; children: ReactNode }): React.ReactElement {
  return (
    <section className={cn('py-1.5', !last && 'border-b border-zinc-700')}>
      <h3 className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">{title}</h3>
      {children}
    </section>
  )
}

function ToggleRow({ label, checked, onChange }: {
  label: string
  checked: boolean
  onChange: (on: boolean) => void
}): React.ReactElement {
  // The whole row toggles — a bigger target than the switch alone.
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-1.5 text-[13px] text-zinc-100 transition-colors hover:bg-surface-tertiary">
      {label}
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </label>
  )
}
