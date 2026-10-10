import type { ReactNode } from 'react'
import { Popover } from 'radix-ui'
import { ChevronDown, ChevronRight, SlidersHorizontal } from '@/icons'
import { SegmentedControl } from '@/components/shared/SegmentedControl'
import { BAR_BUTTON } from './ScriptureSearchBar'
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
        className={BAR_BUTTON}
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
          className="z-50 w-72 space-y-4 rounded-lg bg-surface-tertiary p-3 text-zinc-200 animate-spring-in"
        >
          <Section title="Slides">
            <div className="-mx-1.5">
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
            </div>
          </Section>

          <Section title="Clear automatically">
            <SegmentedControl
              label="Clear automatically"
              value={String(overlay.autoClearSec)}
              options={AUTO_CLEAR.map((option) => ({ value: String(option.value), label: option.label }))}
              onChange={(value) => saveOverlay({ autoClearSec: Number(value) })}
              className="bg-surface-secondary"
            />
          </Section>

          <Section
            title="Bible"
            action={
              <Popover.Close
                className="flex items-center gap-0.5 text-[11px] text-slate-400 transition-colors hover:text-white"
                onClick={() => useAppStore.getState().openSettings('scripture')}
              >
                Get more
                <ChevronRight size={11} aria-hidden="true" />
              </Popover.Close>
            }
          >
            <div className="relative">
              <select
                className="h-8 w-full appearance-none rounded-md bg-surface-secondary pl-2.5 pr-8 text-[13px] text-zinc-100 outline-none transition-colors hover:bg-surface-elevated focus-visible:ring-2 focus-visible:ring-teal-500"
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
              <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
            </div>
          </Section>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }): React.ReactElement {
  return (
    <section className="space-y-1.5">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-medium text-slate-500">{title}</h3>
        {action}
      </div>
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
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md px-1.5 py-1.5 text-[13px] text-zinc-100 transition-colors hover:bg-surface-elevated">
      {label}
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        aria-label={label}
        size="sm"
        // Off reads as a track on this panel, not a lone dot.
        className="data-[state=unchecked]:bg-slate-600"
      />
    </label>
  )
}
