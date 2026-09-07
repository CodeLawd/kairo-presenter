import log from 'electron-log/main'
import type { LivePlanState, SermonPlan } from '@shared/ipc'
import { advancePlanExpectation, buildSermonPlanIndex, type SermonPlanIndex } from '@shared/sermon-plan-match'
import { sermonPlanStore } from './sermon-plans'

const EMPTY_STATE: LivePlanState = {
  planId: null,
  title: null,
  itemCount: 0,
  unavailableCount: 0,
}

interface PlanSource {
  get(id: string): SermonPlan | null
  getLivePlanId(): string | null
  setLivePlanId(id: string | null): void
}

/**
 * Owns the index of the sermon playlist that live transcription references.
 *
 * Consumers call `getIndex()` at use time rather than caching it, so selecting
 * or editing the live playlist takes effect without restarting the pipeline.
 * The service deliberately outlives the orchestrator — the Operator dropdown
 * works while the pipeline is stopped.
 */
export class LivePlanService {
  private index: SermonPlanIndex | null = null
  private plan: SermonPlan | null = null
  private listeners: Array<(state: LivePlanState) => void> = []

  constructor(private readonly plans: PlanSource = sermonPlanStore) {}

  /** Restores the persisted selection at boot. */
  init(): void {
    this.load(this.plans.getLivePlanId(), false)
  }

  setPlan(planId: string | null): LivePlanState {
    this.plans.setLivePlanId(planId)
    return this.load(planId, true)
  }

  /** Rebuilds after a save. No-op unless `planId` is the live plan. */
  refresh(planId: string): void {
    if (this.plan?.id !== planId) return
    this.load(planId, true)
  }

  /** Clears the selection if the deleted plan was live. */
  handleDeleted(planId: string): boolean {
    if (this.plan?.id !== planId) return false
    this.load(null, true)
    return true
  }

  getIndex(): SermonPlanIndex | null {
    return this.index
  }

  observe(reference: string, itemId?: string): void {
    if (!this.index || !advancePlanExpectation(this.index, reference, itemId)) return
    const state = this.getState()
    this.listeners.forEach(listener => listener(state))
  }

  getState(): LivePlanState {
    if (!this.plan) return EMPTY_STATE
    return {
      planId: this.plan.id,
      title: this.plan.title,
      nextReference: this.index?.ordered[this.index.expectedIndex]?.reference ?? null,
      nextPlanItemId: this.index?.ordered[this.index.expectedIndex]?.planItemId ?? null,
      itemCount: this.plan.items.length,
      unavailableCount: this.plan.items.filter(
        (item) => !item.available || item.verses.length === 0,
      ).length,
    }
  }

  onChange(callback: (state: LivePlanState) => void): void {
    this.listeners.push(callback)
  }

  private load(planId: string | null, notify: boolean): LivePlanState {
    // A dangling id (plan deleted outside this service) resolves to null and is
    // healed on the next write rather than left to fail every lookup.
    this.plan = planId ? this.plans.get(planId) : null
    this.index = this.plan ? buildSermonPlanIndex(this.plan) : null
    const state = this.getState()
    log.info('[LivePlan] Reference playlist updated', state)
    if (notify) this.listeners.forEach((listener) => listener(state))
    return state
  }
}

export const livePlanService = new LivePlanService()
