import StepShell from './StepShell'

/**
 * Placeholder until accounts ship (phase 2).
 *
 * The step exists now so the wizard's shape — and the operator's muscle memory
 * — does not change the day sign-in arrives. Nothing here blocks: everything
 * ProAutomate does today works with no account at all.
 */
export default function StepAccount(): React.ReactElement {
  return (
    <StepShell
      title="Welcome to ProAutomate"
      blurb="Four short steps and you are ready to put scripture on the wall. Skip anything you would rather set up later."
    >
      <p className="max-w-[46ch] text-[13px] leading-relaxed text-slate-500">
        Accounts and team sharing are on the way. For now everything stays on this machine — and it
        will keep working when the internet does not.
      </p>
    </StepShell>
  )
}
