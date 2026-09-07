import { useMemo, useState } from 'react';
import { BookOpen, Check, Loader, Play, Search, X } from '@/icons';
import { cn } from '@/lib/utils';

export interface ReferenceLibraryRow {
  id: string;
  reference: string;
  detail?: string;
  live: boolean;
  heard?: boolean;
  fromSermon?: boolean;
  expectedReference?: string;
  busy?: boolean;
  present: () => void;
}

interface ReferenceLibraryProps {
  detected: ReferenceLibraryRow[];
  passages: ReferenceLibraryRow[];
  planTitle?: string;
  listening: boolean;
}

export function ReferenceLibrary({ detected, passages, planTitle, listening }: ReferenceLibraryProps) {
  const [selected, setSelected] = useState<'detected' | 'sermon' | null>(null);
  const [query, setQuery] = useState('');
  // Until the operator chooses, show the list that has useful content.
  const mode = selected ?? (detected.length ? 'detected' : planTitle ? 'sermon' : 'detected');
  const rows = mode === 'detected' ? detected : passages;
  const filtered = useMemo(() => {
    const needle = query.toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, '');
    return rows.map((row, index) => ({ row, index })).filter(({ row }) =>
      row.reference.toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, '').includes(needle),
    );
  }, [rows, query]);

  return (
    <section aria-label="Passage library" className="flex h-full min-h-0 min-w-0 flex-col bg-white/[0.015]">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-white/[0.07] px-3 py-2">
        <div className="flex items-center gap-1" role="group" aria-label="Passage source">
          {([
            ['detected', 'Detected', detected.length],
            ['sermon', 'Sermon passages', passages.length],
          ] as const).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => { setSelected(value); setQuery(''); }}
              className={cn('flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/70',
                mode === value ? 'bg-white/[0.08] text-zinc-100' : 'text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300')}
            >
              {label}
              <span className={cn('text-[10px] tabular-nums', mode === value ? 'text-zinc-400' : 'text-zinc-600')}>{count}</span>
            </button>
          ))}
        </div>
        <div className="relative w-40 min-w-0 flex-1 max-w-56">
          <Search size={13} aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input aria-label="Find a passage" placeholder="Find a passage…" value={query} onChange={(event) => setQuery(event.target.value)}
            className="h-7 w-full rounded-md border border-white/[0.07] bg-black/15 pl-7 pr-7 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-teal-500/50 focus:outline-none focus:ring-1 focus:ring-teal-500/30" />
          {query && <button type="button" aria-label="Clear passage search" onClick={() => setQuery('')} className="absolute right-1 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-zinc-400 hover:text-white focus-visible:outline focus-visible:outline-teal-400"><X size={12} /></button>}
        </div>
      </div>
      <div className="flex h-8 shrink-0 items-center justify-between gap-3 px-4 text-[11px] text-zinc-500">
        <p className="min-w-0 truncate" title={mode === 'sermon' ? planTitle : undefined}>
          {mode === 'sermon' ? planTitle ?? 'No sermon selected' : 'Recent passages · newest first'}
        </p>
        <span className="shrink-0 text-[10px] tabular-nums">{query ? `${filtered.length} of ${rows.length}` : 'Select to present'}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {filtered.length > 0 ? (
          <ul className="space-y-0.5">
            {filtered.map(({ row, index }) => (
              <li key={row.id}>
                <button type="button" disabled={row.busy} onClick={row.present} aria-label={`Present ${row.reference}`} aria-current={row.live ? 'true' : undefined}
                  className={cn('group flex min-h-10 w-full items-center gap-3 rounded-md border px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-400/70 disabled:cursor-wait disabled:opacity-50',
                    row.live ? 'border-teal-500/15 bg-teal-500/[0.08] text-teal-100' : 'border-transparent text-zinc-300 hover:bg-white/[0.045] hover:text-zinc-100')}>
                  <span aria-hidden="true" className="w-5 shrink-0 text-center text-[10px] tabular-nums text-zinc-600">{String(index + 1).padStart(2, '0')}</span>
                  <span className="shrink-0 text-[13px] font-medium tabular-nums">{row.reference}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">{row.detail}</span>
                  {row.fromSermon && <span className="shrink-0 text-[10px] text-teal-400">From sermon</span>}
                  {row.expectedReference && <span className="shrink-0 text-[10px] text-teal-400" title="Expected from sermon order; not automatically presented">Next · {row.expectedReference}</span>}
                  <span className="flex shrink-0 items-center gap-1.5 text-[10px]">
                    {row.busy ? <Loader size={12} className="animate-spin motion-reduce:animate-none" /> : row.live ? <span className="font-medium text-teal-300">Live</span> : row.heard ? <><Check size={12} className="text-teal-500" /><span className="text-zinc-500">Heard</span></> : null}
                    {!row.busy && !row.live && <span className="ml-1 flex items-center gap-1 text-zinc-500 group-hover:text-teal-300 group-focus-visible:text-teal-300"><span className="hidden group-hover:inline group-focus-visible:inline">Present</span><Play size={12} aria-hidden="true" /></span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex min-h-20 h-full items-center justify-center gap-3 px-4 py-3">
            <BookOpen size={21} aria-hidden="true" className="shrink-0 text-zinc-600" />
            <div>
              <p className="text-xs font-medium text-zinc-400">{query ? 'No matching passages' : mode === 'detected' ? listening ? 'Listening for scripture' : 'No detections yet' : planTitle ? 'No passages in this sermon' : 'Choose a sermon to follow'}</p>
              <p className="mt-1 text-[11px] text-zinc-600">{query ? 'Try a book name or reference, such as John 3.' : mode === 'detected' ? 'Detected passages collect here during the service.' : 'Select a sermon from the toolbar above.'}</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
