import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { OnboardingState, OnboardingStepId } from '@shared/ipc'
import { canEnterApp } from '@shared/cloud/auth-state'
import { isStepComplete, onboardingSteps } from '@shared/cloud/onboarding'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'
import { useAccountStore } from '@/stores/useAccountStore'
import { useAppStore } from '@/stores/useAppStore'
import { KairoMark } from '@/components/brand/KairoMark'
import { ChevronLeft } from '@/icons'
import StepAccount from './StepAccount'
import StepOutput from './StepOutput'
import { LOCAL_ZONE } from './church-options'
import { TOUR_SLIDES, TourStage } from './TourSlides'
import WelcomeView from './WelcomeView'
import type { NavRoute } from '@/App'
import type { AuthMode } from '@/components/account/AuthPanel'

/** Footer back-link names, as in ProPresenter: "‹ Welcome", "‹ Screen Configuration". */
const STEP_NAMES: Partial<Record<OnboardingStepId, string>> = {
  welcome: 'Welcome',
  account: 'Account',
  output: 'Screen Configuration',
}

/**
 * First-run setup, once per install, modelled on ProPresenter's welcome window:
 * the tour (`welcome`), then the account — created here on a first launch, so
 * the operator knows what Kairo is before being asked to sign up — then this
 * computer's screens, then the closing welcome. Shown signed out; `App` keeps it
 * mounted across sign-in so the flow carries on rather than restarting.
 */
