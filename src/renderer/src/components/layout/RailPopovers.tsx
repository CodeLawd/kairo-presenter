import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Popover } from 'radix-ui'
import {
  Check,
  ChevronRight,
  Church,
  DeviceMobile,
  Laptop,
  Lightbulb,
  LogOut,
  Mic,
  Settings,
  Usb,
  Waveform,
} from '@/icons'
import { cn } from '@/lib/utils'
import { hueStyle, railHueClass } from '@/lib/hue'
import { useAccountStore } from '@/stores/useAccountStore'
import { useAppStore } from '@/stores/useAppStore'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'
import { inputKindLabel, listAudioInputDevices, resolveCaptureDeviceId, type InputKind } from '@/audio/devices'
import { AccountAvatar, ROLE_LABEL, relativeTime } from '@/components/settings/AccountSection'
import { requestCoachTour } from '@/components/onboarding/CoachTour'
import type { AudioDevice } from '@shared/ipc'

/**
 * Account and Audio, at the foot of the workspace rail above Settings. Each is
 * an icon with a status dot; clicking opens a popover beside the rail: a toned
 * header band with the thing itself, then details, then actions. Flat — tone
 * and spacing do the separating — with a short staggered rise on open.
 */

const PANEL = 'z-50 overflow-hidden rounded-xl border border-zinc-700 bg-surface-elevated text-zinc-200 animate-spring-in'

/** Stagger for the items inside a popover (uses the shared `ob-rise`). */
const rise = (i: number): CSSProperties => ({ '--i': i, '--base': '40ms' }) as CSSProperties

function StatusDot({ tone }: { tone: 'ok' | 'idle' | 'warn' }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'absolute bottom-1.5 right-1.5 size-2 rounded-full ring-2 ring-surface-rail',
        tone === 'ok' ? 'bg-emerald-500' : tone === 'warn' ? 'bg-amber-400' : 'bg-zinc-600',
      )}
    />
  )
}

