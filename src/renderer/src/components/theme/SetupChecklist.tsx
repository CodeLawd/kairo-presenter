import { useCallback, useState } from 'react'
import { AlertCircle, Check, CircleDashed, Loader, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { findNdiOutput } from '@shared/overlay-outputs'
import type { NdiStatus, OverlayOutput, PPLook } from '@shared/ipc'

// ─── Manual acknowledgements ───────────────────────────────────────────────────
// Some steps happen entirely inside ProPresenter and the API exposes nothing to
// check them against — how many screens exist, whether a stage layout contains a
// Message field. Those cannot be verified, only confirmed by the person who did
// them, so they are checkboxes rather than fake green ticks.
//
// Stored in localStorage, not settings: "I have configured the screens on THIS
// machine's ProPresenter" is per-machine, and it must never sync anywhere.

const ACK_KEY = 'pa-setup-acks'

function readAcks(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(ACK_KEY)
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

function useAcks(): [Record<string, boolean>, (id: string, value: boolean) => void] {
  const [acks, setAcks] = useState<Record<string, boolean>>(readAcks)

  const setAck = useCallback((id: string, value: boolean) => {
    setAcks((current) => {
      const next = { ...current, [id]: value }
      try {
        window.localStorage.setItem(ACK_KEY, JSON.stringify(next))
      } catch {
        // A blocked localStorage costs the memory of the tick, nothing more.
      }
      return next
    })
  }, [])

  return [acks, setAck]
}

// ─── Steps ─────────────────────────────────────────────────────────────────────

type StepState = 'ok' | 'blocked' | 'todo' | 'manual' | 'skipped'

interface Step {
  id: string
  label: string
  /** What to do about it — shown only when the step is not satisfied. */
  hint: string
  state: StepState
  /** Manual steps carry a checkbox instead of a derived indicator. */
  manual?: boolean
}

interface SetupChecklistProps {
  ppConnected: boolean
  ndiStatus: NdiStatus
  outputs: OverlayOutput[]
  looks: PPLook[]
  onSendTest: () => void
  testStatus: 'idle' | 'testing' | 'ok' | 'fail'
  testMsg: string
}

export default function SetupChecklist({
  ppConnected,
  ndiStatus,
  outputs,
  looks,
  onSendTest,
  testStatus,
  testMsg,
}: SetupChecklistProps): React.ReactElement {
  const [acks, setAck] = useAcks()

  const enabled = outputs.filter((o) => o.enabled)
  const ndiOutput = findNdiOutput(outputs)
  const ndiEnabled = !!ndiOutput?.enabled
  const stageEnabled = enabled.some((o) => o.kind === 'stage')
  const messageEnabled = enabled.some((o) => o.kind === 'message')

  const manual = (id: string): StepState => (acks[id] ? 'ok' : 'manual')

  const steps: Step[] = [
    {
      id: 'pp',
      label: 'ProPresenter connected',
      hint: 'Check the host and port in Settings → ProPresenter.',
      state: ppConnected ? 'ok' : 'blocked',
    },
    {
      id: 'screens',
      label: 'Screens configured in ProPresenter',
      hint: 'Screens → Screen Configuration: add an Audience screen for the main output, and a Stage screen for the pastor. ProPresenter owns this — the app cannot see it.',
      state: manual('screens'),
      manual: true,
    },
    {
      id: 'outputs',
      label: 'At least one output enabled',
      hint: 'Turn on a destination in the list below.',
      state: enabled.length > 0 ? 'ok' : 'todo',
    },
  ]

  // NDI steps only matter to someone actually using the rendered slide.
  if (ndiEnabled) {
    steps.push(
      {
        id: 'ndi-sender',
        label: 'NDI sender running',
        hint: 'The NDI runtime failed to load or the sender could not start — check the logs. Other outputs still work.',
        state: ndiStatus.available && ndiStatus.sending ? 'ok' : 'blocked',
      },
      {
        id: 'ndi-input',
        label: 'ProPresenter video input bound',
        hint: 'Add a Video Input in ProPresenter pointed at the “ProAutomate Scripture” NDI source, then pick it below. ProPresenter labels inputs “Input 1”, “Input 2” — it never shows the NDI source name, so you have to know which one you made.',
        state: ndiStatus.ppInputConfigured ? 'ok' : 'todo',
      },
    )
  }

  if (stageEnabled) {
    steps.push({
      id: 'stage-layout',
      label: 'Stage layout has a Message field',
      hint: 'In ProPresenter, edit the stage screen’s layout and add a Message field. Without it the stage text has nowhere to appear, and nothing reports an error.',
      state: manual('stage-layout'),
      manual: true,
    })
  }

  if (messageEnabled) {
    steps.push({
      id: 'message-look',
      label: 'Messages layer visible on the right screens',
      hint: 'A Look controls which screens show the Messages layer. Set one up in ProPresenter so the lower third lands where you want it — and not on the main screen if that is showing the full-screen slide.',
      state: manual('message-look'),
      manual: true,
    })
  }

  steps.push({
    id: 'look',
    label: 'Look triggered on push (optional)',
    hint: looks.length > 0
      ? 'Optional. Set “Trigger Look” on an output to have ProPresenter switch Looks automatically when a verse goes out.'
      : 'Optional, and ProPresenter is reporting no Looks yet. Create one there to control which layers each screen shows.',
    state: enabled.some((o) => o.lookId) ? 'ok' : 'skipped',
  })

  const blocking = steps.filter((s) => s.state === 'blocked' || s.state === 'todo').length
  const pendingManual = steps.filter((s) => s.state === 'manual').length
  const ready = blocking === 0

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
            ready ? 'bg-teal-500/15 text-teal-300' : 'bg-amber-500/15 text-amber-300',
          )}
        >
          {ready ? 'Ready to send' : `${blocking} to fix`}
        </span>
        {pendingManual > 0 && (
          <span className="text-[10px] text-slate-500">
            {pendingManual} to confirm in ProPresenter
          </span>
        )}
      </div>

      <ol className="space-y-1.5">
        {steps.map((step) => (
          <StepRow
            key={step.id}
            step={step}
            onToggle={step.manual ? (value) => setAck(step.id, value) : undefined}
          />
        ))}
      </ol>

      <div className="flex items-center gap-2 border-t border-surface-border/60 pt-3">
        <button
          type="button"
          className="btn-secondary px-3 py-1.5 text-[11px] disabled:opacity-40"
          onClick={onSendTest}
          disabled={!ppConnected || testStatus === 'testing'}
        >
          {testStatus === 'testing' ? 'Sending…' : 'Send test verse'}
        </button>
        {testStatus !== 'idle' && (
          <span
            className={cn(
              'flex items-center gap-1 text-[10px]',
              testStatus === 'testing' && 'text-yellow-400',
              testStatus === 'ok' && 'text-teal-400',
              testStatus === 'fail' && 'text-red-400',
            )}
          >
            {testStatus === 'testing' && <Loader size={10} className="animate-spin" aria-hidden="true" />}
            {testMsg}
          </span>
        )}
      </div>
      <p className="text-[10px] leading-snug text-slate-600">
        A test verse fires every enabled output at once — walk the building and check each screen.
      </p>
    </div>
  )
}

