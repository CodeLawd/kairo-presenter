import Store from 'electron-store'
import { renamedStore } from '../../db/legacy-store'
import log from 'electron-log/main'
import type { OnboardingState, OnboardingStepId } from '@shared/ipc'
import {
  DEFAULT_ONBOARDING_STATE,
  normalizeOnboardingState,
  completeStep,
  finishOnboarding,
  resetOnboarding,
  seedOnboardingFromSettings,
  setCurrentStep,
  skipStep,
} from '@shared/cloud/onboarding'
import { migrations, store } from '../../db'

/**
 * Wizard state lives in its own store rather than in `AppSettings`.
 *
 * It is app-shell state, not a preference: keeping it out means it never rides
 * along in `settings:getAll`, never has to be normalized with the themes, and
 * later gains an account/entitlement neighbour without widening the settings
 * contract.
 */
const onboardingStore = new Store<{ onboarding: OnboardingState }>({
  name: renamedStore('proautomate-onboarding', 'kairo-onboarding'),
  defaults: { onboarding: DEFAULT_ONBOARDING_STATE },
})

type Listener = (state: OnboardingState) => void

class OnboardingService {
  private listeners = new Set<Listener>()

  /**
   * Seeds an install that predates the wizard from what it already has, once.
   *
   * A church that has been running services for months must not be marched
   * through five screens on the Sunday they update — a configured install comes
   * out of this already finished.
   */
  migrateExistingInstall(): void {
    if (migrations.get('cloudOnboardingV1')) return
    const seeded = seedOnboardingFromSettings({
      ...store.store,
      // `store.store` is the raw on-disk object; the launch-time heals in
      // db/index.ts have already run, so every section is shape-correct here.
    })
    onboardingStore.set('onboarding', seeded)
    migrations.set('cloudOnboardingV1', true)
    log.info('[Onboarding] Seeded from existing settings', {
      completed: seeded.completedSteps,
      finished: seeded.completedAt !== null,
    })
  }

  getState(): OnboardingState {
    return normalizeOnboardingState(onboardingStore.get('onboarding'))
  }

  completeStep(step: OnboardingStepId): OnboardingState {
    return this.write(completeStep(this.getState(), step))
  }

  skipStep(step: OnboardingStepId): OnboardingState {
    return this.write(skipStep(this.getState(), step))
  }

  setCurrentStep(step: OnboardingStepId): OnboardingState {
    return this.write(setCurrentStep(this.getState(), step))
  }

  finish(): OnboardingState {
    return this.write(finishOnboarding(this.getState()))
  }

  reset(): OnboardingState {
    return this.write(resetOnboarding(this.getState()))
  }

  onStateChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private write(state: OnboardingState): OnboardingState {
    onboardingStore.set('onboarding', state)
    for (const listener of this.listeners) {
      try {
        listener(state)
      } catch (err) {
        log.warn('[Onboarding] Listener threw', (err as Error).message)
      }
    }
    return state
  }
}

export const onboardingService = new OnboardingService()