function MenuRow({ icon, label, onSelect, tone, close = true, disabled, index }: {
  icon: ReactNode
  label: string
  onSelect: () => void
  tone?: 'danger'
  close?: boolean
  disabled?: boolean
  index: number
}): React.ReactElement {
  const className = cn(
    'ob-rise group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-surface-tertiary disabled:opacity-50',
    tone === 'danger' ? 'text-red-400' : 'text-zinc-200',
  )
  const content = (
    <>
      <span className={cn('grid size-6 shrink-0 place-items-center rounded border border-zinc-700 bg-surface-tertiary transition-colors group-hover:bg-surface-border', tone === 'danger' ? 'text-red-400' : 'text-zinc-300')}>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {tone !== 'danger' && <ChevronRight size={12} className="shrink-0 text-zinc-500 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />}
    </>
  )
  return close ? (
    <Popover.Close className={className} style={rise(index)} onClick={onSelect} disabled={disabled}>{content}</Popover.Close>
  ) : (
    <button type="button" className={className} style={rise(index)} onClick={onSelect} disabled={disabled}>{content}</button>
  )
}

// ─── Account ──────────────────────────────────────────────────────────────────

export function AccountRailButton(): React.ReactElement {
  const session = useAccountStore((s) => s.session)
  const setSession = useAccountStore((s) => s.setSession)
  const [signingOut, setSigningOut] = useState(false)
  const signedOut = session.state === 'signed-out'
  const offline = session.state === 'stale'
  const name = session.user?.name?.trim()
  const email = session.user?.email

  const signOut = async (): Promise<void> => {
    setSigningOut(true)
    try {
      setSession(await window.api.account.signOut())
    } finally {
      setSigningOut(false)
    }
  }

  const statusText = signedOut ? 'Signed out' : offline ? 'Offline' : 'Online'
  const statusDot = signedOut ? 'bg-zinc-600' : offline ? 'bg-amber-400' : 'bg-emerald-500'

  return (
    <Popover.Root>
      <Popover.Trigger className={railHueClass()} style={hueStyle('amber')} aria-label="Account" data-tooltip="Account" data-tooltip-side="right">
        <AccountAvatar session={session} size={26} tinted />
        <StatusDot tone={signedOut ? 'idle' : offline ? 'warn' : 'ok'} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="right" align="end" sideOffset={10} collisionPadding={12} className={cn(PANEL, 'w-64')}>
          {/* Who is signed in. */}
          <div className="border-b border-zinc-700 bg-surface-tertiary p-3">
            <div className="flex items-center gap-2.5">
              <AccountAvatar session={session} size={36} />
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold tracking-tight text-zinc-50">{name || email || 'Not signed in'}</p>
                {name && email && <p className="truncate text-[11px] text-zinc-400">{email}</p>}
              </div>
            </div>
            {session.org && (
              <div className="mt-2.5 flex flex-wrap gap-1">
                <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-zinc-700 bg-surface-elevated px-2 py-0.5 text-[10px] text-zinc-200">
                  <Church size={10} aria-hidden="true" />
                  <span className="truncate">{session.org.name}</span>
                </span>
                <span className="inline-flex items-center rounded-full border border-zinc-700 bg-surface-elevated px-2 py-0.5 text-[10px] text-zinc-400">
                  {ROLE_LABEL[session.org.role]}
                </span>
              </div>
            )}
          </div>

          {/* Connection at a glance. */}
          <div className="grid grid-cols-2 gap-1.5 px-2 pt-2">
            <div className="ob-rise rounded-md border border-zinc-700 bg-surface-tertiary px-2.5 py-1.5" style={rise(0)}>
              <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Status</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[12px] font-medium text-zinc-100">
                <span className={cn('size-1.5 rounded-full', statusDot, !signedOut && !offline && 'motion-safe:animate-pulse')} aria-hidden="true" />
                {statusText}
              </p>
            </div>
            <div className="ob-rise rounded-md border border-zinc-700 bg-surface-tertiary px-2.5 py-1.5" style={rise(1)}>
              <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Last synced</p>
              <p className="mt-0.5 truncate text-[12px] font-medium text-zinc-100">
                {offline ? 'Waiting' : session.lastSyncedAt ? relativeTime(session.lastSyncedAt) : '—'}
              </p>
            </div>
          </div>

          <div className="p-1.5">
            <MenuRow index={2} icon={<Settings size={12} />} label="Account settings" onSelect={() => useAppStore.getState().openSettings('account')} />
            <MenuRow index={3} icon={<Lightbulb size={12} />} label="Show tips again" onSelect={() => requestCoachTour()} />
            {!signedOut && (
              <div className="mt-1 border-t border-zinc-700 pt-1">
                <MenuRow
                  index={4}
                  icon={<LogOut size={12} />}
                  label={signingOut ? 'Signing out…' : 'Sign out'}
                  tone="danger"
                  close={false}
                  disabled={signingOut}
                  onSelect={() => void signOut()}
                />
              </div>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

// ─── Audio ────────────────────────────────────────────────────────────────────

const KIND_ICON: Record<InputKind, typeof Mic> = {
  'Built-in': Laptop,
  External: Usb,
  Continuity: DeviceMobile,
  Virtual: Waveform,
}

const METER_SEGMENTS = 24

export function AudioRailButton(): React.ReactElement {
  const capturing = useAppStore((s) => s.audioCapturing)
  const level = useAppStore((s) => s.audioLevel)
  const audio = useBootstrapStore((s) => s.settings.audio)
  const [devices, setDevices] = useState<AudioDevice[] | null>(null)
  const [open, setOpen] = useState(false)

  // Read the inputs each time the popover opens — a mic may have been plugged in.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void listAudioInputDevices()
      .then((inputs) => { if (!cancelled) setDevices(inputs) })
      .catch(() => { if (!cancelled) setDevices([]) })
    return () => { cancelled = true }
  }, [open])

  const selectedId = devices ? resolveCaptureDeviceId(devices, audio.deviceId) : audio.deviceId
  const active = devices?.find((device) => device.id === selectedId)

  const choose = (id: string): void => {
    const next = { ...audio, deviceId: id }
    useBootstrapStore.getState().patchSettings('audio', next)
    // The capture follows this, restarting on the new input if it is running.
    useAppStore.getState().setCaptureDeviceId(id)
    void window.api.settings.set('audio', next)
  }

  const value = capturing ? Math.min(Math.max(level?.rms ?? 0, 0), 1) : 0
  const clipping = capturing && Boolean(level?.clipping)

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className={railHueClass()} style={hueStyle('lime')} aria-label="Audio input" data-tooltip="Audio input" data-tooltip-side="right">
        <Mic size={19} aria-hidden="true" />
        <StatusDot tone={capturing ? 'ok' : 'idle'} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="right" align="end" sideOffset={10} collisionPadding={12} className={cn(PANEL, 'w-72')}>
          {/* The input in use, breathing with the level while Kairo listens. */}
          <div className="border-b border-zinc-700 bg-surface-tertiary p-3">
            <div className="flex items-center gap-2.5">
              <span className="relative grid size-9 shrink-0 place-items-center">
                <span
                  aria-hidden="true"
                  className={cn('absolute inset-0 rounded-full border-2 transition-[transform,opacity] duration-100', capturing ? 'border-emerald-500' : 'border-transparent')}
                  style={{ transform: `scale(${1 + value * 0.35})`, opacity: capturing ? 0.35 + value * 0.65 : 0 }}
                />
                <span className={cn('relative grid size-9 place-items-center rounded-full', capturing ? 'bg-emerald-500 text-ink' : 'bg-surface-elevated text-zinc-300')}>
                  <Mic size={16} weight={capturing ? 'fill' : 'regular'} aria-hidden="true" />
                </span>
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Audio input</p>
                <p className="truncate text-[13px] font-semibold tracking-tight text-zinc-50">{active?.label ?? 'System default'}</p>
              </div>
              <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium', capturing ? 'bg-emerald-500 text-ink' : 'bg-surface-elevated text-zinc-400')}>
                {capturing ? 'Listening' : 'Idle'}
              </span>
            </div>

            {/* Segmented meter, the same read as the transcript's rail. */}
            <div
              className="mt-3 flex h-2 gap-[2px]"
              role="meter"
              aria-label="Input level"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(value * 100)}
            >
              {Array.from({ length: METER_SEGMENTS }, (_, i) => {
                const lit = value >= (i + 1) / METER_SEGMENTS
                const tone = i >= METER_SEGMENTS - 3 || clipping ? 'bg-red-500' : i >= METER_SEGMENTS - 7 ? 'bg-amber-400' : 'bg-emerald-500'
                return <span key={i} className={cn('min-w-0 flex-1 rounded-[2px] transition-colors duration-75', lit ? tone : 'border border-zinc-700 bg-surface-elevated')} />
              })}
            </div>
            {!capturing && <p className="mt-1.5 text-[10px] text-zinc-500">The level shows while Kairo is listening.</p>}
          </div>

          <ul className="max-h-52 overflow-y-auto p-1.5" role="listbox" aria-label="Audio input devices">
            {devices === null ? (
              <li className="px-2 py-3 text-[12px] text-zinc-500">Finding microphones…</li>
            ) : devices.length === 0 ? (
              <li className="px-2 py-3 text-[12px] text-zinc-500">No microphones found. Allow microphone access in System Settings.</li>
            ) : (
              devices.map((device, index) => {
                const selected = device.id === selectedId
                const kind = inputKindLabel(device)
                const Icon = KIND_ICON[kind]
                return (
                  <li key={device.id} className="ob-rise" style={rise(index)}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => choose(device.id)}
                      className={cn(
                        'group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors',
                        selected ? 'bg-surface-tertiary' : 'hover:bg-surface-tertiary',
                      )}
                    >
                      <span className={cn('grid size-7 shrink-0 place-items-center rounded transition-colors', selected ? 'bg-teal-500 text-on-accent' : 'border border-zinc-700 bg-surface-tertiary text-zinc-300 group-hover:bg-surface-border')}>
                        <Icon size={13} aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn('block truncate text-[12px]', selected ? 'font-medium text-zinc-50' : 'text-zinc-200')}>{device.label}</span>
                        <span className="block text-[10px] text-zinc-500">{kind}</span>
                      </span>
                      {selected && <Check size={12} className="shrink-0 text-zinc-100" aria-hidden="true" />}
                    </button>
                  </li>
                )
              })
            )}
          </ul>

          <div className="border-t border-zinc-700 p-1.5">
            <Popover.Close
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[12px] text-zinc-300 transition-colors hover:bg-surface-tertiary"
              onClick={() => useAppStore.getState().openSettings('audio')}
            >
              <span className="grid size-6 shrink-0 place-items-center rounded border border-zinc-700 bg-surface-tertiary text-zinc-400">
                <Settings size={12} aria-hidden="true" />
              </span>
              <span className="flex-1">Audio settings</span>
              <ChevronRight size={12} className="text-zinc-500" aria-hidden="true" />
            </Popover.Close>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
