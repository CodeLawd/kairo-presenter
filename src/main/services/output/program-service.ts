import log from 'electron-log/main'
import {
  EMPTY_PROGRAM_STATE,
  idleTimer,
  normalizePresentationSettings,
  pauseTimer,
  resetTimer,
  screenTimerDef,
  startTimerFor,
  type ProgramTimerDef,
  type ProgramTimerState,
  type ProgramSlideInfo,
  type ProgramState,
} from '@shared/program'
import { store } from '../../db'
import { surfaceManager } from './surface-manager'

type Listener = (state: ProgramState) => void

// ─── Program service (standalone phases 2–3, E4) ──────────────────────────────
// What is happening on the program right now, beyond the slide itself: the
// audience message, the stage-only message, props, logo, camera, countdown,
// and the current / next slide the stage displays mirror. Never persisted —
// a restart comes up clean, as ProPresenter does.

class ProgramService {
  private state: ProgramState = { ...EMPTY_PROGRAM_STATE }
  private listeners = new Set<Listener>()

  getState(): ProgramState {
    return this.state
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private set(patch: Partial<ProgramState>): ProgramState {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener(this.state)
    void surfaceManager.setProgram(this.state).catch((err) => {
      log.error('[Program] Could not apply program state', (err as Error).message)
    })
    return this.state
  }

  // ─── Messages ───────────────────────────────────────────────────────────────

  showMessage(text: string): ProgramState {
    const message = text.trim().slice(0, 1000)
    return this.set({ message: message || null })
  }

  clearMessage(): ProgramState {
    return this.set({ message: null })
  }

  setStageMessage(text: string | null): ProgramState {
    const message = (text ?? '').trim().slice(0, 500)
    return this.set({ stageMessage: message || null })
  }

  // ─── Logo, props, camera ────────────────────────────────────────────────────

  setProp(id: string, on: boolean): ProgramState {
    const known = normalizePresentationSettings(store.get('presentation')).props.some((p) => p.id === id)
    if (on && !known) throw new Error('That prop no longer exists.')
    const others = this.state.activePropIds.filter((p) => p !== id)
    return this.set({ activePropIds: on ? [...others, id] : others })
  }

  clearProps(): ProgramState {
    return this.set({ activePropIds: [] })
  }

  /** Props removed from settings stop being "active" too. */
  pruneProps(): void {
    const ids = new Set(normalizePresentationSettings(store.get('presentation')).props.map((p) => p.id))
    const active = this.state.activePropIds.filter((id) => ids.has(id))
    if (active.length !== this.state.activePropIds.length) this.set({ activePropIds: active })
  }

  setLogo(on: boolean): ProgramState {
    return this.set({ logo: on })
  }

  /** `audioLabel`: the audio input played with the camera; null keeps it silent. */
  setCamera(label: string | null, audioLabel: string | null = null): ProgramState {
    const camera = (label ?? '').trim() || null
    const audio = camera ? (audioLabel ?? '').trim() || null : null
    return this.set({ camera, cameraAudio: audio })
  }

  // ─── Timers ─────────────────────────────────────────────────────────────────

  private timerDefs(): ProgramTimerDef[] {
    return normalizePresentationSettings(store.get('presentation')).timers
  }

  /** The saved timer `id`, or — with no id, or one no longer saved — the one on screens. */
  private timerDef(id?: string): ProgramTimerDef {
    const defs = this.timerDefs()
    return defs.find((t) => t.id === id) ?? screenTimerDef({ timers: defs }, this.state)
  }

  private timerRun(def: ProgramTimerDef): ProgramTimerState {
    return this.state.timers[def.id] ?? idleTimer(def, Date.now())
  }

  /** Stores one timer's run, and keeps `timer` a copy of the one on screens. */
  private setTimerRun(def: ProgramTimerDef, run: ProgramTimerState): ProgramState {
    const timers = { ...this.state.timers, [def.id]: run }
    const onScreens = screenTimerDef({ timers: this.timerDefs() }, this.state)
    return this.set({ timers, timer: timers[onScreens.id] ?? this.state.timer })
  }

  setTimer(durationSec: number, id?: string): ProgramState {
    const def = this.timerDef(id)
    return this.setTimerRun(def, def.kind === 'countdownTo' ? idleTimer(def, Date.now()) : resetTimer(this.timerRun(def), durationSec))
  }

  startTimer(id?: string): ProgramState {
    const def = this.timerDef(id)
    return this.setTimerRun(def, startTimerFor(def, this.timerRun(def), Date.now()))
  }

  pauseTimer(id?: string): ProgramState {
    const def = this.timerDef(id)
    return this.setTimerRun(def, pauseTimer(this.timerRun(def), Date.now()))
  }

  resetTimer(id?: string): ProgramState {
    const def = this.timerDef(id)
    return this.setTimerRun(def, idleTimer(def, Date.now()))
  }

  /** Makes `id` the timer screens and stage displays show. */
  showTimer(id: string): ProgramState {
    const def = this.timerDefs().find((t) => t.id === id)
    if (!def) return this.state
    return this.set({ screenTimerId: def.id, timer: this.timerRun(def) })
  }

  setOnScreens(layer: 'countdown' | 'clock', on: boolean): ProgramState {
    return this.set(layer === 'countdown' ? { countdownOnScreens: on } : { clockOnScreens: on })
  }

  // ─── Current / next (stage displays) ────────────────────────────────────────

  setSlide(current: ProgramSlideInfo | null, next: ProgramSlideInfo | null = null): void {
    this.set({ current, next })
  }

  /** Text came down; the stage keeps showing what is next. */
  clearCurrent(): void {
    if (this.state.current) this.set({ current: null })
  }

  /**
   * "Clear all": the audience message, props, logo and camera come down with
   * the slide, as ProPresenter's Clear All does. The stage message and the
   * countdown are the booth's, not the room's, so they stay.
   */
  clearProgram(): void {
    this.set({ message: null, activePropIds: [], logo: false, camera: null, cameraAudio: null, current: null, next: null })
  }
}

export const programService = new ProgramService()
