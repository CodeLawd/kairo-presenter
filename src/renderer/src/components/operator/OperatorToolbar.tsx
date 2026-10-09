import { Fragment, useEffect } from 'react'
import { Keyboard } from '@/icons'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'

const SHORTCUT_LEGEND: Array<[string, string]> = [
  ['Space', 'Send focused verse'],
  ['Esc', 'Dismiss'],
  ['Backspace', 'Clear text'],
  ['Ctrl+F', 'Search'],
  ['Ctrl+A', 'Toggle automation'],
]

/** Sermon plans are named after the imported file, so titles arrive snake_cased. */
export function displayPlanTitle(title: string): string {
  return title.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * The Operator's slot in the title bar: just the shortcut legend. Automation
 * lives on the Detected heading; the reference playlist is chosen on the
 * Scripture tab ("Use for this service"). The live-plan subscription stays
 * here so that choice is reflected wherever the Operator reads it.
 */
export default function OperatorToolbar(): React.ReactElement {
  const setLivePlan = useBootstrapStore((s) => s.setLivePlan)
  useEffect(() => window.api.scripture.onLivePlanChange(setLivePlan), [setLivePlan])

  return (
    <div className="operator-toolbar flex h-7 min-w-0 items-center gap-2">

      <div className="group relative shrink-0">
        <button
          type="button"
          className="flex size-7 items-center justify-center rounded text-zinc-600 transition-colors hover:bg-surface-elevated hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
          aria-label="Keyboard shortcuts"
        >
          <Keyboard size={14} />
        </button>
        <div className="pointer-events-none absolute left-0 top-full z-30 mt-1 hidden w-max rounded-lg bg-surface p-2.5 shadow-xl group-hover:block group-focus-within:block">
          <dl className="grid grid-cols-[auto_auto] items-center gap-x-3 gap-y-1.5 text-[10px]">
            {SHORTCUT_LEGEND.map(([keys, action]) => (
              <Fragment key={keys}>
                <dt className="justify-self-end">
                  <kbd className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-slate-400">
                    {keys}
                  </kbd>
                </dt>
                <dd className="text-slate-500">{action}</dd>
              </Fragment>
            ))}
          </dl>
        </div>
      </div>
    </div>
  )
}
