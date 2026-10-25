import { useMemo, useRef, useState } from 'react'
import { Popover } from 'radix-ui'
import type { NavRoute } from '@/App'
import { Check, Monitor, Palette } from '@/icons'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'
import { SegmentedControl } from '@/components/shared/SegmentedControl'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScaledOverlayPreview } from '@/components/overlay/ScaledOverlayPreview'
import { saveOutputSettings } from '@/lib/output-settings'
import { hueStyle } from '@/lib/hue'
import { cn } from '@/lib/utils'
import { isRenderedKind } from '@shared/overlay-outputs'
import { assignThemeToOutput, outputUsesTheme, themesForKind } from '@shared/theme-library'
import { renderOverlayHTML } from '@shared/overlay-template'
import type { CustomOverlayTheme, OverlayContentKind } from '@shared/ipc'

function ThemeThumbnail({ entry }: { entry: CustomOverlayTheme }): React.ReactElement {
  const html = useMemo(() => renderOverlayHTML(
    entry.theme,
    entry.kind === 'scripture' ? 'John 3:16 (KJV)' : 'Amazing Grace — Verse 1',
    entry.kind === 'scripture'
      ? 'For God so loved the world, that he gave his only begotten Son.'
      : 'Amazing grace, how sweet the sound\nThat saved a wretch like me',
  ), [entry])
  return <ScaledOverlayPreview html={html} autoFit={entry.theme.layout.autoFitText} fill />
}

/** A saved-theme switcher; authoring stays in the Theme Editor. */
export function ThemePicker({ currentRoute }: { currentRoute: NavRoute }): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<OverlayContentKind>('scripture')
  const [saving, setSaving] = useState(false)
  const [screenId, setScreenId] = useState('')
  const busy = useRef(false)
  const [error, setError] = useState('')
  const [applied, setApplied] = useState('')
  const settings = useBootstrapStore((s) => s.settings)
  const entries = themesForKind(settings.themeLibrary ?? [], kind)
  const outputs = settings.overlay.outputs.filter((output) => isRenderedKind(output.kind))

  const screen = outputs.find((output) => output.id === screenId) ?? outputs[0]

  const apply = async (entry: CustomOverlayTheme): Promise<void> => {
    if (busy.current || !screen) return
    const target = screen
    busy.current = true
    setSaving(true)
    setError('')
    setApplied('')
    try {
      await saveOutputSettings((current) => {
        if (!current.some((output) => output.id === target.id && isRenderedKind(output.kind))) {
          throw new Error('Screen is no longer available')
        }
        return current.map((output) =>
          output.id === target.id ? assignThemeToOutput(output, entry) : output,
        )
      })
      setApplied(`${entry.name} applied to ${target.name}`)
    } catch {
      setError('Theme could not be applied. Try again.')
    } finally {
      busy.current = false
      setSaving(false)
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={(next) => {
      setOpen(next)
      if (next) {
        setKind(currentRoute === 'lyrics' ? 'lyrics' : 'scripture')
        setError('')
        setApplied('')
      }
    }}>
      <Popover.Trigger asChild>
        <button type="button" title="Choose themes for your screens" aria-label="Screen Themes" className="header-tool no-drag group flex shrink-0 flex-col items-center gap-1 rounded-md px-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30">
          <span className={cn('grid h-7 w-11 place-items-center rounded-full transition-colors duration-150 group-hover:bg-surface-elevated', open ? 'bg-surface-elevated' : 'bg-surface-tertiary')}>
            <span className="relative" style={hueStyle('pink')} aria-hidden="true">
              <Monitor size={17} className="text-[rgb(var(--hue))]" />
              <Palette size={9} weight="fill" className="absolute -bottom-0.5 -right-1 rounded-full bg-surface-tertiary text-[rgb(var(--hue))]" />
            </span>
          </span>
          <span className="text-[10px] font-medium leading-none text-zinc-400">Screen Themes</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <div className="contents">
        <div className="no-drag fixed inset-0 z-40" aria-hidden="true" onPointerDown={() => setOpen(false)} />
        <Popover.Content side="bottom" align="end" sideOffset={8} collisionPadding={12} aria-label="Screen Themes" className="no-drag z-50 w-[360px] max-w-[calc(100vw-24px)] rounded-xl bg-surface-menu p-3 text-zinc-200 shadow-xl ring-1 ring-surface-menu-line">
          <h2 className="mb-2 text-sm font-semibold">Screen Themes</h2>
          <label className="mb-1 block text-xs text-slate-400" htmlFor="theme-picker-screen">Screen or feed</label>
          <Select value={screen?.id ?? ''} disabled={saving || outputs.length === 0} onValueChange={(value) => { setScreenId(value); setError(''); setApplied('') }}>
            <SelectTrigger id="theme-picker-screen" aria-label="Theme screen" className="mb-3 w-full bg-surface-tertiary"><SelectValue placeholder="No screens configured" /></SelectTrigger>
            <SelectContent position="popper">
              {outputs.map((output) => <SelectItem key={output.id} value={output.id}>{output.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <SegmentedControl value={kind} options={[{ value: 'scripture', label: 'Scripture' }, { value: 'lyrics', label: 'Lyrics' }]} label="Theme content" onChange={(value) => { setKind(value); setError(''); setApplied('') }} />
          <p className="my-2 text-xs text-slate-400">{screen ? `Changes only ${screen.name}’s ${kind === 'scripture' ? 'scripture' : 'lyrics'} theme.` : 'Add a screen or feed in Screens to choose its theme.'}</p>
          <div className="grid max-h-[min(360px,50vh)] grid-cols-2 gap-2 overflow-y-auto p-0.5" aria-busy={saving}>
            {entries.map((entry) => {
              const selected = Boolean(screen && outputUsesTheme(screen, entry))
              return (
                <button key={entry.id} type="button" disabled={saving || !screen} aria-pressed={selected} aria-label={`Apply ${entry.name}`} onClick={() => void apply(entry)} className={cn('overflow-hidden rounded-md border text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-50', selected ? 'border-white' : 'border-surface-border hover:border-slate-400')}>
                  <div className="relative aspect-video overflow-hidden" aria-hidden="true"><ThemeThumbnail entry={entry} /></div>
                  <span className="flex items-center gap-1 bg-surface-tertiary px-2 py-1.5 text-xs"><span className="min-w-0 flex-1 truncate">{entry.name}</span>{selected && <Check size={12} aria-hidden="true" />}</span>
                </button>
              )
            })}
          </div>
          {entries.length === 0 && <p className="py-6 text-center text-xs text-slate-400">No saved {kind === 'scripture' ? 'scripture' : 'lyrics'} themes yet. Create one in the Theme Editor.</p>}
          <p role="status" className="mt-2 text-xs text-slate-400">{saving ? 'Applying theme…' : applied}</p>
          {error && <p role="alert" className="mt-2 text-xs text-red-400">{error}</p>}
        </Popover.Content>
        </div>
      </Popover.Portal>
    </Popover.Root>
  )
}
