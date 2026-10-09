import { useState } from 'react'
import { SHORTCUT_COMMANDS, bindingsFor, commandForShortcut, shortcutFromEvent, shortcutLabel, type ShortcutBindings, type ShortcutCommand } from '@shared/keyboard-shortcuts'

export default function KeyboardShortcutsSection({ bindings, onSave }: {
  bindings: ShortcutBindings
  onSave: (bindings: ShortcutBindings) => Promise<void>
}): React.ReactElement {
  const [draft, setDraft] = useState(bindings)
  const [recording, setRecording] = useState<ShortcutCommand | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const change = (next: ShortcutBindings) => { setDraft(next); setSaved(false); setError('') }
  return <div className="space-y-5">
    <p className="text-[13px] leading-relaxed text-white/55">Shortcuts work while Kairo is focused. Click a binding and press a key combination. Live commands pause while typing or using a dialog.</p>
    {['Navigation', 'Live commands'].map(group => <section key={group} className="space-y-2">
      <h3 className="text-xs font-semibold text-white/60">{group}</h3>
      <div className="rounded-xl bg-surface-tertiary">
        {SHORTCUT_COMMANDS.filter(command => command.group === group).map(command => <div key={command.id} className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="text-[13px] text-white/90">{command.label}</span>
          <div className="flex items-center gap-2">
            <button type="button" aria-label={`Set shortcut for ${command.label}`} onClick={() => { setRecording(command.id); setError('') }}
              onBlur={() => setRecording(null)}
              onKeyDown={event => {
                if (recording !== command.id) return
                event.preventDefault(); event.stopPropagation()
                if (event.key === 'Escape') { setRecording(null); return }
                const shortcut = shortcutFromEvent(event)
                if (!shortcut) return
                const conflict = commandForShortcut(shortcut, { ...draft, [command.id]: [] })
                if (conflict) { setError(`Already assigned to ${SHORTCUT_COMMANDS.find(item => item.id === conflict)!.label}. Clear that binding first.`); return }
                change({ ...draft, [command.id]: [shortcut] }); setRecording(null)
              }}
              className="min-w-[130px] rounded-md border border-transparent bg-surface-tertiary px-3 py-1.5 text-xs text-white/80 hover:border-teal-400/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-400">
              {recording === command.id ? 'Press keys… Esc cancels' : bindingsFor(command.id, draft).map(shortcutLabel).join(' or ') || 'Not assigned'}
            </button>
            <button type="button" aria-label={`Clear shortcut for ${command.label}`} onClick={() => change({ ...draft, [command.id]: [] })} className="text-xs text-white/45 hover:text-white">Clear</button>
          </div>
        </div>)}
      </div>
    </section>)}
    {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
    <div className="flex items-center justify-between">
      <button type="button" onClick={() => { change({}); setRecording(null) }} className="text-xs text-white/55 hover:text-white">Restore defaults</button>
      <button type="button" disabled={saving || recording !== null} className="btn-primary" onClick={async () => {
        setSaving(true); setError('')
        try { await onSave(draft); setSaved(true) } catch { setError('Could not save shortcuts. Please try again.') } finally { setSaving(false) }
      }}>{saving ? 'Saving…' : saved ? 'Saved' : 'Save shortcuts'}</button>
    </div>
  </div>
}
