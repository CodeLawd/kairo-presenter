import KeyboardShortcutsSection from './KeyboardShortcutsSection'
import { Fragment, useState, useEffect, useRef, useCallback } from 'react'
import {
  Mic,
  Key,
  BookOpen,
  SlidersHorizontal,
  Save,
  CheckCircle,
  Loader,
  Wifi,
  ChevronLeft,
  ChevronRight,
  MonitorPlay,
  Send,
  Trash2,
  CircleUser,
  Search,
  MoreVertical,
  ExternalLink,
  FolderOpen,
  Cloud,
  type Icon,
} from '@/icons'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import AccountSection from './AccountSection'
import PasswordInput from '@/components/ui/password-input'
import { useSecretDraft } from '@/components/ui/secret-key-field'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { useAppStore, type SettingsSectionId } from '@/stores/useAppStore'
import { listAudioInputDevices, resolveCaptureDeviceId } from '@/audio/devices'
import { applyAppTheme } from '@/lib/appTheme'
import { parseProPresenterPort } from '@/lib/propresenter-port'
import { normalizeOverlaySettings } from '@shared/overlay-defaults'
import { normalizePresentationSettings } from '@shared/program'
import type {
  AppSettings,
  AudioDevice,
  MediaFolderMigration,
  WorkspaceInfo,
  AudioLevel,
  AutoPresentDelaySec,
  ScriptureTranslation,
  SettingsSecretClearKey,
} from '@shared/ipc'
import { LocalBiblePackManager } from './LocalBiblePackManager'
import { ScriptureLatencyPanel } from './ScriptureLatencyPanel'
import { DEFAULT_SETTINGS } from '@/lib/defaultSettings'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'
import { useUpdates } from '@/hooks/useUpdates'
import { useAccountStore } from '@/stores/useAccountStore'
import ProPresenterMark from '@/components/brand/ProPresenterMark'
import { ProviderLogo, type ProviderId } from '@/components/brand/ProviderLogos'
import ResourceCatalogue from '@/components/propresenter/ResourceCatalogue'
import { propresenterEnabled } from '@shared/pp-connect-gate'

// ─── Types ────────────────────────────────────────────────────────────────────

type Section = SettingsSectionId
type TestStatus = 'idle' | 'testing' | 'ok' | 'fail'

type UpdateFn = <K extends keyof AppSettings>(section: K, partial: Partial<AppSettings[K]>) => void

// ─── Constants ────────────────────────────────────────────────────────────────

// Kairo first; ProPresenter is an optional integration, listed last under its
// own heading (see INTEGRATION_SECTIONS).
const SECTION_NAV: { id: Section; label: string; hint: string; icon?: Icon }[] = [
  { id: 'general', label: 'General', hint: 'Theme, fonts, lyrics color & storage', icon: SlidersHorizontal },
  { id: 'overlay', label: 'Verses on screen', hint: 'Translation, verse numbers & auto-clear', icon: MonitorPlay },
  { id: 'scripture', label: 'Scripture', hint: 'Detection & display', icon: BookOpen },
  { id: 'audio', label: 'Audio', hint: 'Input device & levels', icon: Mic },
  { id: 'apikeys', label: 'API Keys', hint: 'Deepgram, Claude, Bible, Brave', icon: Key },
  { id: 'shortcuts', label: 'Keyboard Shortcuts', hint: 'Commands & key bindings', icon: SlidersHorizontal },
  { id: 'propresenter', label: 'ProPresenter', hint: 'Optional — connection & resources' },
  { id: 'account', label: 'Account', hint: 'Sign in, team sync & setup', icon: CircleUser },
]

const INTEGRATION_SECTIONS: ReadonlySet<Section> = new Set(['propresenter'])

const NAV_ICON_BG: Record<Section, string> = {
  propresenter: 'bg-[#3B6FD9]',
  audio: 'bg-[#E8833A]',
  apikeys: 'bg-[#C9A227]',
  scripture: 'bg-[#5BA85A]',
  overlay: 'bg-[#4A9EBF]',
  shortcuts: 'bg-[#527C78]',
  general: 'bg-[#8E8E93]',
  account: 'bg-[#E07A3D]',
}

function accountInitials(name: string | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}


// ─── Helper: Settings group (no heavy bezel frames) ───────────────────────────

function PrefGroup({
  title,
  description,
  children,
  plain = false,
}: {
  title?: string
  description?: string
  children: React.ReactNode
  plain?: boolean
}): React.ReactElement {
  return (
    <section className="space-y-2">
      {title ? (
        <div className="px-0.5">
          <h3 className="text-xs font-semibold tracking-tight text-white/60">{title}</h3>
          {description ? (
            <p className="mt-0.5 text-[11px] leading-snug text-white/35">{description}</p>
          ) : null}
        </div>
      ) : null}
      <div className={cn(
        'divide-y divide-white/[0.07] overflow-hidden',
        plain ? '' : 'rounded-xl border border-white/[0.06] bg-[#292929]',
      )}>
        {children}
      </div>
    </section>
  )
}

function PrefRow({
  label,
  hint,
  stacked = false,
  children,
}: {
  label: string
  hint?: string
  stacked?: boolean
  children: React.ReactNode
}): React.ReactElement {
  if (stacked) {
    return (
      <div className="space-y-2 px-3.5 py-2.5">
        <div className="min-w-0">
          <p className="text-[13px] leading-none text-white">{label}</p>
          {hint ? <p className="mt-1 text-[11px] leading-snug text-white/40">{hint}</p> : null}
        </div>
        {children}
      </div>
    )
  }
  return (
    <div className="flex min-h-[38px] items-center justify-between gap-3 px-3.5 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-none text-white">{label}</p>
        {hint ? <p className="mt-1 text-[11px] leading-snug text-white/40">{hint}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function PrefPad({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="px-3.5 py-2.5">{children}</div>
}

const PREF_INPUT = 'input h-7 w-[148px] py-0 text-right font-mono text-[13px]'
const PREF_SELECT = 'input h-7 w-[168px] py-0 text-[13px]'

function SettingsDivider(): React.ReactElement {
  return <div className="h-2" />
}

function SectionGlyph({
  section,
  icon: Icon,
  size,
  className,
}: {
  section: Section
  icon?: Icon
  size: number
  className?: string
}): React.ReactElement {
  if (section === 'propresenter' || !Icon) {
    return <ProPresenterMark size={size} className={className} />
  }
  return <Icon size={size} className={className} aria-hidden="true" />
}

function MacTrafficLights({ onClose }: { onClose?: () => void }): React.ReactElement {
  return (
    <div data-settings-drag className="group/lights flex items-center gap-[8px] px-[13px] pb-2.5 pt-3.5">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="relative h-[12px] w-[12px] rounded-full bg-[#FF5F57] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
      >
        <span className="pointer-events-none absolute inset-0 grid place-items-center text-[9px] font-bold leading-none text-[#4d0000] opacity-0 group-hover/lights:opacity-100">
          ×
        </span>
      </button>
      <span
        aria-hidden="true"
        className="relative h-[12px] w-[12px] rounded-full bg-[#FEBC2E]"
      >
        <span className="pointer-events-none absolute inset-0 grid place-items-center text-[9px] font-bold leading-none text-[#5a3a00] opacity-0 group-hover/lights:opacity-100">
          −
        </span>
      </span>
      <span
        aria-hidden="true"
        className="relative h-[12px] w-[12px] rounded-full bg-[#28C840]"
      >
        <span className="pointer-events-none absolute inset-0 grid place-items-center text-[8px] font-bold leading-none text-[#0b4a14] opacity-0 group-hover/lights:opacity-100">
          +
        </span>
      </span>
    </div>
  )
}

function Toggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <Switch
      checked={checked}
      disabled={disabled}
      onCheckedChange={onChange}
      className="data-[state=checked]:bg-[#007AFF]"
    />
  )
}

// ─── Helper: Level meter ──────────────────────────────────────────────────────

function LevelMeter({ level, active }: { level: AudioLevel | null; active: boolean }) {
  const SEGMENTS = 18
  const rms = active ? Math.min(level?.rms ?? 0, 1) : 0

  return (
    <div
      className="flex h-2 gap-[2px]"
      role="meter"
      aria-label="Input level"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(rms * 100)}
    >
      {Array.from({ length: SEGMENTS }, (_, i) => {
        const lit = rms >= (i + 1) / SEGMENTS
        const warn = i >= 13 && i < 16
        const clip = i >= 16
        return (
          <div
            key={i}
            className={cn(
              'min-w-0 flex-1 rounded-sm',
              lit
                ? clip
                  ? 'bg-[#FF453A]'
                  : warn
                    ? 'bg-[#FFD60A]'
                    : 'bg-[#30D158]'
                : 'bg-surface-elevated',
            )}
          />
        )
      })}
    </div>
  )
}

function inputKindLabel(device: AudioDevice): string {
  const label = device.label.toLowerCase()
  if (/(iphone|ipad|airpods|continuity)/.test(label)) return 'Continuity'
  if (/(virtual|teams|zoom|blackhole|loopback|aggregate|cable)/.test(label)) return 'Virtual'
  if (/(built-in|macbook|imac|internal)/.test(label)) return 'Built-in'
  return 'External'
}

// ─── Helper: Connection dot ───────────────────────────────────────────────────

function ConnectionDot({ status }: { status: TestStatus }) {
  const map: Record<TestStatus, string> = {
    idle: 'bg-slate-600',
    testing: 'bg-yellow-500 animate-pulse shadow-glow-yellow/30',
    ok: 'bg-teal-400 shadow-glow-teal/40',
    fail: 'bg-red-500 shadow-glow-red/30',
  }
  return <span className={cn('inline-block w-2.5 h-2.5 rounded-full shrink-0 transition-all duration-300', map[status])} />
}

function openProviderDocs(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** The model names each provider actually serves, as suggestions not limits. */
const MODEL_SUGGESTIONS: Record<'anthropic' | 'deepseek', string[]> = {
  anthropic: ['claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5'],
  deepseek: ['deepseek-flash', 'deepseek-v4-pro'],
}

/**
 * Which model does the scripture detection.
 *
 * A free text field on purpose: providers ship new models faster than this app
 * ships releases, and being unable to type a name that already works is worse
 * than the risk of a typo. The suggestions are a convenience; the provider is
 * the authority, and its error comes back verbatim in the status bar.
 */
function DetectionModelRow({
  provider,
  value,
  onSave,
}: {
  provider: 'anthropic' | 'deepseek'
  value: string
  onSave: (model: string) => void
}): React.ReactElement {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  const fallback = provider === 'deepseek' ? 'deepseek-flash' : 'claude-haiku-4-5'
  const dirty = draft.trim() !== value.trim()

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor="detection-model" className="text-xs font-medium text-white/80">
          Detection model
        </label>
        <span className="font-mono text-[10px] text-white/35">{provider}</span>
      </div>
      <div className="flex gap-2">
        <input
          id="detection-model"
          list="detection-model-options"
          className="input flex-1 font-mono text-xs"
          placeholder={fallback}
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && dirty) onSave(draft.trim()) }}
        />
        <datalist id="detection-model-options">
          {MODEL_SUGGESTIONS[provider].map(model => <option key={model} value={model} />)}
        </datalist>
        <button
          type="button"
          disabled={!dirty}
          className="btn-secondary shrink-0 text-xs disabled:opacity-40"
          onClick={() => onSave(draft.trim())}
        >
          Save
        </button>
      </div>
      <p className="text-[10px] leading-relaxed text-white/35">
        Leave empty to use {fallback}. Any model your provider serves will work — if it rejects the
        name, the reason appears in the status bar.
      </p>
    </div>
  )
}

