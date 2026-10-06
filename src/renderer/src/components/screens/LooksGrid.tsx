import { cn } from '@/lib/utils'
import type { OverlayOutput } from '@shared/ipc'
import { outputShowLabel, type OutputShowFilter } from '@shared/program'
import { LOOK_GROUPS, lookKeyApplies } from './RenderedOutputFields'

/**
 * Every rendered output against every layer, like ProPresenter's Looks: one
 * column per screen or feed, one row per thing that can be on it.
 */
export function LooksGrid({
  outputs,
  onToggle,
  onSelect,
}: {
  outputs: OverlayOutput[]
  onToggle: (id: string, key: keyof OutputShowFilter, on: boolean) => void
  onSelect: (id: string) => void
}): React.ReactElement {
  if (outputs.length === 0) {
    return <p className="text-[12px] text-slate-500">Add a screen or NDI feed first.</p>
  }
  return (
    <div className="overflow-x-auto rounded-lg bg-surface-secondary p-1">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr>
            <th className="w-40 px-3 py-2" />
            {outputs.map((o) => (
              <th key={o.id} className="px-2 py-2 text-center font-medium">
                <button
                  type="button"
                  className={cn('max-w-[120px] truncate hover:text-white', o.enabled ? 'text-slate-200' : 'text-slate-500')}
                  onClick={() => onSelect(o.id)}
                  title={o.name}
                >
                  {o.name}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {LOOK_GROUPS.map((group) => (
            <LookGroupRows key={group.title} title={group.title} keys={group.keys} outputs={outputs} onToggle={onToggle} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function LookGroupRows({
  title,
  keys,
  outputs,
  onToggle,
}: {
  title: string
  keys: Array<keyof OutputShowFilter>
  outputs: OverlayOutput[]
  onToggle: (id: string, key: keyof OutputShowFilter, on: boolean) => void
}): React.ReactElement {
  return (
    <>
      <tr>
        <td colSpan={outputs.length + 1} className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
          {title}
        </td>
      </tr>
      {keys.map((key) => (
        <tr key={key} className="hover:bg-surface-tertiary">
          <td className="rounded-l-md px-3 py-1.5 text-slate-300">{outputShowLabel(key)}</td>
          {outputs.map((o) => (
            <td key={o.id} className="px-2 py-1.5 text-center">
              {lookKeyApplies(o, key) ? (
                <input
                  type="checkbox"
                  className="accent-teal-500"
                  checked={o.show[key]}
                  aria-label={`${outputShowLabel(key)} on ${o.name}`}
                  onChange={(e) => onToggle(o.id, key, e.target.checked)}
                />
              ) : (
                <span className="text-slate-600" title="Plays its own playlist">–</span>
              )}
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}
