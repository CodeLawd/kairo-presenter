import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from '@/icons'
import { matchTimezones } from '@shared/cloud/timezone-search'

/**
 * Searchable timezone picker.
 *
 * A native `<select>` over ~420 IANA zones makes the operator scroll for their
 * own city, so this is a combobox: click opens a filtered list, typing narrows
 * it, arrows and Enter commit without touching the mouse.
 *
 * The trigger shows the current zone and its live offset — the offset is what
 * an operator actually recognises, and it doubles as a sanity check that the
 * zone they picked is the one they meant.
 */
export default function TimezoneSelect({
  id,
  value,
  zones,
  detected,
  onChange,
}: {
  id: string
  value: string
  zones: readonly string[]
  detected: string
  onChange: (zone: string) => void
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const results = useMemo(() => matchTimezones(zones, query), [zones, query])

  // Re-anchor the highlight whenever the result set changes under it.
  useEffect(() => setActive(0), [query])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) close()
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  // Keep the highlighted row in view during keyboard navigation.
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const close = (): void => {
    setOpen(false)
    setQuery('')
  }

  const commit = (zone: string): void => {
    onChange(zone)
    close()
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation() // Escape closes the list, not the whole wizard.
      close()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const delta = event.key === 'ArrowDown' ? 1 : -1
      setActive((index) => clamp(index + delta, results.length))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const zone = results[active]
      if (zone) commit(zone)
    }
  }

  return (
    <div ref={rootRef} className="relative">
      {open ? (
        <div className="relative">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
            aria-hidden="true"
          />
          <input
            id={id}
            className="input pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search city or region…"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-listbox`}
            aria-activedescendant={`${id}-option-${active}`}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
        </div>
      ) : (
        <button
          id={id}
          type="button"
          className="input flex items-center justify-between gap-2 text-left"
          onClick={() => setOpen(true)}
          aria-haspopup="listbox"
          aria-expanded="false"
        >
          <span className="truncate font-mono">{value || 'Select a timezone'}</span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="text-[11px] font-normal text-slate-500">{offsetLabel(value)}</span>
            <ChevronDown size={14} className="text-slate-500" aria-hidden="true" />
          </span>
        </button>
      )}

      {open && (
        <ul
          ref={listRef}
          id={`${id}-listbox`}
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-50 max-h-60 overflow-y-auto rounded-lg bg-surface-elevated py-1 shadow-2xl"
        >
          {results.length === 0 ? (
            <li className="px-3 py-2 text-[12px] text-slate-500">No timezone matches that.</li>
          ) : (
            results.map((zone, index) => (
              <li key={zone}>
                <button
                  type="button"
                  id={`${id}-option-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={zone === value}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors ${
                    index === active ? 'row-selected' : 'text-slate-300'
                  }`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => commit(zone)}
                >
                  <span className="w-3.5 shrink-0 text-teal-400" aria-hidden="true">
                    {zone === value && <Check size={12} strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono">{zone}</span>
                  {zone === detected && (
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-500">
                      detected
                    </span>
                  )}
                  <span className="shrink-0 tabular-nums text-slate-500">{offsetLabel(zone)}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}

function clamp(index: number, length: number): number {
  if (length === 0) return 0
  if (index < 0) return length - 1
  if (index >= length) return 0
  return index
}

/** `GMT+1` for a zone, or '' when the runtime cannot resolve it. */
function offsetLabel(zone: string): string {
  if (!zone) return ''
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date())
    return parts.find((part) => part.type === 'timeZoneName')?.value ?? ''
  } catch {
    return ''
  }
}
