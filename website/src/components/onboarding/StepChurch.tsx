'use client'

import { useEffect, useState } from 'react'
import { btnPrimary, input, label, linkBtn, msg, msgError } from '@/components/auth/styles'
import { api, ApiError } from '@/lib/api'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface ServiceTime {
  day: number
  time: string
  label?: string
}

// Mirrors ORG_ROLES in the server's membership schema: the ranks are ordered,
// and editing the org needs admin or above. owner outranks admin, so the org
// creator — who is an owner, not an admin — must be allowed.
const ORG_ROLES = ['viewer', 'operator', 'admin', 'owner']
const canEditOrg = (role: string | null): boolean =>
  role !== null && ORG_ROLES.indexOf(role) >= ORG_ROLES.indexOf('admin')

const LOCAL_ZONE = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

const ZONES = (): string[] => {
  try {
    // Not in older Safari; the field falls back to the detected zone alone.
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return [LOCAL_ZONE()]
  }
}

/**
 * Church name, timezone and optional service times.
 *
 * There is deliberately no "your role" field. The desktop wizard has one, but
 * it writes to local settings; UpdateOrgDto accepts only name, timezone and
 * serviceTimes, so a role control here would silently discard what was typed.
 */
export function StepChurch({
  orgId,
  role,
  getToken,
  onDone,
}: {
  orgId: string | null
  role: string | null
  getToken: () => Promise<string>
  onDone: () => void
}): React.ReactElement {
  const [name, setName] = useState('')
  const [timezone, setTimezone] = useState(LOCAL_ZONE())
  const [serviceTimes, setServiceTimes] = useState<ServiceTime[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // admin or owner may PATCH the org. Pre-empt a viewer/operator rather than
  // letting them fill the form and then be told no; an unknown role (null) is
  // treated as editable until the server says otherwise.
  const [readOnly, setReadOnly] = useState(role !== null && !canEditOrg(role))

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    void (async () => {
      try {
        const token = await getToken()
        const org = await api<{ name: string; timezone?: string; serviceTimes?: ServiceTime[] }>(
          `/v1/orgs/${orgId}`,
          { accessToken: token },
        )
        if (cancelled) return
        setName(org.name ?? '')
        if (org.timezone) setTimezone(org.timezone)
        setServiceTimes(org.serviceTimes ?? [])
      } catch {
        // A prefill that fails is not worth an error state — the fields simply
        // start empty and the person types them.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [orgId, getToken])

  const save = async (): Promise<void> => {
    if (readOnly || !orgId) {
      onDone()
      return
    }
    setBusy(true)
    setError(null)
    try {
      const token = await getToken()
      await api(`/v1/orgs/${orgId}`, {
        method: 'PATCH',
        accessToken: token,
        body: { name: name.trim(), timezone, serviceTimes },
      })
      onDone()
    } catch (failure) {
      // A 403 means the role changed under us. Setup must not dead-end over a
      // permission this person cannot grant themselves, so keep what they typed
      // on screen, explain, and let them carry on.
      if (failure instanceof ApiError && failure.status === 403) {
        setReadOnly(true)
        setBusy(false)
        return
      }
      setError(failure instanceof ApiError ? failure.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const patchTime = (index: number, patch: Partial<ServiceTime>): void =>
    setServiceTimes((list) => list.map((item, i) => (i === index ? { ...item, ...patch } : item)))

  return (
    <div className="flex flex-col gap-5">
      {readOnly && (
        <p className="m-0 rounded-[10px] border border-line bg-paper/5 px-4 py-3 text-[13px] leading-relaxed text-mute">
          Your church&rsquo;s details are managed by an admin on this account. You can carry on with
          setup.
        </p>
      )}

      <div>
        <label className={label} htmlFor="church-name">
          Church name
        </label>
        <input
          id="church-name"
          className={input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Grace Chapel"
          disabled={readOnly || busy}
          maxLength={120}
        />
      </div>

      <div>
        <label className={label} htmlFor="church-tz">
          Timezone
        </label>
        <select
          id="church-tz"
          className={input}
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          disabled={readOnly || busy}
        >
          {ZONES().map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </div>

      {serviceTimes.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {serviceTimes.map((item, index) => (
            <li key={index} className="flex items-center gap-2">
              <select
                className={`${input} w-[5.5rem]`}
                value={item.day}
                onChange={(e) => patchTime(index, { day: Number(e.target.value) })}
                aria-label="Day"
                disabled={readOnly || busy}
              >
                {DAYS.map((day, value) => (
                  <option key={day} value={value}>
                    {day}
                  </option>
                ))}
              </select>
              <input
                className={`${input} w-[7rem] font-mono`}
                type="time"
                value={item.time}
                onChange={(e) => patchTime(index, { time: e.target.value })}
                aria-label="Time"
                disabled={readOnly || busy}
              />
              <input
                className={`${input} flex-1`}
                value={item.label ?? ''}
                onChange={(e) => patchTime(index, { label: e.target.value })}
                placeholder="First service"
                aria-label="Label"
                maxLength={60}
                disabled={readOnly || busy}
              />
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <button
          className={`${linkBtn} self-start`}
          type="button"
          onClick={() =>
            setServiceTimes((list) => [
              ...list,
              { day: 0, time: '09:00', label: 'Sunday service' },
            ])
          }
          disabled={busy}
        >
          + Add service time
        </button>
      )}

      <p className={`${msg} ${msgError}`} aria-live="polite">
        {error}
      </p>

      <button className={btnPrimary} type="button" onClick={() => void save()} disabled={busy}>
        {busy ? 'Saving…' : readOnly ? 'Continue' : 'Save and continue'}
      </button>
    </div>
  )
}