export default function OnboardingWizard({ onDismiss }: {
  /** Close setup; `route` opens a workspace, `coach: false` skips the tips that follow. */
  onDismiss: (route?: NavRoute, options?: { coach?: boolean }) => void
}): React.ReactElement {
  const settings = useBootstrapStore((s) => s.settings)
  const state = useBootstrapStore((s) => s.onboarding)
  const setOnboarding = useBootstrapStore((s) => s.setOnboarding)
  const accountReady = useAccountStore((s) => canEnterApp(s.session))
  const orgName = useAccountStore((s) => s.session.org?.name ?? '')
  const [busy, setBusy] = useState(false)
  const [savingScreen, setSavingScreen] = useState(false)
  const [error, setError] = useState('')
  const [slide, setSlide] = useState(0)
  // Direction of travel for slide and page transitions: 1 forward, -1 back.
  const [dir, setDir] = useState<1 | -1>(1)
  // Setup is saved as finished; the closing welcome is on screen.
  const [welcomed, setWelcomed] = useState(false)
  // A first launch most likely needs a new account; the tour's "Sign in" link
  // and the form's own toggle switch it.
  const [authMode, setAuthMode] = useState<AuthMode>('signUp')
  const dialog = useRef<HTMLDivElement>(null)
  const pending = useRef(false)
  const steps = onboardingSteps(settings)
  const index = Math.max(0, steps.indexOf(state.currentStep))
  const current = steps[index]
  const isLast = index === steps.length - 1
  const touring = current === 'welcome'
  // Nothing past the account opens until the session can enter the app.
  const onAccount = !touring && (current === 'account' || !accountReady)
  const lastSlide = slide === TOUR_SLIDES.length - 1
  const locked = busy || savingScreen

  const apply = useCallback(async (run: () => Promise<OnboardingState>): Promise<boolean> => {
    if (pending.current) return false
    pending.current = true
    setBusy(true)
    setError('')
    try {
      setOnboarding(await run())
      return true
    } catch {
      setError('Your setup could not be saved. Please try again.')
      return false
    } finally {
      pending.current = false
      setBusy(false)
    }
  }, [setOnboarding])

  /** The church profile comes from sign-up: the org's name and this computer's zone. */
  const seedChurch = useCallback(async (): Promise<void> => {
    const church = useBootstrapStore.getState().settings.church
    const org = useAccountStore.getState().session.org?.name?.trim() ?? ''
    const next = { ...church, name: church.name.trim() || org, timezone: church.timezone || LOCAL_ZONE }
    if (next.name === church.name && next.timezone === church.timezone) return
    await window.api.settings.set('church', next)
    useBootstrapStore.getState().patchSettings('church', next)
  }, [])

  /** Ends setup. Finishing or skipping lands on the welcome, unless `welcome: false`. */
  const finish = useCallback(async ({ welcome = true } = {}): Promise<boolean> => {
    if (!accountReady || savingScreen) return false
    const done = await apply(async () => {
      await seedChurch()
      return window.api.onboarding.finish()
    })
    if (done && welcome) { setDir(1); setWelcomed(true) }
    return done
  }, [accountReady, apply, savingScreen, seedChurch])

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.focus()
    return () => previous?.focus()
  }, [])

  // Signed in and confirmed on the account page: carry on to screens.
  useEffect(() => {
    if (!accountReady || current !== 'account') return
    setDir(1)
    void apply(async () => {
      await seedChurch()
      await window.api.onboarding.completeStep('account')
      return window.api.onboarding.setCurrentStep('output')
    })
  }, [accountReady, apply, current, seedChurch])

  const goToSlide = (next: number): void => {
    const clamped = Math.min(TOUR_SLIDES.length - 1, Math.max(0, next))
    if (clamped === slide) return
    setDir(clamped > slide ? 1 : -1)
    setSlide(clamped)
  }

  /** Leave the tour: to the account, or straight to screens when already signed in. */
  const leaveTour = async (mode: AuthMode = authMode): Promise<void> => {
    if (locked) return
    setAuthMode(mode)
    setDir(1)
    await apply(async () => {
      await window.api.onboarding.completeStep('welcome')
      if (!accountReady) return window.api.onboarding.setCurrentStep('account')
      await window.api.onboarding.completeStep('account')
      return window.api.onboarding.setCurrentStep('output')
    })
  }

  const advance = async (): Promise<void> => {
    if (locked || !accountReady) return
    setDir(1)
    const saved = await apply(async () => {
      await (isStepComplete(current, settings) ? window.api.onboarding.completeStep(current) : window.api.onboarding.skipStep(current))
      if (!isLast) return window.api.onboarding.setCurrentStep(steps[index + 1])
      await seedChurch()
      return window.api.onboarding.finish()
    })
    if (saved && isLast) setWelcomed(true)
  }

  // Back skips the account page once signed in — there is nothing to redo there.
  const backTarget = steps.slice(0, index).reverse().find((step) => step !== 'account' || !accountReady) ?? null
  const back = (): void => {
    if (locked || !backTarget) return
    setDir(-1)
    // Walking back into the tour lands on its last slide, not its first.
    if (backTarget === 'welcome') setSlide(TOUR_SLIDES.length - 1)
    void apply(() => window.api.onboarding.setCurrentStep(backTarget))
  }

  const openScreens = async (): Promise<void> => {
    if (await finish({ welcome: false })) {
      onDismiss(undefined, { coach: false })
      useAppStore.getState().openScreens()
    }
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation()
      // The account cannot be skipped; once in, Escape is "set up later".
      if (welcomed) onDismiss(); else if (accountReady) void finish()
      return
    }
    const typing = (event.target as HTMLElement).closest('input, select, textarea')
    if (touring && !typing && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      event.preventDefault()
      goToSlide(slide + (event.key === 'ArrowRight' ? 1 : -1))
      return
    }
    if (event.key !== 'Tab') return
    const targets = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') ?? []).filter((node) => node.getClientRects().length > 0)
    const first = targets[0], last = targets[targets.length - 1]
    if (!first) { event.preventDefault(); return }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus() }
  }

  // Setup pages fill the bar from the first setup step to the last.
  const setupCount = steps.length - 1
  const progress = setupCount > 0 ? index / setupCount : 1

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-5 onboarding-scrim" role="presentation">
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="onboarding-title onboarding-slide-title" tabIndex={-1} data-onboarding-wizard="true" className="onboarding-dialog" onKeyDown={onKeyDown}>
        <header className="onboarding-titlebar">
          <KairoMark size="sm" variant="mark" />
          <span id="onboarding-title" className="text-sm font-semibold text-slate-300">Welcome to Kairo</span>
        </header>

        <div className="onboarding-body">
          {welcomed ? (
            <WelcomeView churchName={settings.church.name || orgName} onStart={(route) => onDismiss(route)} />
          ) : touring ? (
            <div className="flex h-full flex-col">
              <div className="min-h-0 flex-1"><TourStage index={slide} dir={dir} /></div>
              <div className="onboarding-dots" role="group" aria-label="Tour slides">
                {TOUR_SLIDES.map((item, i) => (
                  <button key={item.id} type="button" className="onboarding-dot" aria-label={`${item.headline}, slide ${i + 1} of ${TOUR_SLIDES.length}`} aria-current={i === slide} onClick={() => goToSlide(i)} />
                ))}
              </div>
            </div>
          ) : (
            // Keyed by step so each page replays its entrance in the direction of travel.
            <div key={onAccount ? 'account' : current} style={{ '--dir': dir } as CSSProperties}>
              {onAccount
                ? <StepAccount mode={authMode} onModeChange={setAuthMode} />
                : <StepOutput onSavingChange={setSavingScreen} onOpenScreens={() => void openScreens()} />}
            </div>
          )}
        </div>

        {!welcomed && <footer className="onboarding-footer">
          {!touring && <div className="onboarding-progress" style={{ '--progress': progress } as CSSProperties} aria-hidden="true" />}
          <div className="flex min-w-0 flex-col items-start gap-1">
            {!touring && backTarget && (
              <button type="button" className="onboarding-text-button" disabled={locked} onClick={back}>
                <ChevronLeft size={14} aria-hidden="true" />{STEP_NAMES[backTarget]}
              </button>
            )}
            {error && <p key={error} role="alert" className="onboarding-error text-[12px] text-red-400">{error}</p>}
          </div>
          {onAccount ? <span /> : (
            <button
              type="button"
              className="btn-primary onboarding-cta"
              disabled={locked}
              onClick={() => touring ? (lastSlide ? void leaveTour() : goToSlide(slide + 1)) : void advance()}
            >
              {busy ? 'Saving…' : 'Continue'}
            </button>
          )}
          <div className="flex justify-end">
            {touring ? (
              <button type="button" className="btn-secondary min-w-[140px]" disabled={locked} onClick={() => void leaveTour()}>Skip Tour</button>
            ) : accountReady && !onAccount && (
              <button type="button" className="btn-secondary min-w-[140px]" disabled={locked} onClick={() => void finish()}>Set Up Later</button>
            )}
          </div>
        </footer>}
      </div>
    </div>
  )
}
