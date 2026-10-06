import log from 'electron-log/main'
import {
  EMPTY_PROGRAM_STATE,
  normalizePresentationSettings,
  pauseTimer,
  resetTimer,
  startTimer,
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

  // ─── Countdown ──────────────────────────────────────────────────────────────

  setTimer(durationSec: number): ProgramState {
    return this.set({ timer: resetTimer(this.state.timer, durationSec) })
  }

  startTimer(): ProgramState {
    return this.set({ timer: startTimer(this.state.timer, Date.now()) })
  }

  pauseTimer(): ProgramState {
    return this.set({ timer: pauseTimer(this.state.timer, Date.now()) })
  }

  resetTimer(): ProgramState {
    return this.set({ timer: resetTimer(this.state.timer) })
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