/**
 * Fixed choices rather than a free-text field: four options are easy to reason
 * about and to test, and nobody needs 1,750ms.
 */
const AUTO_PRESENT_DELAYS = [
  { value: 0, label: 'Instant' },
  { value: 1, label: '1s' },
  { value: 2, label: '2s' },
  { value: 3, label: '3s' },
] as const satisfies readonly { value: AutoPresentDelaySec; label: string }[]

type SecretDraft = ReturnType<typeof useSecretDraft>

/** Where each key is used, in the operator's words rather than the vendor's. */
const PROVIDER_PURPOSE: Record<ProviderId, string> = {
  deepgram: 'Live speech-to-text',
  anthropic: 'Scripture detection',
  deepseek: 'Scripture detection',
  bible: 'Online Bible translations',
  brave: 'Web search for song lyrics',
  google: 'Lyric translation',
}

function KeyStatus({
  tone,
  children,
}: {
  tone: 'ok' | 'fail' | 'pending' | 'idle' | 'warn'
  children: React.ReactNode
}): React.ReactElement {
  const dot: Record<typeof tone, string> = {
    ok: 'bg-[#30D158]',
    fail: 'bg-[#FF453A]',
    pending: 'bg-[#0A84FF]',
    warn: 'bg-[#FFD60A]',
    idle: 'bg-surface-border',
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-white/50">
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dot[tone])} aria-hidden="true" />
      {children}
    </span>
  )
}

const KEY_ACTION =
  'inline-flex h-7 items-center gap-1.5 rounded-md bg-surface-elevated px-2.5 text-[12px] font-medium text-white transition-colors hover:bg-surface-border disabled:opacity-40'

