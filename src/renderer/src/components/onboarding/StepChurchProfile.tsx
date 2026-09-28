import { useEffect, useMemo, useState } from 'react'
import { X } from '@/icons'
import type { ChurchServiceTime } from '@shared/ipc'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'
import { useAccountStore } from '@/stores/useAccountStore'
import { CHURCH_ROLES, LOCAL_ZONE, timezoneOptions } from './church-options'
import StepShell from './StepShell'
import TimezoneSelect from './TimezoneSelect'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * Three stacked rows: church name, role, timezone.
 *
 * Role and timezone are pickers rather than free text — an operator should not
 * have to guess that this field wants `Africa/Lagos` and not `WAT` or `GMT+1`,
 * and a typo there would be silently wrong rather than visibly wrong.
 *
 * Service times matter later (they are what a schedule would hang off) but
 * asking for a grid of them on first run is four controls of noise per row, in
 * front of someone who only wants to get a verse on screen — so they stay
 * folded away until asked for.
 */
export default function StepChurchProfile(): React.ReactElement {
  const church = useBootstrapStore((s) => s.settings.church)
  const patchSettings = useBootstrapStore((s) => s.patchSettings)
  const orgName = useAccountStore((s) => s.session.org?.name ?? '')

  const [name, setName] = useState(church.name || orgName)
  const [showTimes, setShowTimes] = useState(church.serviceTimes.length > 0)

  const zones = useMemo(timezoneOptions, [])
  const timezone = church.timezone || LOCAL_ZONE
  // A saved role the list does not offer (typed before, or from another build)
  // is kept as "Other" rather than silently rewritten to the first option.
  const listedRole = CHURCH_ROLES.find((option) => option === church.role) ?? null
  const [customRole, setCustomRole] = useState(listedRole ? '' : church.role)
  const [roleChoice, setRoleChoice] = useState<string>(
    listedRole ?? (church.role ? 'Other' : ''),
  )

  const save = async (patch: Partial<typeof church>): Promise<void> => {
    const next = { ...church, ...patch }
    patchSettings('church', next)
    await window.api.settings.set('church', next)
  }

  // The detected zone is shown as the selection, so persist it — otherwise a
  // profile saved without touching this field would store an empty timezone
  // that does not match what the operator was looking at.
  useEffect(() => {
    if (church.timezone) return
    void save({ timezone: LOCAL_ZONE })
  }, [church.timezone])

  // Signup already named the org; write that into the local profile if this
  // machine has none, so Continue records it instead of skipping a filled field.
  useEffect(() => {
    if (church.name.trim()) return
    const seeded = name.trim()
    if (!seeded) return
    void save({ name: seeded })
  }, [])

  const addServiceTime = (): void => {
    setShowTimes(true)
    void save({
      serviceTimes: [...church.serviceTimes, { day: 0, time: '09:00', label: 'Sunday service' }],
    })
  }

  const patchServiceTime = (index: number, patch: Partial<ChurchServiceTime>): void => {
    void save({
      serviceTimes: church.serviceTimes.map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    })
  }

  const removeServiceTime = (index: number): void => {
    void save({ serviceTimes: church.serviceTimes.filter((_, i) => i !== index) })
  }

  return (
    <StepShell title="Your church" blurb="This is the name of your organization — it follows this account to every Kairo computer.">
      <div>
        <label className="label" htmlFor="ob-church-name">Church name</label>
        <input
          id="ob-church-name"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => void save({ name: name.trim() })}
          placeholder="Grace Chapel"
        />
      </div>

      <div>
        <label className="label" htmlFor="ob-church-role">Your role</label>
        <select
          id="ob-church-role"
          className="input"
          value={roleChoice}
          onChange={(e) => {
            const choice = e.target.value
            setRoleChoice(choice)
            // "Other" only opens the field — it is never saved as the role.
            void save({ role: choice === 'Other' ? customRole.trim() : choice })
          }}
        >
          <option value="" disabled>Select a role</option>
          {CHURCH_ROLES.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
        {roleChoice === 'Other' && (
          <input
            className="input mt-2"
            value={customRole}
            onChange={(e) => setCustomRole(e.target.value)}
            onBlur={() => void save({ role: customRole.trim() })}
            placeholder="What do you do on the team?"
            aria-label="Your role"
            autoFocus
          />
        )}
      </div>

      <div>
        <label className="label" htmlFor="ob-church-tz">Timezone</label>
        <TimezoneSelect
          id="ob-church-tz"
          value={timezone}
          zones={zones}
          detected={LOCAL_ZONE}
          onChange={(zone) => void save({ timezone: zone })}
        />
      </div>

      {showTimes && church.serviceTimes.length > 0 && (
        <ul className="flex flex-col gap-2">
          {church.serviceTimes.map((item, index) => (
            <li key={index} className="flex items-center gap-2">
              <select
                className="input w-[5.25rem]"
                value={item.day}
                onChange={(e) => patchServiceTime(index, { day: Number(e.target.value) })}
                aria-label="Day"
              >
                {DAYS.map((day, value) => (
                  <option key={day} value={value}>{day}</option>
                ))}
              </select>
              <input
                className="input w-[6.5rem] font-mono"
                type="time"
                value={item.time}
                onChange={(e) => patchServiceTime(index, { time: e.target.value })}
                aria-label="Time"
              />
              <input
                className="input flex-1"
                value={item.label}
                onChange={(e) => patchServiceTime(index, { label: e.target.value })}
                placeholder="First service"
                aria-label="Label"
              />
              <button
                type="button"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-600 transition-colors hover:bg-surface-secondary hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
                onClick={() => removeServiceTime(index)}
                aria-label="Remove service time"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        className="self-start text-[12px] text-slate-500 underline-offset-2 transition-colors hover:text-slate-300 hover:underline focus-visible:outline-none focus-visible:text-slate-300"
        onClick={addServiceTime}
      >
        + Add service time
      </button>
    </StepShell>
  )
}
