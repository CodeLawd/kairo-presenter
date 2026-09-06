// ─── Account gate + session presentation ──────────────────────────────────────
// Pure — no Node/DOM APIs. Mirrors `pp-connect-gate.ts`: the question "should
// this be in front of the operator right now?" is a predicate, not a component.

import type { CloudSessionState, SessionSnapshot } from './contracts'

export interface SingleFlight {
  run(task: () => Promise<void>): Promise<void>
}

/**
 * Runs at most one copy of an asynchronous action at a time.
 *
 * React state is deliberately not the lock: two clicks can happen before a
 * `setState` render disables the button. This gate changes synchronously, so a
 * second submit in that small window shares the first request.
 */
export function createSingleFlight(): SingleFlight {
  let pending: Promise<void> | null = null

  return {
    run(task): Promise<void> {
      if (pending) return pending

      const operation = task()
      const tracked = operation.finally(() => {
        if (pending === tracked) pending = null
      })
      pending = tracked
      return tracked
    },
  }
}

/** A session that can use the app — active or stale. Stale is still signed in. */
export function isSignedIn(session: SessionSnapshot): boolean {
  return session.state !== 'signed-out'
}

/**
 * Whether the operator may enter the booth.
 *
 * Signed-out and unverified both stay on the account gate. A stale session
 * with a confirmed address still gets in — they are signed in, just offline.
 */
export function canEnterApp(session: SessionSnapshot): boolean {
  return isSignedIn(session) && !needsEmailConfirmation(session)
}

/**
 * Whether the sign-in / confirmation wall should sit in front of the app.
 *
 * Signed-out operators cannot reach the booth. Signed-in operators whose
 * address is unconfirmed must enter the code before setup or the booth.
 */
export function shouldOfferAccountGate(session: SessionSnapshot): boolean {
  return !canEnterApp(session)
}

export interface SessionDescription {
  label: string
  detail: string
  tone: 'neutral' | 'good' | 'warn'
}

/**
 * The status-strip chip.
 *
 * `stale` deliberately reads as "Offline", not as an error: the operator has
 * lost nothing, every feature still works, and the app is telling them a fact
 * about the network rather than asking them to do something about it.
 */
export function describeSessionState(session: SessionSnapshot): SessionDescription {
  const state: CloudSessionState = session.state
  if (state === 'signed-out') {
    return { label: 'Signed out', detail: 'Sign in to use Kairo on this machine.', tone: 'neutral' }
  }
  if (state === 'stale') {
    return {
      label: 'Offline',
      detail: 'Signed in, but Kairo cannot be reached. Nothing is interrupted.',
      tone: 'warn',
    }
  }
  return {
    label: session.org?.name ?? 'Signed in',
    detail: session.user ? `Signed in as ${session.user.email}` : 'Signed in',
    tone: 'good',
  }
}

/**
 * Whether the address still has to be confirmed with the email code.
 *
 * This is a wall, not a nudge: signup mails the code, and nothing past the
 * account gate (setup included) opens until it is entered.
 */
export function needsEmailConfirmation(session: SessionSnapshot): boolean {
  return isSignedIn(session) && session.user !== null && !session.user.emailVerified
}

/** Minimum length the sign-up form enforces, matching the API's own rule. */
export const MIN_PASSWORD_LENGTH = 10

/** Null when acceptable — otherwise the message to show under the field. */
export function validateSignUp(input: {
  email: string
  password: string
  name: string
  churchName: string
}): string | null {
  if (!input.name.trim()) return 'Enter your name'
  if (!input.churchName.trim()) return 'Enter your church name'
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email.trim())) return 'Enter a valid email address'
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
  }
  return null
}
