import { useState, type ReactNode } from 'react'
import { AlertTriangle, ChevronRight, Church, CircleUser, Clock, Lightbulb, LogOut, RefreshCw } from '@/icons'
import { needsEmailConfirmation } from '@shared/cloud/auth-state'
import type { OrgRole, SessionSnapshot } from '@shared/cloud/contracts'
import { cn } from '@/lib/utils'
import { useAccountStore } from '@/stores/useAccountStore'
import AuthPanel from '@/components/account/AuthPanel'
import VerifyEmailNotice from '@/components/account/VerifyEmailNotice'

export const ROLE_LABEL: Record<OrgRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  operator: 'Operator',
  viewer: 'Viewer',
}

/** Two letters for the avatar: from the name, else the email, else none. */
export function accountInitials(session: Pick<SessionSnapshot, 'user'>): string | null {
  const parts = (session.user?.name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  const local = session.user?.email.split('@')[0]?.replace(/[^a-z0-9]/gi, '') ?? ''
  return local ? local.slice(0, 2).toUpperCase() : null
}

/** The account avatar: initials on stone, or a person glyph when there are none. */
export function AccountAvatar({
  session,
  size,
  tinted = false,
}: {
  session: Pick<SessionSnapshot, 'user'>
  size: number
  /** Paint in the surrounding `--hue` (the rail button) instead of stone. */
  tinted?: boolean
}): React.ReactElement {
  const initials = accountInitials(session)
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full font-semibold ${
        tinted ? 'bg-[rgb(var(--hue)/0.22)] text-[rgb(var(--hue))]' : 'bg-stone text-white'
      }`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      aria-hidden="true"
    >
      {initials ?? <CircleUser size={Math.round(size * 0.6)} />}
    </span>
  )
}

export function relativeTime(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** A grouped list, macOS Settings style: rows on one filled card, inset dividers. */
function Group({ children }: { children: ReactNode }): React.ReactElement {
  return <div className="overflow-hidden rounded-lg bg-surface-tertiary [&>*+*]:before:content-[''] [&>*+*]:before:absolute [&>*+*]:before:left-12 [&>*+*]:before:right-0 [&>*+*]:before:top-0 [&>*+*]:before:h-px [&>*+*]:before:bg-surface-border">{children}</div>
}

function Row({ icon, label, detail, value, onClick, tone, disabled }: {
  icon: ReactNode
  label: string
  detail?: string
  value?: ReactNode
  onClick?: () => void
  tone?: 'danger'
  disabled?: boolean
}): React.ReactElement {
  const content = (
    <>
      <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-md bg-surface-elevated', tone === 'danger' ? 'text-red-400' : 'text-slate-300')}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={cn('block text-[13px]', tone === 'danger' ? 'text-red-400' : 'text-white')}>{label}</span>
        {detail && <span className="mt-0.5 block text-[11px] text-slate-500">{detail}</span>}
      </span>
      {value !== undefined && <span className="shrink-0 truncate text-[13px] text-slate-400">{value}</span>}
      {onClick && tone !== 'danger' && <ChevronRight size={13} className="shrink-0 text-slate-500" aria-hidden="true" />}
    </>
  )
  const base = 'relative flex min-h-[48px] w-full items-center gap-3 px-3 py-2.5 text-left'
  return onClick ? (
    <button type="button" className={cn(base, 'transition-colors hover:bg-surface-elevated disabled:opacity-50')} onClick={onClick} disabled={disabled}>
      {content}
    </button>
  ) : (
    <div className={base}>{content}</div>
  )
}

/**
 * Account and setup, laid out like macOS's Apple Account pane: who you are up
 * top, a note only when something needs attention, then grouped rows.
 *
 * "Run setup again" lives here rather than in the wizard because the wizard is
 * gone once it is answered — without a way back in, a mistake made during setup
 * could only be undone by editing the settings that setup exists to explain.
 */
export default function AccountSection({
  onRunSetup,
  onShowTips,
}: {
  onRunSetup: () => void
  /** Replay the Operator "where things are" tips. */
  onShowTips: () => void
}): React.ReactElement {
  const session = useAccountStore((s) => s.session)
  const setSession = useAccountStore((s) => s.setSession)
  const [busy, setBusy] = useState(false)

  const signOut = async (): Promise<void> => {
    setBusy(true)
    try {
      setSession(await window.api.account.signOut())
    } finally {
      setBusy(false)
    }
  }

  if (session.state === 'signed-out') return <AuthPanel initialMode="signIn" />

  const name = session.user?.name?.trim()
  const email = session.user?.email
  const offline = session.state === 'stale'
  const notice = offline
    ? 'Working offline. Kairo can’t reach the cloud right now — everything on this computer keeps working.'
    : session.credentialsPersisted === false
      ? 'This computer has no keychain, so you’ll need to sign in again next launch.'
      : null

  return (
    <div className="flex flex-col gap-5">
      {notice && (
        <p className="flex items-center gap-2.5 rounded-lg bg-surface-tertiary px-3.5 py-2.5 text-[12px] text-slate-300">
          <AlertTriangle size={14} className="shrink-0 text-amber-400" aria-hidden="true" />
          {notice}
        </p>
      )}

      <header className="flex flex-col items-center pb-1 pt-3 text-center">
        <AccountAvatar session={session} size={84} />
        <h3 className="mt-4 text-[20px] font-semibold tracking-tight text-white">{name || email || 'Signed in'}</h3>
        {name && email && <p className="mt-0.5 text-[13px] text-slate-400">{email}</p>}
        {session.org && (
          <p className="mt-1 text-[12px] text-slate-500">{session.org.name} · {ROLE_LABEL[session.org.role]}</p>
        )}
      </header>

      {needsEmailConfirmation(session) && (
        <div className="rounded-lg bg-surface-tertiary px-3.5 py-3">
          <VerifyEmailNotice />
        </div>
      )}

      <Group>
        {session.org && <Row icon={<Church size={15} />} label="Organization" value={session.org.name} />}
        <Row
          icon={<Clock size={15} />}
          label="Last synced"
          value={offline ? 'Offline' : session.lastSyncedAt ? relativeTime(session.lastSyncedAt) : 'Not yet'}
        />
      </Group>

      <Group>
        <Row
          icon={<RefreshCw size={15} />}
          label="Run setup again"
          detail="Screens and your church profile. Nothing is reset."
          onClick={onRunSetup}
        />
        <Row
          icon={<Lightbulb size={15} />}
          label="Show tips again"
          detail="A quick walk round the Operator."
          onClick={onShowTips}
        />
      </Group>

      <Group>
        <Row icon={<LogOut size={15} />} label={busy ? 'Signing out…' : 'Sign out'} tone="danger" onClick={() => void signOut()} disabled={busy} />
      </Group>
    </div>
  )
}
