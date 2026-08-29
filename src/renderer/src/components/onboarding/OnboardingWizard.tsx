import { useCallback, useEffect, useState } from 'react'
import type { OnboardingState } from '@shared/ipc'
import { ONBOARDING_STEPS, isStepComplete } from '@shared/cloud/onboarding'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'
import StepAccount from './StepAccount'
import StepApiKeys from './StepApiKeys'
import StepChurchProfile from './StepChurchProfile'
import StepDone from './StepDone'
import StepOutput from './StepOutput'
import StepProPresenter from './StepProPresenter'

/**
 * First-run setup. An overlay above the shell — never a route — so the app
 * underneath keeps its live state and the wizard can be left at any point.
 *
 * Deliberately quiet: one hairline of progress, one primary action, and no
 * step-picker. An operator meeting this screen has not learned the app yet, so
 * every control that is not the next thing to do is noise.
 *
 * Every exit path is honoured immediately: Escape, "Finish later", and the last
 * step's Finish all close it for good. Setup must never be something an
 * operator has to fight their way out of ten minutes before a service.
 */
export default function OnboardingWizard({
  onDismiss,
}: {
  onDismiss: () => void
}): React.ReactElement {
  const settings = useBootstrapStore((s) => s.settings)
  const state = useBootstrapStore((s) => s.onboarding)
  const setOnboarding = useBootstrapStore((s) => s.setOnboarding)
  const [busy, setBusy] = useState(false)
  // The closing screen is a view, not a step: it is not something to answer, so
  // it stays out of the step list, the progress rail and the saved state.
  const [showDone, setShowDone] = useState(false)

  const current = state.currentStep
  const index = Math.max(0, ONBOARDING_STEPS.indexOf(current))
  const total = ONBOARDING_STEPS.length
  const isLast = index === total - 1
  const done = isStepComplete(current, settings)

  const apply = useCallback(
    async (run: () => Promise<OnboardingState>): Promise<OnboardingState | null> => {
      setBusy(true)
      try {
        const next = await run()
        setOnboarding(next)
        return next
      } catch {
        // A failed write must not trap the operator inside the wizard.
        return null
      } finally {
        setBusy(false)
      }
    },
    [setOnboarding],
  )

  const finish = useCallback(async (): Promise<void> => {
    await apply(() => window.api.onboarding.finish())
    onDismiss()
  }, [apply, onDismiss])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') void finish()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [finish])

  /**
   * Records how this step was answered, then moves exactly one step along —
   * never to "the first unanswered step". Walking back to an earlier screen and
   * pressing Continue must show the next screen in order, not skip ahead past
   * everything already answered.
   *
   * One button, not a Next/Skip pair: whether the step counts as done is read
   * off the settings the operator did or did not fill in, so making them also
   * declare it would be asking the same question twice.
   */
  const advance = async (): Promise<void> => {
    await apply(() =>
      done ? window.api.onboarding.completeStep(current) : window.api.onboarding.skipStep(current),
    )
    if (isLast) {
      // Setup ending by the dialog simply disappearing leaves the operator
      // unsure anything was kept. Show what was set up, and let them leave.
      setShowDone(true)
      return
    }
    void apply(() => window.api.onboarding.setCurrentStep(ONBOARDING_STEPS[index + 1]))
  }

  const back = (): void => {
    if (index === 0) return
    void apply(() => window.api.onboarding.setCurrentStep(ONBOARDING_STEPS[index - 1]))
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      data-onboarding-wizard="true"
    >
      <div className="flex min-h-[27rem] w-[520px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-surface-border/60 bg-surface shadow-2xl animate-spring-in">
        {/* Progress is a hairline, not a widget — it answers "how much longer"
            and nothing else. */}
        <div className="h-[2px] w-full bg-surface-border/50" aria-hidden="true">
          <div
            className="h-full bg-teal-500 transition-[width] duration-300 ease-out-expo"
            style={{ width: showDone ? '100%' : `${((index + 1) / total) * 100}%` }}
          />
        </div>

        <div className="flex flex-1 flex-col px-8 pb-6 pt-7">
          <p
            id="onboarding-title"
            className="text-[11px] font-medium uppercase tracking-[0.1em] text-slate-600"
          >
            {showDone ? 'Setup complete' : `Setup · ${index + 1} of ${total}`}
          </p>

          <div className="mt-5 flex flex-1 flex-col">
            {showDone && <StepDone onStart={() => void finish()} busy={busy} />}
            {!showDone && current === 'account' && <StepAccount />}
            {!showDone && current === 'propresenter' && (
              <StepProPresenter
                onConnected={() => void apply(() => window.api.onboarding.completeStep('propresenter'))}
              />
            )}
            {!showDone && current === 'output' && <StepOutput />}
            {!showDone && current === 'apiKeys' && <StepApiKeys />}
            {!showDone && current === 'church' && <StepChurchProfile />}
          </div>

          {!showDone && (
          <div className="mt-8 flex items-center justify-between gap-4">
            <button
              type="button"
              className="text-[12px] text-slate-600 transition-colors hover:text-slate-300 focus-visible:outline-none focus-visible:text-slate-300"
              onClick={() => void finish()}
            >
              Finish later
            </button>

            <div className="flex items-center gap-4">
              {index > 0 && (
                <button
                  type="button"
                  className="text-[12px] text-slate-500 transition-colors hover:text-slate-300 disabled:opacity-40 focus-visible:outline-none focus-visible:text-slate-300"
                  onClick={back}
                  disabled={busy}
                >
                  Back
                </button>
              )}
              <button
                type="button"
                className="btn-primary min-w-[7rem]"
                onClick={() => void advance()}
                disabled={busy}
              >
                {isLast ? 'Finish' : 'Continue'}
              </button>
            </div>
          </div>
          )}
        </div>
      </div>
    </div>
  )
}
