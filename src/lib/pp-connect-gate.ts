import type { ProPresenterConnectionState } from './ipc'

/** Result of the silent handshake that runs as soon as settings are loaded. */
export type PpLaunchOutcome = 'pending' | 'connected' | 'unavailable'

/** Whether the launch prompt should still sit in front of the operator. */
export function shouldOfferPpConnectGate(input: {
  sessionResolved: boolean
  launch: PpLaunchOutcome
  /** Account sign-in is open — never stack the PP modal on top of it. */
  accountGateOpen?: boolean
}): boolean {
  if (input.sessionResolved) return false
  if (input.accountGateOpen) return false
  // Hide while we still might get in — the modal is only for a failed handshake.
  return input.launch === 'unavailable'
}

/** Map the first connect attempt onto a launch outcome. */
export function ppLaunchOutcomeFromStatus(
  state: ProPresenterConnectionState,
): Exclude<PpLaunchOutcome, 'pending'> {
  return state === 'connected' ? 'connected' : 'unavailable'
}

/** Pause after a live handshake so the operator sees Connected before the app. */
export const PP_CONNECT_SUCCESS_HOLD_MS = 1200
