import { Check, Circle, CircleDashed, Loader, X } from '@/icons'
import { cn } from '@/lib/utils'
import { findNdiOutput, isRenderedKind } from '@shared/overlay-outputs'
import type { NdiStatus, OverlayOutput } from '@shared/ipc'

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
  ndiStatus: NdiStatus
  outputs: OverlayOutput[]
  onSendTest: () => void
  testStatus: 'idle' | 'testing' | 'ok' | 'fail'
  testMsg: string
}

export default function SetupChecklist({
  ndiStatus,
  outputs,
  onSendTest,
  testStatus,
  testMsg,
}: SetupChecklistProps): React.ReactElement {

  const enabled = outputs.filter((o) => o.enabled)
  const ndiOutput = findNdiOutput(outputs)
  const ndiEnabled = !!ndiOutput?.enabled
  const readiness = (id: string) => ndiStatus.outputs.find((o) => o.id === id)
  // A video card only counts once it can take a picture — without a driver it never will.
  const rendered = enabled.filter((o) => isRenderedKind(o.kind) && (o.kind !== 'device' || readiness(o.id)?.ready))

  // Check configured Kairo outputs and their runtime readiness.
  const steps: Step[] = [
    {
      id: 'outputs',
      label: 'A screen is on',
      hint: 'Add a Kairo screen, video card or NDI feed in the Screens list and turn it on.',
      state: rendered.length > 0 ? 'ok' : 'todo',
    },
  ]

  for (const screen of enabled.filter((o) => o.kind === 'screen')) {
    const state = readiness(screen.id)
    steps.push({
      id: `screen-${screen.id}`,
      label: `${screen.name} is on its display`,
      hint: state?.reason ? `${state.reason}. Pick a connected display for it.` : 'Pick a connected display for it.',
      state: state?.ready ? 'ok' : 'todo',
    })
  }

  if (ndiEnabled) {
    steps.push({
      id: 'ndi-sender',
      label: 'NDI sender running',
      hint: 'The NDI runtime failed to load or the sender could not start — check the logs. Other screens still work.',
      state: ndiStatus.available && ndiStatus.sending ? 'ok' : 'blocked',
    })
  }

  const blocking = steps.filter((s) => s.state === 'blocked' || s.state === 'todo').length
  const ready = blocking === 0

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-slate-400">
        {ready ? 'Everything is ready.' : `${blocking} ${blocking === 1 ? 'thing' : 'things'} to fix.`}
      </p>

      <ol className="space-y-1">
        {steps.map((step) => (
          <StepRow
            key={step.id}
            step={step}
          />
        ))}
      </ol>

      <div className="flex items-center gap-3">
        <button
          type="button"
          className="btn-secondary px-3 py-1.5 text-[12px] disabled:opacity-40"
          onClick={onSendTest}
          disabled={testStatus === 'testing'}
        >
          {testStatus === 'testing' ? 'Sending…' : 'Send test verse'}
        </button>
        {testStatus !== 'idle' && (
          <span
            className={cn(
              'flex items-center gap-1 text-[11px]',
              testStatus === 'fail' ? 'text-red-400' : 'text-slate-400',
            )}
          >
            {testStatus === 'testing' && <Loader size={11} className="animate-spin" aria-hidden="true" />}
            {testMsg}
          </span>
        )}
      </div>
      <p className="text-[11px] leading-snug text-slate-500">
        Sends to every screen at once, so you can walk the room and check each one.
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
        <span className={cn('block text-[12px]', done || step.state === 'skipped' ? 'text-slate-500' : 'text-slate-100')}>
          {step.label}
        </span>
        {showHint && (
          <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{step.hint}</span>
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
          className="flex w-full items-start gap-3 rounded-lg bg-surface-secondary px-3 py-2.5 text-left transition-colors hover:bg-surface-tertiary"
        >
          {body}
        </button>
      </li>
    )
  }

  return <li className="flex items-start gap-3 rounded-lg bg-surface-secondary px-3 py-2.5">{body}</li>
}

function StepIcon({ state }: { state: StepState }): React.ReactElement {
  const shared = 'mt-0.5 shrink-0'
  if (state === 'ok') return <Check size={13} className={cn(shared, 'text-slate-500')} aria-label="done" />
  if (state === 'blocked') return <X size={13} className={cn(shared, 'text-red-400')} aria-label="blocked" />
  if (state === 'todo') return <Circle size={13} className={cn(shared, 'text-slate-300')} aria-label="to do" />
  return <CircleDashed size={13} className={cn(shared, 'text-slate-500')} aria-label="not confirmed" />
}
