import type { AudienceRoomSettings } from '@shared/audience-protocol'
import { Switch } from '@/components/ui/switch'

/** "Open to everyone · People can vote · Names optional" */
export function settingsSummary(settings: AudienceRoomSettings): string {
  return [
    settings.review ? 'You approve questions' : 'Open to everyone',
    settings.showQuestions ? 'People can vote' : 'People only ask',
    settings.names === 'optional' ? 'Names optional' : 'Anonymous',
  ].join(' · ') + '.'
}

/** The three choices that shape a Kairo Q&A. Used before starting and while it runs. */
export function RoomSettings({
  settings,
  disabled,
  onChange,
}: {
  settings: AudienceRoomSettings
  disabled?: boolean
  onChange: (settings: AudienceRoomSettings) => void
}): React.ReactElement {
  const rows: Array<{ key: string; label: string; hint: string; checked: boolean; set: (on: boolean) => AudienceRoomSettings }> = [
    {
      key: 'review',
      label: 'Approve questions first',
      hint: settings.review ? 'You see them before anyone else.' : 'Questions appear for everyone right away.',
      checked: settings.review,
      set: (on) => ({ ...settings, review: on }),
    },
    {
      key: 'list',
      label: 'Show questions to everyone',
      hint: settings.showQuestions ? 'People can read and vote.' : 'People can only ask.',
      checked: settings.showQuestions,
      set: (on) => ({ ...settings, showQuestions: on }),
    },
    {
      key: 'names',
      label: 'Ask for names',
      hint: settings.names === 'optional' ? 'Optional. Anonymous is fine.' : 'Every question is anonymous.',
      checked: settings.names === 'optional',
      set: (on) => ({ ...settings, names: on ? 'optional' : 'off' }),
    },
  ]
  return (
    <div className="pref-group pref-group-dim mt-3 rounded-lg bg-surface-secondary">
      {rows.map((row) => (
        <label key={row.key} className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2">
          <span className="min-w-0">
            <span className="block text-[12px] text-zinc-200">{row.label}</span>
            <span className="block text-[11px] text-zinc-500">{row.hint}</span>
          </span>
          <Switch size="sm" checked={row.checked} disabled={disabled} onCheckedChange={(on) => onChange(row.set(on))} aria-label={row.label} />
        </label>
      ))}
    </div>
  )
}
