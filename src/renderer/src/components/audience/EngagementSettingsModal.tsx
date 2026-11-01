import { useEffect, useState } from 'react'
import { Dialog } from 'radix-ui'
import { cleanIpcError } from '@shared/ipc-error'
import type { AudienceState } from '@shared/audience'
import type { Moderator } from '@shared/engage'
import { DEFAULT_PRESENTATION_SETTINGS, type ProgramQuestionStyle } from '@shared/program'
import { Check, CircleUser, Copy, Download, Loader2, MonitorPlay, MoreVertical, SlidersHorizontal, X } from '@/icons'
import { MovableDialog } from '@/components/shared/MovableDialog'
import { useSettings } from '@/hooks/useSettings'
import { cn } from '@/lib/utils'
import { QuestionStyle } from './QuestionStyle'
import { RoomSettings } from './RoomSettings'

type Act = (action: () => Promise<AudienceState>, onError?: (message: string) => void) => void
type Section = 'general' | 'appearance' | 'collaboration'

export function downloadQrCode(qrDataUrl: string, code: string): void {
  if (!qrDataUrl) return
  const link = document.createElement('a')
  link.href = qrDataUrl
  link.download = `kairo-${code.toLowerCase()}-qr.png`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

export function EngagementSettingsModal({
  open,
  onOpenChange,
  initialSection = 'general',
  state,
  live,
  busy,
  act,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialSection?: Section
  state: AudienceState
  live: boolean
  busy: boolean
  act: Act
}): React.ReactElement | null {
  const [section, setSection] = useState<Section>(initialSection)
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)
  const [presentation, setPresentation] = useSettings('presentation', DEFAULT_PRESENTATION_SETTINGS)
  const storedStyle = { ...DEFAULT_PRESENTATION_SETTINGS.question, ...presentation.question }
  const [draftStyle, setDraftStyle] = useState<ProgramQuestionStyle>(storedStyle)
  const [savingStyle, setSavingStyle] = useState(false)

  useEffect(() => {
    if (open) {
      setSection(initialSection)
      setError('')
      setMenuOpenId(null)
      setDraftStyle({ ...DEFAULT_PRESENTATION_SETTINGS.question, ...presentation.question })
    }
  }, [open, initialSection]) // eslint-disable-line react-hooks/exhaustive-deps

  const styleDirty = JSON.stringify(draftStyle) !== JSON.stringify(storedStyle)

  const handleSaveStyle = async (): Promise<void> => {
    setSavingStyle(true)
    setError('')
    try {
      await setPresentation({ ...presentation, question: draftStyle })
    } catch (e) {
      setError(cleanIpcError(e))
    } finally {
      setSavingStyle(false)
    }
  }

  const session = state.session
  if (!session) return null

  const moderators = state.engage?.moderators?.filter((m) => !m.revoked) ?? []

  const handleInvite = (event: React.FormEvent): void => {
    event.preventDefault()
    if (!email.trim() || busy || inviting) return
    setError('')
    setInviting(true)
    act(
      async () => {
        try {
          const next = await window.api.audience.inviteModerator(email.trim(), '')
          setEmail('')
          return next
        } finally {
          setInviting(false)
        }
      },
      (msg) => {
        setInviting(false)
        setError(msg)
      },
    )
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/45 animate-fade-in motion-reduce:animate-none" />
        <div className="fixed inset-0 z-[101] flex items-center justify-center p-4 pointer-events-none">
          <MovableDialog className="w-full max-w-[740px]">
          <Dialog.Content
            className="flex h-[min(760px,90vh)] w-full overflow-hidden rounded-2xl modal-glass text-white outline-none animate-spring-in motion-reduce:animate-none"
            onClick={() => setMenuOpenId(null)}
          >
          {/* Left navigation rail */}
          <aside data-modal-drag className="flex w-48 shrink-0 flex-col border-r border-white/10 bg-surface-secondary/60 p-4">
            <Dialog.Title className="px-2.5 text-[15px] font-semibold tracking-tight text-white">
              Settings
            </Dialog.Title>
            <Dialog.Description className="mt-0.5 truncate px-2.5 text-[11px] text-zinc-500" title={session.title}>
              {session.title}
            </Dialog.Description>

            <nav className="mt-5 space-y-1" aria-label="Engagement settings">
              <button
                type="button"
                onClick={() => {
                  setSection('general')
                  setError('')
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-colors',
                  section === 'general'
                    ? 'bg-white/10 text-white'
                    : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200',
                )}
              >
                <SlidersHorizontal size={15} aria-hidden="true" />
                <span>General</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSection('appearance')
                  setError('')
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-colors',
                  section === 'appearance'
                    ? 'bg-white/10 text-white'
                    : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200',
                )}
              >
                <MonitorPlay size={15} aria-hidden="true" />
                <span>On Screens</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSection('collaboration')
                  setError('')
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-colors',
                  section === 'collaboration'
                    ? 'bg-white/10 text-white'
                    : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200',
                )}
              >
                <span className="flex items-center gap-2.5">
                  <CircleUser size={15} aria-hidden="true" />
                  <span>Collaboration</span>
                </span>
                {moderators.length > 0 && (
                  <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-zinc-300">
                    {moderators.length}
                  </span>
                )}
              </button>
            </nav>
          </aside>

          {/* Right content pane */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div data-modal-drag className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <h3 className="text-[15px] font-semibold text-white">
                {section === 'general' ? 'General' : section === 'appearance' ? 'On Screens' : 'Collaboration'}
              </h3>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="grid size-7 place-items-center rounded-md text-zinc-400 hover:bg-surface-tertiary hover:text-white"
                  aria-label="Close"
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </Dialog.Close>
            </div>

            <div className={cn('flex min-h-0 flex-1 flex-col', section !== 'appearance' && 'overflow-y-auto px-6 py-5')}>
              {section === 'general' ? (
                <div className="space-y-5">
                  <div>
                    <p className="text-[12px] font-medium text-zinc-300">Q&amp;A moderation</p>
                    <p className="mt-0.5 text-[11px] text-zinc-500">
                      Control how audience questions appear and whether participants can vote.
                    </p>
                    <RoomSettings
                      settings={session.settings}
                      disabled={busy || !live}
                      onChange={(settings) => act(() => window.api.audience.setRoomSettings(settings), setError)}
                    />
                  </div>

                  <div>
                    <p className="text-[12px] font-medium text-zinc-300">Join code &amp; QR code</p>
                    <p className="mt-0.5 text-[11px] text-zinc-500">
                      Share this QR code on slides or printouts so people can scan to join.
                    </p>
                    <div className="mt-2.5 flex items-center gap-4 rounded-xl bg-surface-secondary p-3.5">
                      <img
                        src={session.qrDataUrl}
                        alt={`QR code for ${session.code}`}
                        className="size-20 shrink-0 rounded-lg bg-white p-1.5"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-xl font-semibold tracking-[0.12em] text-white">
                          {session.code}
                        </p>
                        <p className="mt-0.5 truncate text-[12px] text-zinc-400">{session.url}</p>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className="btn-secondary flex h-8 items-center gap-1.5 px-3 py-0 text-xs"
                            onClick={() => downloadQrCode(session.qrDataUrl, session.code)}
                          >
                            <Download size={13} aria-hidden="true" />
                            Download QR code
                          </button>
                          <button
                            type="button"
                            className="btn-secondary flex h-8 items-center gap-1.5 px-3 py-0 text-xs"
                            onClick={() => {
                              void navigator.clipboard?.writeText(session.url).then(() => {
                                setCopied(true)
                                setTimeout(() => setCopied(false), 1500)
                              })
                            }}
                          >
                            {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                            {copied ? 'Copied' : 'Copy link'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {error && (
                    <p role="alert" className="text-[12px] text-red-400">
                      {error}
                    </p>
                  )}
                </div>
              ) : section === 'appearance' ? (
                <QuestionStyle
                  session={session}
                  style={draftStyle}
                  error={error}
                  onChange={(patch) => setDraftStyle((prev) => ({ ...prev, ...patch }))}
                />
              ) : (
                <div className="space-y-5">
                  <div>
                    <p className="text-[13px] text-zinc-300">
                      Invite others to help you with managing this engagement.
                    </p>
                    <p className="mt-0.5 text-[11px] text-zinc-500">
                      They get a sign-in link by email to moderate questions and polls from the website. No account needed.
                    </p>
                  </div>

                  <form onSubmit={handleInvite} className="space-y-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-secondary text-zinc-400">
                        <CircleUser size={16} aria-hidden="true" />
                      </span>
                      <input
                        type="email"
                        required
                        autoFocus
                        maxLength={254}
                        placeholder="Email"
                        aria-label="Collaborator email"
                        className="input h-9 flex-1 bg-surface-secondary py-0 text-[13px]"
                        value={email}
                        disabled={busy || inviting}
                        onChange={(event) => setEmail(event.target.value)}
                      />
                      <button
                        type="submit"
                        disabled={busy || inviting || !email.trim()}
                        className="btn-primary flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 py-0 text-xs font-semibold"
                      >
                        {inviting && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
                        {inviting ? 'Inviting…' : 'Invite'}
                      </button>
                    </div>
                    {error && (
                      <p role="alert" className="pl-10 text-[12px] text-red-400">
                        {error}
                      </p>
                    )}
                  </form>

                  <div className="border-t border-white/10 pt-3">
                    {moderators.length === 0 ? (
                      <p className="py-6 text-center text-[12px] text-zinc-500">
                        No collaborators invited yet.
                      </p>
                    ) : (
                      <ul className="divide-y divide-white/5">
                        {moderators.map((m) => (
                          <CollaboratorRow
                            key={m.id}
                            moderator={m}
                            busy={busy}
                            menuOpen={menuOpenId === m.id}
                            onToggleMenu={() => setMenuOpenId((prev) => (prev === m.id ? null : m.id))}
                            onRevoke={() => {
                              setMenuOpenId(null)
                              act(() => window.api.audience.revokeModerator(m.id), setError)
                            }}
                          />
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-white/10 bg-surface-tertiary/60 px-6 py-3.5">
              {section === 'appearance' && styleDirty ? (
                <>
                  <button
                    type="button"
                    className="btn-secondary h-8 px-3.5 py-0 text-xs"
                    disabled={savingStyle}
                    onClick={() => setDraftStyle(storedStyle)}
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    className="btn-primary flex h-8 items-center gap-1.5 px-4 py-0 text-xs"
                    disabled={savingStyle}
                    onClick={() => void handleSaveStyle()}
                  >
                    {savingStyle && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
                    {savingStyle ? 'Saving…' : 'Save changes'}
                  </button>
                </>
              ) : (
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="btn-primary h-8 px-4 py-0 text-xs"
                    onClick={() => {
                      if (styleDirty) void handleSaveStyle()
                    }}
                  >
                    Done
                  </button>
                </Dialog.Close>
              )}
            </div>
          </div>
          </Dialog.Content>
          </MovableDialog>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function CollaboratorRow({
  moderator: m,
  busy,
  menuOpen,
  onToggleMenu,
  onRevoke,
}: {
  moderator: Moderator
  busy: boolean
  menuOpen: boolean
  onToggleMenu: () => void
  onRevoke: () => void
}): React.ReactElement {
  const initial = (m.name || m.email || '?').trim().charAt(0).toUpperCase()
  const accepted = Boolean(m.lastSeenAt)

  return (
    <li className="relative flex items-center gap-3 py-2.5">
      {accepted ? (
        <span
          className="grid size-8 shrink-0 place-items-center rounded-full bg-teal-500/20 text-xs font-semibold text-teal-300"
          aria-hidden="true"
        >
          {initial}
        </span>
      ) : (
        <span
          className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-secondary text-zinc-400"
          aria-hidden="true"
        >
          <CircleUser size={16} />
        </span>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-zinc-100">{m.name || m.email}</span>
          <span className="shrink-0 rounded bg-surface-tertiary px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
            Guest
          </span>
        </div>
        <p className="truncate text-[11px] text-zinc-500">
          {m.name ? m.email : accepted ? 'Collaborator' : 'pending invitation'}
        </p>
      </div>

      <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="grid size-7 place-items-center rounded-md text-zinc-400 hover:bg-surface-tertiary hover:text-white"
          aria-label={`Actions for ${m.name || m.email}`}
          aria-expanded={menuOpen}
          disabled={busy}
          onClick={onToggleMenu}
        >
          <MoreVertical size={14} aria-hidden="true" />
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-8 z-20 min-w-[136px] rounded-lg border border-white/10 bg-surface-elevated p-1 shadow-xl">
            <button
              type="button"
              className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[12px] font-medium text-red-400 hover:bg-white/5 hover:text-red-300"
              disabled={busy}
              onClick={onRevoke}
            >
              Revoke access
            </button>
          </div>
        )}
      </div>
    </li>
  )
}