function ProviderKeyRow({
  provider,
  name,
  docsUrl,
  configured,
  pendingRemoval,
  secret,
  onRemove,
  onUndoRemove,
  placeholder,
  fieldName,
  'aria-label': ariaLabel,
  test,
}: {
  provider: ProviderId
  name: string
  docsUrl: string
  /** A key is saved and not marked for removal. */
  configured: boolean
  pendingRemoval: boolean
  secret: SecretDraft
  onRemove: () => void
  onUndoRemove: () => void
  placeholder: string
  fieldName: string
  'aria-label': string
  test?: { status: TestStatus; message: string; onClick: () => void }
}): React.ReactElement {
  const editing = secret.replacing
  const hasDraft = secret.draft.trim().length > 0
  const canTest = Boolean(test) && (hasDraft || (configured && !editing))

  const status = (() => {
    if (pendingRemoval) return <KeyStatus tone="warn">Removed on save</KeyStatus>
    if (test?.status === 'testing') return <KeyStatus tone="pending">Testing…</KeyStatus>
    if (test?.status === 'ok') return <KeyStatus tone="ok">Verified</KeyStatus>
    if (test?.status === 'fail') return <KeyStatus tone="fail">Key rejected</KeyStatus>
    if (hasDraft) return <KeyStatus tone="pending">Unsaved</KeyStatus>
    if (configured) return <KeyStatus tone="ok">Connected</KeyStatus>
    return <KeyStatus tone="idle">Not set</KeyStatus>
  })()

  return (
    <div className="px-3.5 py-3">
      <div className="flex items-center gap-3">
        <ProviderLogo id={provider} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[13px] font-medium leading-tight text-white">{name}</p>
            {status}
          </div>
          <p className="mt-0.5 truncate text-[11px] leading-snug text-white/40">{PROVIDER_PURPOSE[provider]}</p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {pendingRemoval ? (
            <button type="button" className={KEY_ACTION} onClick={onUndoRemove}>
              Undo
            </button>
          ) : (
            <>
              {test && canTest && !editing ? (
                <button
                  type="button"
                  className={KEY_ACTION}
                  disabled={test.status === 'testing'}
                  onClick={test.onClick}
                >
                  {test.status === 'testing' ? <Loader size={12} className="animate-spin" aria-hidden="true" /> : null}
                  Test
                </button>
              ) : null}
              {!editing ? (
                <button type="button" className={KEY_ACTION} onClick={secret.beginReplace}>
                  {configured ? 'Change' : 'Add key'}
                </button>
              ) : null}
            </>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-white/35 hover:bg-surface-tertiary hover:text-white"
                aria-label={`${name} actions`}
              >
                <MoreVertical size={15} aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[168px] border-white/10 bg-[#2c2c2c] text-white">
              <DropdownMenuItem onSelect={() => openProviderDocs(docsUrl)}>
                <ExternalLink size={13} aria-hidden="true" />
                Get a {name} key
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-surface-elevated" />
              <DropdownMenuItem
                variant="destructive"
                disabled={!configured && !editing}
                onSelect={onRemove}
              >
                <Trash2 size={13} aria-hidden="true" />
                Remove key
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {editing ? (
        <div className="ml-11 mt-2.5 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <input
              type="password"
              value={secret.draft}
              onChange={(e) => secret.setDraft(e.target.value)}
              onCopy={(e) => e.preventDefault()}
              onCut={(e) => e.preventDefault()}
              placeholder={placeholder}
              className="input h-8 min-w-0 flex-1 py-0 font-mono text-[12px]"
              autoComplete="off"
              spellCheck={false}
              aria-label={ariaLabel}
              name={fieldName}
              autoFocus
            />
            {test ? (
              <button
                type="button"
                className={KEY_ACTION}
                disabled={!hasDraft || test.status === 'testing'}
                onClick={test.onClick}
              >
                {test.status === 'testing' ? <Loader size={12} className="animate-spin" aria-hidden="true" /> : null}
                Test
              </button>
            ) : null}
            <button
              type="button"
              className="h-7 px-2 text-[12px] text-white/50 hover:text-white"
              onClick={secret.cancelReplace}
            >
              Cancel
            </button>
          </div>
          <p className="text-[11px] text-white/35">
            {configured ? 'Replaces the saved key when you press Save. ' : 'Saved when you press Save. '}
            <button
              type="button"
              className="text-[#0A84FF] hover:text-[#409CFF]"
              onClick={() => openProviderDocs(docsUrl)}
            >
              Get a key ↗
            </button>
          </p>
        </div>
      ) : null}

      {test && test.status !== 'idle' && test.status !== 'testing' && test.message ? (
        <p
          className={cn(
            'ml-11 mt-1.5 text-[11px] leading-relaxed',
            test.status === 'ok' ? 'text-[#30D158]' : 'text-[#FF453A]',
          )}
        >
          {test.message}
        </p>
      ) : null}
    </div>
  )
}

function SaveBar({
  sectionId,
  savedSection,
  onSave,
  disabled = false,
}: {
  sectionId: string
  savedSection: string | null
  onSave: () => void
  disabled?: boolean
}) {
  const saved = savedSection === sectionId
  return (
    <div className="flex justify-end pt-1">
      <button
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md bg-[#3a3a3a] px-3.5 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#454545] disabled:opacity-40 disabled:hover:bg-[#3a3a3a]',
          saved && 'bg-[#2f6b3a] hover:bg-[#2f6b3a] disabled:opacity-100 disabled:hover:bg-[#2f6b3a]',
        )}
        disabled={disabled && !saved}
        onClick={onSave}
      >
        {saved ? <CheckCircle size={13} aria-hidden="true" /> : <Save size={13} aria-hidden="true" />}
        {saved ? 'Saved' : 'Save'}
      </button>
    </div>
  )
}

// ─── Section: ProPresenter Connection ────────────────────────────────────────

/**
 * The one switch for the whole integration. Kairo is standalone: until this is
 * on, ProPresenter is never probed, prompted for or reported on anywhere.
 * Saved at once — it is not part of the connection form's Save.
 */
function PropresenterSwitch({
  settings,
  onChange,
}: {
  settings: AppSettings
  onChange: (next: AppSettings['propresenter']) => void
}): React.ReactElement {
  const enabled = propresenterEnabled(settings)
  const toggle = async (on: boolean): Promise<void> => {
    const next = { ...settings.propresenter, enabled: on }
    onChange(next)
    await window.api.settings.set('propresenter', next)
    if (on) {
      // Try straight away; a miss only shows in the header status.
      await window.api.propresenter
        .connect({ host: next.host, port: next.port, password: next.password })
        .catch(() => undefined)
    }
  }
  return (
    <PrefGroup title="ProPresenter" plain>
      <PrefRow
        label="Use ProPresenter"
        hint={
          enabled
            ? 'Kairo can also send to ProPresenter — library matches, messages, stage and its NDI video input.'
            : 'Off — Kairo runs its own screens and never contacts ProPresenter.'
        }
      >
        <Toggle checked={enabled} onChange={(on) => void toggle(on)} />
      </PrefRow>
    </PrefGroup>
  )
}

function ConnectionSection({
  settings,
  update,
  onSave,
  savedSection,
}: {
  settings: AppSettings
  update: UpdateFn
  onSave: () => void
  savedSection: string | null
}) {
  const [testStatus, setTestStatus] = useState<TestStatus>('idle')
  const [testMsg, setTestMsg] = useState('')
  const pp = settings.propresenter
  const [portDraft, setPortDraft] = useState(() => String(pp.port))
  const parsedPort = parseProPresenterPort(portDraft)

  useEffect(() => {
    setPortDraft(String(pp.port))
  }, [pp.port])

  const testConnection = async () => {
    if (parsedPort === null) {
      setTestStatus('fail')
      setTestMsg('Enter a port between 1 and 65535')
      return
    }
    setTestStatus('testing')
    setTestMsg('Connecting…')
    try {
      await window.api.propresenter.connect({ host: pp.host, port: parsedPort, password: pp.password })
      let s = await window.api.propresenter.getStatus()
      if (s.state === 'connecting') {
        await new Promise((r) => setTimeout(r, 2000))
        s = await window.api.propresenter.getStatus()
      }
      if (s.state === 'connected') {
        setTestStatus('ok')
        setTestMsg(`Connected · ${s.host}:${s.port}`)
      } else {
        setTestStatus('fail')
        setTestMsg('No response — check IP, port, and that both Macs are on the same network')
      }
    } catch (err) {
      setTestStatus('fail')
      setTestMsg(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const statusLabel =
    testStatus === 'testing'
      ? 'Connecting…'
      : testStatus === 'ok'
        ? 'Connected'
        : testStatus === 'fail'
          ? 'Connection failed'
          : 'Not tested'

  return (
    <div className="space-y-5">
      <PrefGroup title="Stage Display" plain>
        <PrefRow label="Status" hint={testMsg || undefined}>
          <div className="flex items-center gap-2.5">
            <ConnectionDot status={testStatus} />
            <span className="text-[13px] text-white/55">{statusLabel}</span>
            <button
              className="btn-secondary flex items-center gap-1.5 py-1 px-2.5 text-[12px] shrink-0"
              onClick={() => void testConnection()}
              disabled={testStatus === 'testing'}
            >
              {testStatus === 'testing' ? (
                <Loader size={12} className="animate-spin" aria-hidden="true" />
              ) : (
                <Wifi size={12} aria-hidden="true" />
              )}
              {testStatus === 'testing' ? 'Testing…' : 'Test'}
            </button>
          </div>
        </PrefRow>
        <PrefRow label="IP Address">
          <input
            className={cn(PREF_INPUT, 'w-[220px] max-w-[44vw] !border-0 !bg-transparent !shadow-none focus:!bg-surface-secondary focus:!ring-0')}
            value={pp.host}
            onChange={(e) => update('propresenter', { host: e.target.value })}
            placeholder="192.168.1.100"
            spellCheck={false}
            name="pp-host"
            aria-label="ProPresenter IP Address"
          />
        </PrefRow>
        <PrefRow label="Port">
          <input
            className={cn(PREF_INPUT, 'w-[220px] max-w-[44vw] tabular-nums !border-0 !bg-transparent !shadow-none focus:!bg-surface-secondary focus:!ring-0')}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={portDraft}
            onChange={(e) => {
              const draft = e.target.value.replace(/\D/g, '').slice(0, 5)
              setPortDraft(draft)
              const port = parseProPresenterPort(draft)
              if (port !== null) update('propresenter', { port })
            }}
            aria-invalid={portDraft !== '' && parsedPort === null}
            name="pp-port"
            aria-label="ProPresenter Port"
          />
        </PrefRow>
        <PrefRow label="Password" hint="Preferences → Stage Display">
          <div className="w-[220px] max-w-[44vw]">
            <PasswordInput
              className="h-7 border-0 bg-transparent py-0 text-right font-mono text-[13px] shadow-none focus:bg-surface-secondary focus:ring-0"
              value={pp.password}
              onChange={(e) => update('propresenter', { password: e.target.value })}
              placeholder="Optional"
              autoComplete="off"
              name="pp-password"
              aria-label="Stage Display Password"
            />
          </div>
        </PrefRow>
      </PrefGroup>

      {parsedPort === null && (
        <p role="alert" className="px-0.5 text-right text-[11px] text-amber-400">
          Enter a port between 1 and 65535
        </p>
      )}
      <SaveBar
        sectionId="propresenter"
        savedSection={savedSection}
        onSave={() => {
          if (parsedPort === null) {
            setTestStatus('fail')
            setTestMsg('Enter a port between 1 and 65535')
            return
          }
          onSave()
        }}
      />
    </div>
  )
}

// ─── Section: Audio Configuration ────────────────────────────────────────────

function AudioSection({
  settings,
  update,
  onSave,
  savedSection,
}: {
  settings: AppSettings
  update: UpdateFn
  onSave: () => void
  savedSection: string | null
}) {
  const [devices, setDevices] = useState<AudioDevice[]>([])
  const [devicesLoading, setDevicesLoading] = useState(true)
  const [listening, setListening] = useState(false)
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [localLevel, setLocalLevel] = useState<import('@shared/ipc').AudioLevel | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)

  // Enumerate in the renderer: these IDs go straight into getUserMedia.
  useEffect(() => {
    let cancelled = false
    const refresh = (): void => {
      void listAudioInputDevices().then((inputs) => {
        if (cancelled) return
        setDevices(inputs)
        setDevicesLoading(false)
      })
    }
    refresh()
    // Labels and IDs fill in once permission is granted, and change when a
    // microphone is plugged in or removed.
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => {
      cancelled = true
      navigator.mediaDevices.removeEventListener('devicechange', refresh)
    }
  }, [])

  const stopMonitor = useCallback(() => {
    processorRef.current?.disconnect()
    processorRef.current = null
    ctxRef.current?.close()
    ctxRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setListening(false)
    setLocalLevel(null)
  }, [])

  // Same resolution the capture path uses, so the meter never targets a
  // device the session has already resolved away from.
  const selectedId = devicesLoading ? '' : resolveCaptureDeviceId(devices, settings.audio.deviceId)

  // Live input meter while this pane is open — same idea as System Settings → Sound.
  useEffect(() => {
    if (devicesLoading || !selectedId) return
    let cancelled = false

    const start = async (): Promise<void> => {
      setCaptureError(null)
      try {
        const constraints: MediaTrackConstraints = {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }
        if (selectedId !== 'default') {
          constraints.deviceId = { exact: selectedId }
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream

        const ctx = new AudioContext()
        ctxRef.current = ctx
        const source = ctx.createMediaStreamSource(stream)
        // Deprecated Web Audio API with no drop-in replacement for this tap;
        // kept until the AudioWorklet migration lands.
        const processor = ctx.createScriptProcessor(2048, 1, 1)
        processorRef.current = processor
        const mute = ctx.createGain()
        mute.gain.value = 0

        let peak = 0
        processor.onaudioprocess = (e) => {
          const data = e.inputBuffer.getChannelData(0)
          let sum = 0
          let chunkPeak = 0
          for (let i = 0; i < data.length; i++) {
            sum += data[i] * data[i]
            const abs = Math.abs(data[i])
            if (abs > chunkPeak) chunkPeak = abs
          }
          const rms = Math.sqrt(sum / data.length)
          peak = Math.max(chunkPeak, peak * 0.94)
          setLocalLevel({ rms, peak, clipping: peak > 0.99, timestamp: Date.now() })
        }

        source.connect(processor)
        processor.connect(mute)
        mute.connect(ctx.destination)
        setListening(true)
      } catch (err) {
        if (!cancelled) {
          setCaptureError((err as Error).message)
          setListening(false)
        }
      }
    }

    void start()
    return () => {
      cancelled = true
      stopMonitor()
    }
  }, [devicesLoading, selectedId, stopMonitor])

  const displayLevel = localLevel

  return (
    <div className="space-y-3">
      <section className="space-y-2">
        <h3 className="px-0.5 text-xs font-semibold tracking-tight text-white/60">Input</h3>
        <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-[#292929]">
          <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-3 px-3.5 pb-1 pt-2.5">
            <p className="text-[11px] text-white/35">Name</p>
            <p className="text-[11px] text-white/35">Type</p>
          </div>

          {devicesLoading ? (
            <div className="flex items-center gap-2 px-3.5 py-6 text-[12px] text-white/40">
              <Loader size={13} className="animate-spin" aria-hidden="true" />
              Looking for microphones…
            </div>
          ) : devices.length === 0 ? (
            <p className="px-3.5 py-6 text-[12px] leading-snug text-white/40">
              No microphones found. Allow microphone access and reopen Settings.
            </p>
          ) : (
            <ul className="px-1.5 pb-1.5" role="listbox" aria-label="Audio input devices">
              {devices.map((device) => {
                const selected = device.id === selectedId
                return (
                  <li key={device.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => update('audio', { deviceId: device.id })}
                      className={cn(
                        'grid w-full grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-3 rounded-md px-2 py-[7px] text-left text-[13px]',
                        selected ? 'bg-[#3d3d3d] text-white' : 'text-white/90 hover:bg-surface-tertiary',
                      )}
                    >
                      <span className="truncate">{device.label}</span>
                      <span className={cn('truncate', selected ? 'text-white/55' : 'text-white/35')}>
                        {inputKindLabel(device)}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="border-t border-white/[0.07] px-3.5 py-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-[13px] text-white">Input level</p>
              {listening ? (
                <span className="text-[11px] text-white/35">Live</span>
              ) : null}
            </div>
            <LevelMeter level={displayLevel} active={listening} />
            {captureError ? (
              <p className="mt-2 text-[11px] leading-snug text-[#FF453A]">{captureError}</p>
            ) : null}
          </div>
        </div>
      </section>

      <SaveBar sectionId="audio" savedSection={savedSection} onSave={onSave} />
    </div>
  )
}

// ─── Section: API Keys ────────────────────────────────────────────────────────

function ApiKeysSection({
  settings,
  update,
  onSaveComplete,
  savedSection,
}: {
  settings: AppSettings
  update: UpdateFn
  onSaveComplete: () => void
  savedSection: string | null
}) {
  const configured = useBootstrapStore((s) => s.settings.secretsConfigured)
  const setBootstrapSettings = useBootstrapStore((s) => s.setSettings)
  const storedStt = useBootstrapStore((s) => s.settings.stt)
  const signedIn = useAccountStore((s) => s.session.state === 'active' || s.session.state === 'stale')
  const syncHint = signedIn
    ? 'Saved on this Mac · synced to your church account'
    : 'Saved on this Mac · sign in to sync across devices'
  const [deepgramStatus, setDeepgramStatus] = useState<TestStatus>('idle')
  const [deepgramMsg, setDeepgramMsg] = useState('')
  const [anthropicStatus, setAnthropicStatus] = useState<TestStatus>('idle')
  const [anthropicMsg, setAnthropicMsg] = useState('')
  const [bibleStatus, setBibleStatus] = useState<TestStatus>('idle')
  const [bibleMsg, setBibleMsg] = useState('')
  const [braveStatus, setBraveStatus] = useState<TestStatus>('idle')
  const [braveMsg, setBraveMsg] = useState('')
  const [clearStt, setClearStt] = useState<SettingsSecretClearKey[]>([])
  const [clearLyrics, setClearLyrics] = useState<SettingsSecretClearKey[]>([])

  const deepgram = useSecretDraft(configured.deepgram)
  const anthropic = useSecretDraft(configured.anthropic)
  const deepseek = useSecretDraft(configured.deepseek)
  const bible = useSecretDraft(configured.bible)
  const brave = useSecretDraft(configured.brave)
  const googleTranslate = useSecretDraft(configured.googleTranslate)

  // When this section opens, pull the church vault so website edits show up
  // without restarting the app.
  useEffect(() => {
    if (!signedIn) return
    let cancelled = false
    void (async () => {
      try {
        await window.api.account.syncOrgSecrets()
        if (cancelled) return
        const fresh = await window.api.settings.getAll()
        if (!cancelled) setBootstrapSettings(fresh)
      } catch {
        // Offline / unsigned — leave whatever is already on disk.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [signedIn, setBootstrapSettings])

  const testDeepgram = async () => {
    setDeepgramStatus('testing')
    setDeepgramMsg('')
    const result = await window.api.settings.testApiKey('deepgram', deepgram.takeSaveValue())
    setDeepgramStatus(result.ok ? 'ok' : 'fail')
    setDeepgramMsg(result.message)
  }

  const testAnthropic = async () => {
    setAnthropicStatus('testing')
    setAnthropicMsg('')
    const result = await window.api.settings.testApiKey('anthropic', anthropic.takeSaveValue())
    setAnthropicStatus(result.ok ? 'ok' : 'fail')
    setAnthropicMsg(result.message)
  }

  // The web tier falls back silently when Brave rejects a key, so without a
  // test here a wrong key looks configured and songs the catalogues miss just
  // never turn up.
  const testBrave = async () => {
    setBraveStatus('testing')
    setBraveMsg('')
    const result = await window.api.settings.testApiKey('brave', brave.takeSaveValue())
    setBraveStatus(result.ok ? 'ok' : 'fail')
    setBraveMsg(result.message)
  }

  const testBible = async () => {
    setBibleStatus('testing')
    setBibleMsg('')
    const draft = bible.takeSaveValue()
    const result = await window.api.settings.testApiKey('bible', draft)
    setBibleStatus(result.ok ? 'ok' : 'fail')
    setBibleMsg(result.message)
    if (result.ok) {
      try {
        const translations = await window.api.scripture.getTranslations(draft)
        useBootstrapStore.getState().setTranslations(translations)
        useBootstrapStore.getState().setApiBibleAuth('authorized')
      } catch {
        useBootstrapStore.getState().setApiBibleAuth('unauthorized')
      }
    } else {
      useBootstrapStore.getState().setApiBibleAuth('unauthorized')
    }
  }

  const markClear = (key: SettingsSecretClearKey, section: 'stt' | 'lyrics') => {
    if (section === 'stt') setClearStt((prev) => (prev.includes(key) ? prev : [...prev, key]))
    else setClearLyrics((prev) => (prev.includes(key) ? prev : [...prev, key]))
  }

  const unmarkClear = (key: SettingsSecretClearKey, section: 'stt' | 'lyrics') => {
    if (section === 'stt') setClearStt((prev) => prev.filter((k) => k !== key))
    else setClearLyrics((prev) => prev.filter((k) => k !== key))
  }

  const handleSave = async () => {
    const deepgramValue = deepgram.takeSaveValue()
    const anthropicValue = anthropic.takeSaveValue()
    const deepseekValue = deepseek.takeSaveValue()
    const bibleValue = bible.takeSaveValue()
    const braveValue = brave.takeSaveValue()
    const googleValue = googleTranslate.takeSaveValue()

    const sttPatch = {
      ...settings.stt,
      apiKey: deepgramValue ?? '',
      anthropicApiKey: anthropicValue ?? '',
      deepseekApiKey: deepseekValue ?? '',
      bibleApiKey: bibleValue ?? '',
      provider:
        deepgramValue || (configured.deepgram && !clearStt.includes('apiKey'))
          ? ('deepgram' as const)
          : settings.stt.provider,
      clearKeys: clearStt,
    }
    const lyricsPatch = {
      ...settings.lyrics,
      braveApiKey: braveValue ?? '',
      googleTranslateApiKey: googleValue ?? '',
      clearKeys: clearLyrics,
    }

    await Promise.all([
      window.api.settings.set('stt', sttPatch),
      window.api.settings.set('lyrics', lyricsPatch),
    ])

    // Don't rely only on the push event — refresh flags so the UI flips to the
    // masked "saved" state immediately after Save.
    const fresh = await window.api.settings.getAll()
    setBootstrapSettings(fresh)

    deepgram.markSaved()
    anthropic.markSaved()
    deepseek.markSaved()
    bible.markSaved()
    brave.markSaved()
    googleTranslate.markSaved()
    setClearStt([])
    setClearLyrics([])
    onSaveComplete()
  }

  const secrets = [deepgram, anthropic, deepseek, bible, brave, googleTranslate]
  const dirty =
    clearStt.length > 0 ||
    clearLyrics.length > 0 ||
    secrets.some((secret) => secret.draft.trim().length > 0) ||
    settings.stt.llmProvider !== storedStt.llmProvider ||
    (settings.stt.llmModel ?? '') !== (storedStt.llmModel ?? '')

  /** Row props shared by every provider: saved state, draft, remove/undo. */
  const keyRow = (
    secret: SecretDraft,
    isConfigured: boolean,
    clearKey: SettingsSecretClearKey,
    section: 'stt' | 'lyrics',
  ) => {
    const pendingRemoval = isConfigured && (section === 'stt' ? clearStt : clearLyrics).includes(clearKey)
    return {
      secret,
      configured: isConfigured && !pendingRemoval,
      pendingRemoval,
      onRemove: () => {
        secret.cancelReplace()
        if (isConfigured) markClear(clearKey, section)
      },
      onUndoRemove: () => unmarkClear(clearKey, section),
    }
  }

  const configuredCount = [
    configured.deepgram && !clearStt.includes('apiKey'),
    configured.anthropic && !clearStt.includes('anthropicApiKey'),
    configured.deepseek && !clearStt.includes('deepseekApiKey'),
    configured.bible && !clearStt.includes('bibleApiKey'),
    configured.brave && !clearLyrics.includes('braveApiKey'),
    configured.googleTranslate && !clearLyrics.includes('googleTranslateApiKey'),
  ].filter(Boolean).length

  const llmProvider = settings.stt.llmProvider

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-surface-secondary px-3.5 py-2.5">
        <Cloud size={15} className="shrink-0 text-white/40" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-[11px] leading-snug text-white/50">{syncHint}</p>
        <span className="shrink-0 text-[11px] tabular-nums text-white/35">{configuredCount} of 6 set</span>
      </div>

      <PrefGroup title="Speech" description="Turns the sermon audio into text.">
        <ProviderKeyRow
          provider="deepgram"
          name="Deepgram"
          docsUrl="https://console.deepgram.com/"
          {...keyRow(deepgram, configured.deepgram, 'apiKey', 'stt')}
          placeholder="Paste token"
          fieldName="deepgram-key"
          aria-label="Deepgram API Token"
          test={{ status: deepgramStatus, message: deepgramMsg, onClick: () => void testDeepgram() }}
        />
      </PrefGroup>

      <PrefGroup title="Scripture detection" description="Reads the transcript and suggests verses. Only one provider is used at a time.">
        <PrefRow label="Provider">
          <div className="flex items-center gap-0.5 rounded-md bg-surface-tertiary p-0.5" role="radiogroup" aria-label="Detection provider">
            {(['anthropic', 'deepseek'] as const).map((id) => {
              const active = llmProvider === id
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => update('stt', { llmProvider: id })}
                  className={cn(
                    'rounded-md px-3 py-1 text-[12px] font-medium transition-colors',
                    active ? 'bg-surface-border text-white shadow-sm' : 'text-white/45 hover:text-white/75',
                  )}
                >
                  {id === 'anthropic' ? 'Anthropic' : 'DeepSeek'}
                </button>
              )
            })}
          </div>
        </PrefRow>
        {llmProvider === 'anthropic' ? (
          <ProviderKeyRow
            provider="anthropic"
            name="Anthropic"
            docsUrl="https://console.anthropic.com/settings/keys"
            {...keyRow(anthropic, configured.anthropic, 'anthropicApiKey', 'stt')}
            placeholder="sk-ant-…"
            fieldName="anthropic-key"
            aria-label="Anthropic API Key"
            test={{ status: anthropicStatus, message: anthropicMsg, onClick: () => void testAnthropic() }}
          />
        ) : (
          <ProviderKeyRow
            provider="deepseek"
            name="DeepSeek"
            docsUrl="https://platform.deepseek.com/api_keys"
            {...keyRow(deepseek, configured.deepseek, 'deepseekApiKey', 'stt')}
            placeholder="sk-…"
            fieldName="deepseek-key"
            aria-label="DeepSeek API Key"
          />
        )}
        <PrefPad>
          <DetectionModelRow
            provider={llmProvider}
            value={settings.stt.llmModel ?? ''}
            onSave={model => update('stt', { llmModel: model })}
          />
        </PrefPad>
      </PrefGroup>

      <PrefGroup title="Lookups" description="Optional. Each unlocks an extra feature.">
        <ProviderKeyRow
          provider="bible"
          name="API.Bible"
          docsUrl="https://scripture.api.bible/"
          {...keyRow(bible, configured.bible, 'bibleApiKey', 'stt')}
          placeholder="Paste key"
          fieldName="bible-key"
          aria-label="Bible API Key"
          test={{ status: bibleStatus, message: bibleMsg, onClick: () => void testBible() }}
        />
        <ProviderKeyRow
          provider="brave"
          name="Brave Search"
          docsUrl="https://api.search.brave.com/app/keys"
          {...keyRow(brave, configured.brave, 'braveApiKey', 'lyrics')}
          placeholder="Paste key"
          fieldName="brave-key"
          aria-label="Brave Search API Key"
          test={{ status: braveStatus, message: braveMsg, onClick: () => void testBrave() }}
        />
        <ProviderKeyRow
          provider="google"
          name="Google Translate"
          docsUrl="https://console.cloud.google.com/apis/credentials"
          {...keyRow(googleTranslate, configured.googleTranslate, 'googleTranslateApiKey', 'lyrics')}
          placeholder="Paste key"
          fieldName="google-translate-key"
          aria-label="Google Translate API Key"
        />
      </PrefGroup>

      <SaveBar
        sectionId="apikeys"
        savedSection={savedSection}
        disabled={!dirty}
        onSave={() => void handleSave()}
      />
    </div>
  )
}

// ─── Section: Scripture Settings ──────────────────────────────────────────────

function ScriptureSection({
  settings,
  update,
  onSave,
  savedSection,
}: {
  settings: AppSettings
  update: UpdateFn
  onSave: () => void
  savedSection: string | null
}) {
  const sc = settings.scripture
  // Availability comes from the shared snapshot, refreshed in the background
  // once the saved API.Bible key has been validated.
  const translations = useBootstrapStore((state) => state.translations)
  const translationsLoading = useBootstrapStore((state) => state.apiBibleAuth === 'checking')
  const [downloadingTranslation, setDownloadingTranslation] = useState(false)

  const selectTranslation = async (translation: ScriptureTranslation): Promise<void> => {
    const option = translations.find((item) => item.id === translation)
    if (option?.downloadable && !option?.available) {
      const size = option.downloadApprox ?? 'a few megabytes'
      const confirmed = window.confirm(
        `Download and use ${option.id} (${option.name})?\n\n` +
          `Kairo will download ${size} once. ${option.id} will then work completely offline.`,
      )
      if (!confirmed) return
      setDownloadingTranslation(true)
      try {
        await window.api.scripture.downloadLocalBibleTranslation(option.id)
        const refreshed = await window.api.scripture.getTranslations()
        useBootstrapStore.getState().setTranslations(refreshed)
      } catch (error) {
        window.alert((error as Error).message)
        return
      } finally {
        setDownloadingTranslation(false)
      }
    }
    update('scripture', { defaultTranslation: translation })
  }

  // Grouped by what selecting the option does, not by source: a downloaded
  // pack keeps its API-capable registry entry, so `access` can't say "on disk".
  const translationGroups = [
    { label: 'Ready to use', items: translations.filter((t) => t.available) },
    { label: 'Download to use offline', items: translations.filter((t) => !t.available && t.downloadable) },
    { label: 'Unavailable', items: translations.filter((t) => !t.available && !t.downloadable) },
  ]

  return (
    <div className="space-y-5">
      <PrefGroup title="Default Bible">
        <PrefRow label="Translation" hint={translationsLoading ? 'Checking available Bibles…' : 'Used for new searches and auto-detection'}>
          <select
            className={PREF_SELECT}
            value={sc.defaultTranslation}
            disabled={downloadingTranslation}
            onChange={(e) => { void selectTranslation(e.target.value as ScriptureTranslation) }}
            aria-label="Default bible translation"
          >
            {translationGroups.map((group) =>
              group.items.length === 0 ? null : (
                <optgroup key={group.label} label={group.label}>
                  {group.items.map((translation) => (
                    <option
                      key={translation.id}
                      value={translation.id}
                      disabled={!translation.available && !translation.downloadable}
                    >
                      {translation.id} — {translation.name}
                    </option>
                  ))}
                </optgroup>
              ),
            )}
          </select>
        </PrefRow>
        <PrefRow label="Verse numbers" hint="Include numbers on slides">
          <Toggle
            checked={sc.showVerseNumbers}
            onChange={(v) => update('scripture', { showVerseNumbers: v })}
          />
        </PrefRow>
      </PrefGroup>

      <PrefGroup
        title="Bible library"
        description="Installed Bibles work offline and need no API key."
      >
        <LocalBiblePackManager />
      </PrefGroup>

      <PrefGroup title="Auto-detection">
        <PrefRow label="Enabled" hint="Suggest verses from the live transcript">
          <Toggle checked={sc.autoMode} onChange={(v) => update('scripture', { autoMode: v })} />
        </PrefRow>
        <div className={cn(!sc.autoMode && 'pointer-events-none opacity-40')}>
          <PrefRow
            stacked
            label="Confidence"
            hint="Higher is stricter. 0.70–0.85 suits most sermons."
          >
            <div className="flex items-center gap-3">
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={[sc.confidenceThreshold]}
                onValueChange={(next) => update('scripture', { confidenceThreshold: next[0] })}
                aria-label="Confidence threshold range slider"
                className="flex-1"
              />
              <span className="w-10 text-right text-[12px] font-mono tabular-nums text-white/50">
                {sc.confidenceThreshold.toFixed(2)}
              </span>
            </div>
          </PrefRow>
          <PrefRow
            label="Safety delay"
            hint="Time to cancel before a verse goes live. The largest part of the wait."
          >
            <div className="flex items-center gap-1" role="radiogroup" aria-label="Safety delay">
              {AUTO_PRESENT_DELAYS.map((option) => {
                const active = (sc.autoPresentDelaySec ?? 1) === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => update('scripture', { autoPresentDelaySec: option.value })}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
                      active
                        ? 'bg-surface-elevated text-white'
                        : 'text-white/45 hover:bg-surface-tertiary hover:text-white/70',
                    )}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
          </PrefRow>
          <PrefRow label="Debounce" hint="Minimum gap between suggestions">
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={120}
                value={sc.debounceInterval}
                onChange={(e) =>
                  update('scripture', {
                    debounceInterval: Math.max(1, parseInt(e.target.value) || 8),
                  })
                }
                className={cn(PREF_INPUT, 'w-[64px] text-center')}
                aria-label="Detection debounce duration in seconds"
              />
              <span className="text-[12px] text-white/40">sec</span>
            </div>
          </PrefRow>
          <PrefRow label="Context window" hint="Transcript sent for analysis">
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={10}
                max={300}
                value={sc.contextWindowSize}
                onChange={(e) =>
                  update('scripture', {
                    contextWindowSize: Math.max(10, parseInt(e.target.value) || 90),
                  })
                }
                className={cn(PREF_INPUT, 'w-[64px] text-center')}
                aria-label="Context window size in seconds"
              />
              <span className="text-[12px] text-white/40">sec</span>
            </div>
          </PrefRow>
        </div>
      </PrefGroup>

      <PrefGroup
        title="Verse timing"
        description="How long each detected verse took to appear in Kairo this session, excluding the safety delay. Open a verse to see which step was slow."
      >
        <ScriptureLatencyPanel />
      </PrefGroup>

      <SaveBar sectionId="scripture" savedSection={savedSection} onSave={onSave} />
    </div>
  )
}

// ─── Section: Verses on screen ────────────────────────────────────────────────

function OverlaySection({
  settings,
  update,
  onSave,
  savedSection,
}: {
  settings: AppSettings
  update: UpdateFn
  onSave: () => void
  savedSection: string | null
}) {
  const ov = settings.overlay

  const [testStatus, setTestStatus] = useState<TestStatus>('idle')
  const [testMsg, setTestMsg] = useState('')

  const handleSendTest = async () => {
    setTestStatus('testing')
    setTestMsg('Sending…')
    try {
      const ok = await window.api.output.sendTest()
      setTestStatus(ok ? 'ok' : 'fail')
      setTestMsg(ok ? 'Sent' : 'Nothing took the test verse — check Screens')
    } catch (err) {
      setTestStatus('fail')
      setTestMsg(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const handleClear = async () => {
    setTestStatus('testing')
    setTestMsg('Clearing…')
    try {
      const ok = await window.api.output.clearAll()
      setTestStatus(ok ? 'ok' : 'fail')
      setTestMsg(ok ? 'Cleared' : 'Clear failed — check logs')
    } catch (err) {
      setTestStatus('fail')
      setTestMsg(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  return (
    <div className="space-y-5">
      <PrefGroup title="Verse text">
        <PrefRow label="Show translation" hint={'John 3:16 (KJV)'}>
          <Toggle
            checked={ov.showTranslation}
            onChange={(v) => update('overlay', { showTranslation: v })}
          />
        </PrefRow>
        <PrefRow label="Verse numbers" hint="On multi-verse pushes">
          <Toggle
            checked={ov.showVerseNumbers}
            onChange={(v) => update('overlay', { showVerseNumbers: v })}
          />
        </PrefRow>
        <PrefRow label="Max verses" hint="0 sends the whole passage">
          <input
            type="number"
            min={0}
            max={50}
            value={ov.maxVerses}
            onChange={(e) =>
              update('overlay', { maxVerses: Math.max(0, parseInt(e.target.value) || 0) })
            }
            className={cn(PREF_INPUT, 'w-[64px] text-center')}
            aria-label="Maximum verses per overlay push"
          />
        </PrefRow>
        <PrefRow label="Auto-clear" hint="0 keeps it until you clear">
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={0}
              max={600}
              value={ov.autoClearSec}
              onChange={(e) =>
                update('overlay', { autoClearSec: Math.max(0, parseInt(e.target.value) || 0) })
              }
              className={cn(PREF_INPUT, 'w-[64px] text-center')}
              aria-label="Auto-clear overlay after N seconds"
            />
            <span className="text-[12px] text-white/40">sec</span>
          </div>
        </PrefRow>
        <PrefRow label="Test" hint={testMsg || 'Sends John 3:16 to every screen that is on'}>
          <div className="flex items-center gap-1.5">
            <button
              className="btn-secondary inline-flex items-center gap-1.5 py-1 px-2.5 text-[12px]"
              onClick={() => void handleSendTest()}
              disabled={testStatus === 'testing'}
            >
              <Send size={12} aria-hidden="true" />
              Send
            </button>
            <button
              className="btn-secondary inline-flex items-center gap-1.5 py-1 px-2.5 text-[12px]"
              onClick={() => void handleClear()}
              disabled={testStatus === 'testing'}
            >
              <Trash2 size={12} aria-hidden="true" />
              Clear
            </button>
          </div>
        </PrefRow>
      </PrefGroup>

      <SaveBar sectionId="overlay" savedSection={savedSection} onSave={onSave} />
    </div>
  )
}

// ─── Section: General ─────────────────────────────────────────────────────────

// ─── Software update ──────────────────────────────────────────────────────────

const UPDATE_BTN =
  'inline-flex items-center gap-1.5 rounded-md bg-[#3a3a3a] px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-[#454545] disabled:cursor-default disabled:opacity-40'

/**
 * Reads 'idle' with no action in dev and in unpackaged builds, because the main
 * process refuses to check there — the row stays visible rather than vanishing,
 * so the version is always somewhere the operator can read it.
 */
function UpdateGroup(): React.ReactElement {
  const { status, busy, check, download, install } = useUpdates()

  const label = (() => {
    switch (status.state) {
      case 'checking':
        return 'Checking…'
      case 'available':
        return `Version ${status.version} is available`
      case 'downloading':
        return `Downloading${typeof status.percent === 'number' ? ` — ${status.percent}%` : '…'}`
      case 'downloaded':
        return `Version ${status.version} is ready — installs on the next quit`
      case 'error':
        return status.message
      default:
        return status.currentVersion ? `Kairo ${status.currentVersion} — up to date` : 'Up to date'
    }
  })()

  return (
    <PrefGroup title="Software update">
      <PrefRow label="Updates" hint={label}>
        {status.state === 'available' ? (
          <button className={UPDATE_BTN} onClick={() => void download()}>
            Download
          </button>
        ) : status.state === 'downloaded' ? (
          <button className={UPDATE_BTN} onClick={() => void install()}>
            Restart &amp; install
          </button>
        ) : (
          <button
            className={UPDATE_BTN}
            disabled={busy || status.state === 'checking' || status.state === 'downloading'}
            onClick={() => void check()}
          >
            Check now
          </button>
        )}
      </PrefRow>
    </PrefGroup>
  )
}

// ─── Section: General ─────────────────────────────────────────────────────────

/**
 * The Kairo workspace: one folder holding `Songs/` and `Media/`.
 *
 * Songs are files in that folder, so this panel is also where an operator
 * finds them in Finder, points the app at a different drive, or re-reads the
 * folder after editing files outside the app.
 */
function WorkspaceGroup(): React.ReactElement {
  const [info, setInfo] = useState<WorkspaceInfo | null>(null)
  const [migration, setMigration] = useState<MediaFolderMigration | null>(null)
  const [busy, setBusy] = useState<null | 'change' | 'resync' | 'adopt'>(null)
  const [note, setNote] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const [next, media] = await Promise.all([
      window.api.workspace.get(),
      window.api.workspace.mediaMigration(),
    ])
    setInfo(next)
    setMigration(media)
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const changeFolder = useCallback(async (move: boolean): Promise<void> => {
    setBusy('change')
    setNote(null)
    try {
      const next = await window.api.workspace.chooseFolder({ move })
      setInfo(next)
      await refresh()
      setNote(move ? 'Workspace moved.' : 'Workspace folder changed.')
    } catch (err) {
      setNote((err as Error).message)
    } finally {
      setBusy(null)
    }
  }, [refresh])

  const resync = useCallback(async (): Promise<void> => {
    setBusy('resync')
    try {
      const result = await window.api.workspace.resyncSongs()
      setNote(
        `Songs folder read — ${result.imported} in the library` +
        (result.removed ? `, ${result.removed} removed` : '') +
        (result.exported ? `, ${result.exported} written out` : '') + '.'
      )
    } catch (err) {
      setNote((err as Error).message)
    } finally {
      setBusy(null)
    }
  }, [])

  const adoptMedia = useCallback(async (move: boolean): Promise<void> => {
    setBusy('adopt')
    try {
      await window.api.workspace.adoptMedia({ move })
      await refresh()
      setNote(move ? 'Backgrounds moved into the workspace.' : 'Backgrounds folder switched to the workspace.')
    } catch (err) {
      setNote((err as Error).message)
    } finally {
      setBusy(null)
    }
  }, [refresh])

  return (
    <PrefGroup title="Storage">
      <PrefRow stacked label="Kairo folder" hint="Songs and backgrounds live here">
        <p className="break-all rounded-md bg-surface px-3 py-2 font-mono text-[11px] leading-snug text-white/70">
          {info?.root ?? 'Locating\u2026'}
        </p>
        {info && !info.ready && (
          <p className="text-[11px] text-red-400">
            This folder could not be created — {info.error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-secondary flex items-center gap-1.5 text-[12px]"
            onClick={() => void window.api.workspace.reveal()}
          >
            <FolderOpen size={13} /> Show folder
          </button>
          <button
            type="button"
            className="btn-secondary text-[12px]"
            onClick={() => void window.api.workspace.revealSongs()}
          >
            Open Songs
          </button>
          <button
            type="button"
            className="btn-secondary text-[12px]"
            disabled={busy !== null}
            onClick={() => void changeFolder(true)}
          >
            {busy === 'change' ? 'Moving\u2026' : 'Move\u2026'}
          </button>
          <button
            type="button"
            className="btn-secondary text-[12px]"
            disabled={busy !== null}
            onClick={() => void changeFolder(false)}
          >
            Point elsewhere…
          </button>
        </div>
        <p className="text-[11px] leading-snug text-white/40">
          <span className="text-white/60">Move</span> takes the songs and backgrounds with it.{' '}
          <span className="text-white/60">Point elsewhere</span> leaves the files behind and reads
          whatever is already in the new folder.
        </p>
      </PrefRow>

      <PrefRow
        label="Re-read Songs folder"
        hint="After adding, editing or deleting song files outside Kairo"
      >
        <button
          type="button"
          className="btn-secondary text-[12px]"
          disabled={busy !== null}
          onClick={() => void resync()}
        >
          {busy === 'resync' ? 'Reading\u2026' : 'Rescan'}
        </button>
      </PrefRow>

      {migration?.needed && (
        <PrefRow
          stacked
          label="Backgrounds are outside the Kairo folder"
          hint={
            migration.fileCount >= 0
              ? `${migration.currentFolder} \u2014 ${migration.fileCount} file${migration.fileCount === 1 ? '' : 's'}`
              : migration.currentFolder
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-primary text-[12px]"
              disabled={busy !== null}
              onClick={() => void adoptMedia(true)}
            >
              {busy === 'adopt' ? 'Moving\u2026' : 'Move them in'}
            </button>
            <button
              type="button"
              className="btn-secondary text-[12px]"
              disabled={busy !== null}
              onClick={() => void adoptMedia(false)}
            >
              Use the Kairo folder anyway
            </button>
            <button
              type="button"
              className="btn-secondary text-[12px]"
              onClick={() => setMigration(null)}
            >
              Keep as is
            </button>
          </div>
        </PrefRow>
      )}

      {note && <p className="px-3.5 pb-2 text-[11px] text-teal-400/80">{note}</p>}
    </PrefGroup>
  )
}

function GeneralSection({
  settings,
  update,
  onSave,
  savedSection,
}: {
  settings: AppSettings
  update: UpdateFn
  onSave: () => void
  savedSection: string | null
}) {
  const disp = settings.display
  const isDark = disp.theme === 'dark'

  return (
    <div className="space-y-5">
      <PrefGroup title="Appearance">
        <PrefRow
          label="Dark mode"
          hint={isDark ? 'Dim room lighting' : 'Bright rooms — easier to see during a service'}
        >
          <Toggle
            checked={isDark}
            onChange={(v) => update('display', { theme: v ? 'dark' : 'light' })}
          />
        </PrefRow>
        <PrefRow stacked label="Interface size">
          <div className="flex items-center gap-3">
            <Slider
              min={12}
              max={24}
              step={1}
              value={[disp.fontSize]}
              onValueChange={(next) => update('display', { fontSize: next[0] })}
              aria-label="UI font size"
              className="flex-1"
            />
            <span className="w-9 text-right text-[12px] font-mono tabular-nums text-white/50">
              {disp.fontSize}
            </span>
          </div>
        </PrefRow>
        <PrefRow stacked label="Transcription size" hint="Live transcript during a service">
          <div className="flex items-center gap-3">
            <Slider
              min={12}
              max={48}
              step={1}
              value={[disp.transcriptionFontSize]}
              onValueChange={(next) => update('display', { transcriptionFontSize: next[0] })}
              aria-label="Transcription display size"
              className="flex-1"
            />
            <span className="w-9 text-right text-[12px] font-mono tabular-nums text-white/50">
              {disp.transcriptionFontSize}
            </span>
          </div>
        </PrefRow>
      </PrefGroup>

      <PrefGroup title="Lyrics">
        <PrefRow stacked label="Gloss color" hint="Parenthetical translation lines">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={
                /^#[0-9a-fA-F]{6}$/.test(settings.lyrics?.glossColor || '')
                  ? settings.lyrics.glossColor
                  : '#D4A017'
              }
              onChange={(e) => update('lyrics', { glossColor: e.target.value.toUpperCase() })}
              className="h-7 w-9 cursor-pointer rounded border border-white/10 bg-transparent p-0.5"
              aria-label="Gloss color"
            />
            <input
              type="text"
              value={settings.lyrics?.glossColor || '#D4A017'}
              onChange={(e) => update('lyrics', { glossColor: e.target.value })}
              placeholder="#D4A017"
              className={cn(PREF_INPUT, 'flex-1 text-left')}
              aria-label="Gloss color hex"
            />
          </div>
          <div className="rounded-md bg-black px-3 py-3 text-center">
            <p className="text-[13px] font-medium leading-snug text-white">
              Onye nke di ike n&apos;aka Ya
            </p>
            <p
              className="mt-1 text-[12px] italic leading-snug"
              style={{
                color: /^#[0-9a-fA-F]{6}$/.test(settings.lyrics?.glossColor || '')
                  ? settings.lyrics.glossColor
                  : '#D4A017',
              }}
            >
              (The arm of the Lord does great things)
            </p>
          </div>
        </PrefRow>
      </PrefGroup>

      <WorkspaceGroup />

      <UpdateGroup />

      <SaveBar sectionId="general" savedSection={savedSection} onSave={onSave} />
    </div>
  )
}

// ─── Main Settings export ─────────────────────────────────────────────────────

export default function Settings({
  onClose,
  initialSection = 'propresenter',
}: { onClose?: () => void; initialSection?: Section } = {}): React.ReactElement {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [activeSection, setActiveSection] = useState<Section>(initialSection)
  const [savedSection, setSavedSection] = useState<string | null>(null)
  const [navQuery, setNavQuery] = useState('')
  const [, setAudioLevel] = useState<AudioLevel | null>(null)
  const [histIndex, setHistIndex] = useState(0)
  const historyRef = useRef<Section[]>([initialSection])
  const session = useAccountStore((s) => s.session)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Settings arrive with the startup snapshot; refresh from main so secret
  // configured-flags are current (vault pull / saves may have landed since boot).
  useEffect(() => {
    let cancelled = false
    const apply = (stored: typeof DEFAULT_SETTINGS) => {
      if (cancelled) return
      useBootstrapStore.getState().setSettings(stored)
      setSettings((prev) => ({
        propresenter: { ...prev.propresenter, ...stored.propresenter },
        audio: { ...prev.audio, ...stored.audio },
        stt: { ...prev.stt, ...stored.stt },
        scripture: { ...prev.scripture, ...stored.scripture },
        lyrics: { ...prev.lyrics, ...stored.lyrics },
        display: { ...prev.display, ...stored.display },
        overlay: normalizeOverlaySettings({ ...prev.overlay, ...stored.overlay }),
        themeLibrary: stored.themeLibrary ?? prev.themeLibrary,
        workspace: { ...prev.workspace, ...stored.workspace },
        media: { ...prev.media, ...stored.media },
        tracks: { ...prev.tracks, ...stored.tracks },
        church: { ...prev.church, ...stored.church },
        documents: { ...prev.documents, ...stored.documents },
        propresenterResources: { ...prev.propresenterResources, ...stored.propresenterResources },
        presentation: normalizePresentationSettings(stored.presentation ?? prev.presentation),
      }))
      setLoading(false)
    }

    apply(useBootstrapStore.getState().settings)
    return () => {
      cancelled = true
    }
  }, [])

  // Every save publishes to the shared snapshot so other screens (and a later
  // remount of this one) never fall back to startup values.
  const publish = useCallback(<K extends keyof AppSettings>(section: K, value: AppSettings[K]) => {
    useBootstrapStore.getState().patchSettings(section, value)
  }, [])

  // Subscribe to audio level push events
  useEffect(() => {
    const unsub = window.api.audio.onLevel((level) => setAudioLevel(level))
    return unsub
  }, [])

  // Generic updater — merges partial into a section of settings
  const update = useCallback(<K extends keyof AppSettings>(
    section: K,
    partial: Partial<AppSettings[K]>
  ) => {
    if (section === 'display' && 'theme' in partial && partial.theme) {
      applyAppTheme(partial.theme as AppSettings['display']['theme'])
    }

    setSettings((prev) => {
      const nextSection = { ...prev[section], ...partial }

      // Theme + gloss color apply immediately (persist + publish), like a live control.
      if (section === 'display' && 'theme' in partial && partial.theme) {
        void window.api.settings.set('display', nextSection as AppSettings['display'])
      }
      if (section === 'lyrics' && 'glossColor' in (partial as object)) {
        const gloss = (nextSection as AppSettings['lyrics']).glossColor
        if (typeof gloss === 'string' && /^#[0-9a-fA-F]{6}$/.test(gloss.trim())) {
          useBootstrapStore.getState().patchSettings('lyrics', nextSection as AppSettings['lyrics'])
          void window.api.settings.set('lyrics', nextSection as AppSettings['lyrics'])
        }
      }

      return {
        ...prev,
        [section]: nextSection,
      }
    })
  }, [])

  // Show saved feedback for 2s
  const showSaved = useCallback((id: string) => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    setSavedSection(id)
    savedTimerRef.current = setTimeout(() => setSavedSection(null), 2000)
  }, [])

  // Per-section save handlers. Account has none: it writes through the cloud
  // service as things happen, so there is nothing to batch behind a Save.
  const saves: Record<Section, () => void> = {
    account: () => {},
    shortcuts: () => {},
    propresenter: () => {
      publish('propresenter', settings.propresenter)
      window.api.settings.set('propresenter', settings.propresenter).then(() => showSaved('propresenter'))
    },
    audio: () => {
      publish('audio', settings.audio)
      window.api.settings.set('audio', settings.audio).then(() => showSaved('audio'))
    },
    apikeys: () => {
      // ApiKeysSection owns save (drafts + clearKeys). Keep a no-op for the map.
    },
    scripture: () => {
      publish('scripture', settings.scripture)
      window.api.settings.set('scripture', settings.scripture).then(() => showSaved('scripture'))
    },
    overlay: () => {
      // Send only the phase-1 fields this modal edits — main merges onto the
      // freshly-read stored overlay, so this stale copy can't clobber the Theme
      // page's mode/theme or the ppVideoInputUuid the orchestrator persists.
      const o = settings.overlay
      publish('overlay', settings.overlay)
      window.api.settings
        .set('overlay', {
          template: o.template,
          showTranslation: o.showTranslation,
          showVerseNumbers: o.showVerseNumbers,
          maxVerses: o.maxVerses,
          autoClearSec: o.autoClearSec,
        })
        .then(() => showSaved('overlay'))
    },
    general: () => {
      publish('display', settings.display)
      publish('lyrics', settings.lyrics)
      Promise.all([
        window.api.settings.set('display', settings.display),
        window.api.settings.set('lyrics', settings.lyrics),
      ]).then(() => showSaved('general'))
    },
  }

  const selectSection = useCallback((id: Section) => {
    setActiveSection(id)
    const hist = historyRef.current
    if (hist[histIndex] === id) return
    const next = [...hist.slice(0, histIndex + 1), id]
    historyRef.current = next
    setHistIndex(next.length - 1)
  }, [histIndex])

  const goHistory = (delta: -1 | 1): void => {
    const next = histIndex + delta
    if (next < 0 || next >= historyRef.current.length) return
    setHistIndex(next)
    setActiveSection(historyRef.current[next])
  }

  const query = navQuery.trim().toLowerCase()
  const navItems = SECTION_NAV.filter((item) => {
    if (item.id === 'account' && !query) return false
    if (!query) return true
    return `${item.label} ${item.hint}`.toLowerCase().includes(query)
  })
  const currentNav = SECTION_NAV.find((s) => s.id === activeSection) ?? SECTION_NAV[0]
  const firstIntegration = navItems.find((item) => INTEGRATION_SECTIONS.has(item.id))?.id
  const displayName = session.user?.name?.trim() || 'Account'
  const displayMeta = session.org?.name || session.user?.email || 'Signed in'
  const canBack = histIndex > 0
  const canForward = histIndex < historyRef.current.length - 1

  return (
    <div className="kairo-pp-settings flex h-full w-full overflow-hidden rounded-xl bg-[#1e1e1e] text-white">
      <aside data-settings-drag className="flex w-[212px] shrink-0 flex-col bg-[#323232]">
        <MacTrafficLights onClose={onClose} />

        <div className="px-3 pb-2.5">
          <label className="flex h-8 items-center gap-1.5 rounded-md bg-[#1c1c1c] px-2">
            <Search size={11} className="shrink-0 text-white/35" aria-hidden="true" />
            <input
              value={navQuery}
              onChange={(e) => setNavQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search settings"
              className="w-full bg-transparent text-[12px] text-white outline-none placeholder:text-white/35"
            />
          </label>
        </div>

        <button
          type="button"
          onClick={() => selectSection('account')}
          className={cn(
            'mx-2 mb-2 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left',
            activeSection === 'account' ? 'bg-[#454545]' : 'hover:bg-surface-tertiary',
          )}
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#E07A3D] text-[11px] font-semibold text-white">
            {accountInitials(session.user?.name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium leading-tight text-white">
              {displayName}
            </span>
            <span className="block truncate text-[11px] leading-tight text-white/45">
              {displayMeta}
            </span>
          </span>
        </button>

        <nav className="min-h-0 flex-1 space-y-[1px] overflow-y-auto px-2 pb-3">
          {navItems.length === 0 ? (
            <p className="px-2 py-3 text-[12px] text-white/35">No matches</p>
          ) : (
            navItems.map(({ id, label, hint, icon }) => {
              const active = activeSection === id
              return (
                <Fragment key={id}>
                {id === firstIntegration && (
                  <p className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/35">
                    Integrations
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => selectSection(id)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-[13px] text-white',
                    active ? 'bg-[#454545]' : 'hover:bg-surface-tertiary',
                  )}
                  aria-current={active ? 'page' : undefined}
                  aria-label={`${label} settings: ${hint}`}
                >
                  <span
                    className={cn(
                      'grid h-[18px] w-[18px] shrink-0 place-items-center rounded-md text-white',
                      NAV_ICON_BG[id],
                    )}
                  >
                    <SectionGlyph section={id} icon={icon} size={11} className="text-white" />
                  </span>
                  <span className="min-w-0 truncate">{label}</span>
                </button>
                </Fragment>
              )
            })
          )}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col bg-[#1e1e1e]">
        <header data-settings-drag className="flex shrink-0 items-center gap-0.5 border-b border-white/[0.06] px-4 py-4">
          <button
            type="button"
            aria-label="Back"
            disabled={!canBack}
            onClick={() => goHistory(-1)}
            className="grid h-6 w-6 place-items-center rounded text-white/50 hover:bg-surface-elevated disabled:opacity-25"
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Forward"
            disabled={!canForward}
            onClick={() => goHistory(1)}
            className="grid h-6 w-6 place-items-center rounded text-white/50 hover:bg-surface-elevated disabled:opacity-25"
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
          <h1 className="ml-1 text-[15px] font-semibold tracking-tight text-white">{currentNav.label}</h1>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-5">
          <div className="space-y-5">
            {loading ? (
              <div className="flex items-center gap-3 pt-8 text-white/40">
                <Loader size={16} className="animate-spin" />
                <span className="text-sm">Loading settings…</span>
              </div>
            ) : (
              <>
                {activeSection === 'propresenter' && (
                  <>
                    <PropresenterSwitch
                      settings={settings}
                      onChange={(next) => {
                        update('propresenter', { enabled: next.enabled })
                        publish('propresenter', next)
                      }}
                    />
                    {propresenterEnabled(settings) && (<>
                    <SettingsDivider />
                    <ConnectionSection
                      settings={settings}
                      update={update}
                      onSave={saves.propresenter}
                      savedSection={savedSection}
                    />
                    <SettingsDivider />
                    <PrefGroup title="Messages layer">
                      <PrefPad>
                        <p className="text-[12px] leading-relaxed text-white/45">
                          What Kairo sends to ProPresenter — library matches, the Messages layer and
                          stage messages, and their text templates — is set up in{' '}
                          <button
                            type="button"
                            className="text-teal-400 hover:underline"
                            onClick={() => {
                              onClose?.()
                              useAppStore.getState().openScreens()
                            }}
                          >
                            Screens
                          </button>
                          . To style the Messages layer:
                        </p>
                        <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-[12px] leading-relaxed text-white/45">
                          <li>Open Messages in ProPresenter.</li>
                          <li>Edit “Kairo Scripture” → Theme.</li>
                          <li>One full-width text box, lower-third or centered, dark backdrop.</li>
                          <li>Use Test verse in Screens while you style it.</li>
                        </ol>
                      </PrefPad>
                    </PrefGroup>
                    <SettingsDivider />
                    <ResourceCatalogue mode="settings" />
                    </>)}
                  </>
                )}
                {activeSection === 'audio' && (
                  <AudioSection
                    settings={settings}
                    update={update}
                    onSave={saves.audio}
                    savedSection={savedSection}
                  />
                )}
                {activeSection === 'shortcuts' && <KeyboardShortcutsSection bindings={settings.display.shortcuts ?? {}} onSave={async (shortcuts) => {
                  const display = { ...settings.display, shortcuts }
                  await window.api.settings.set('display', display)
                  update('display', { shortcuts })
                  publish('display', display)
                }} />}
                {activeSection === 'apikeys' && (
                  <ApiKeysSection
                    settings={settings}
                    update={update}
                    onSaveComplete={() => showSaved('apikeys')}
                    savedSection={savedSection}
                  />
                )}
                {activeSection === 'scripture' && (
                  <ScriptureSection
                    settings={settings}
                    update={update}
                    onSave={saves.scripture}
                    savedSection={savedSection}
                  />
                )}
                {activeSection === 'overlay' && (
                  <OverlaySection
                    settings={settings}
                    update={update}
                    onSave={saves.overlay}
                    savedSection={savedSection}
                  />
                )}
                {activeSection === 'account' && (
                  <AccountSection
                    onRunSetup={() => {
                      void window.api.onboarding.reset().then((state) => {
                        useBootstrapStore.getState().setOnboarding(state)
                        onClose?.()
                      })
                    }}
                  />
                )}
                {activeSection === 'general' && (
                  <GeneralSection
                    settings={settings}
                    update={update}
                    onSave={saves.general}
                    savedSection={savedSection}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