function StepRow({
  step,
  onToggle,
}: {
  step: Step
  onToggle?: (value: boolean) => void
}): React.ReactElement {
  const done = step.state === 'ok'
  const showHint = !done && step.state !== 'skipped'

  const body = (
    <>
      <StepIcon state={step.state} />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'text-[11px] font-semibold',
            done && 'text-slate-400',
            step.state === 'blocked' && 'text-red-300',
            step.state === 'todo' && 'text-amber-300',
            step.state === 'manual' && 'text-slate-200',
            step.state === 'skipped' && 'text-slate-500',
          )}
        >
          {step.label}
        </span>
        {showHint && (
          <span className="mt-0.5 block text-[10px] leading-snug text-slate-500">{step.hint}</span>
        )}
      </span>
    </>
  )

  // Manual steps are the only interactive rows — everything else is derived, so
  // making it clickable would imply the operator can tick away a real failure.
  if (onToggle) {
    return (
      <li>
        <button
          type="button"
          onClick={() => onToggle(step.state !== 'ok')}
          aria-pressed={done}
          className="flex w-full items-start gap-2 rounded-lg p-1 text-left transition-colors hover:bg-surface-secondary/50"
        >
          {body}
        </button>
      </li>
    )
  }

  return <li className="flex items-start gap-2 p-1">{body}</li>
}

function StepIcon({ state }: { state: StepState }): React.ReactElement {
  const shared = 'mt-px shrink-0'
  if (state === 'ok') return <Check size={12} className={cn(shared, 'text-teal-400')} aria-label="done" />
  if (state === 'blocked') return <X size={12} className={cn(shared, 'text-red-400')} aria-label="blocked" />
  if (state === 'todo') {
    return <AlertCircle size={12} className={cn(shared, 'text-amber-400')} aria-label="to do" />
  }
  return <CircleDashed size={12} className={cn(shared, 'text-slate-500')} aria-label="not confirmed" />
}
