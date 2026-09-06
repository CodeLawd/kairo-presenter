// ─── Device pairing codes ─────────────────────────────────────────────────────
// Pure — no Node/DOM APIs — shared by the desktop app and the API so both agree
// on what a code looks like and how fast a client may poll.
//
// A booth machine is often locked down, shared, or has no mail client, so
// typing a password into it is the wrong ask. Instead the app shows a short
// code, someone approves it from a phone, and the desktop polls until it is
// granted (the RFC 8628 device-authorization shape).

/**
 * No vowels, no 0/O/1/I/5/S — a code is read off one screen and typed into
 * another, usually in a dim room, so every avoidable misread is removed.
 */
export const USER_CODE_ALPHABET = 'BCDFGHJKMNPQRTVWXY2346789'
export const USER_CODE_LENGTH = 8
const USER_CODE_PREFIX = 'PROA'

/** `PROA-7K2X` — prefix so a code pasted anywhere is obviously ours. */
export function formatUserCode(raw: string): string {
  const body = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, USER_CODE_LENGTH)
  if (body.startsWith(USER_CODE_PREFIX)) {
    return `${USER_CODE_PREFIX}-${body.slice(USER_CODE_PREFIX.length)}`
  }
  return `${USER_CODE_PREFIX}-${body}`
}

/** Accepts what a person actually types: spaces, lower case, missing dash. */
export function normalizeUserCode(input: string): string {
  return formatUserCode(input.replace(/\s+/g, ''))
}

export function isValidUserCode(input: string): boolean {
  // Length is checked BEFORE formatting: `formatUserCode` truncates, so a code
  // with one character too many would otherwise pass as a different, valid
  // code — and pair the wrong machine.
  const stripped = input.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const body = stripped.startsWith(USER_CODE_PREFIX)
    ? stripped.slice(USER_CODE_PREFIX.length)
    : stripped
  if (body.length !== USER_CODE_LENGTH - USER_CODE_PREFIX.length) return false
  return [...body].every((char) => USER_CODE_ALPHABET.includes(char))
}

/** Builds a code from raw bytes — the caller supplies the randomness. */
export function userCodeFromBytes(bytes: ArrayLike<number>): string {
  let body = ''
  for (let i = 0; i < USER_CODE_LENGTH - USER_CODE_PREFIX.length; i++) {
    body += USER_CODE_ALPHABET[bytes[i] % USER_CODE_ALPHABET.length]
  }
  return formatUserCode(USER_CODE_PREFIX + body)
}

// ─── Polling ──────────────────────────────────────────────────────────────────

export type DevicePollOutcome = 'pending' | 'slow_down' | 'approved' | 'denied' | 'expired'

/** Server's baseline poll interval, in seconds. */
export const DEVICE_POLL_INTERVAL_SEC = 5
const MAX_POLL_INTERVAL_SEC = 30

/**
 * How long to wait before the next poll.
 *
 * `slow_down` means the server is being asked too often, and the answer is to
 * back off permanently — not to retry once and resume hammering. Everything
 * else keeps the interval the server asked for.
 */
export function nextPollDelaySec(
  outcome: DevicePollOutcome,
  currentSec: number = DEVICE_POLL_INTERVAL_SEC,
): number {
  if (outcome === 'slow_down') return Math.min(currentSec + DEVICE_POLL_INTERVAL_SEC, MAX_POLL_INTERVAL_SEC)
  return currentSec
}

export function isTerminalOutcome(outcome: DevicePollOutcome): boolean {
  return outcome === 'approved' || outcome === 'denied' || outcome === 'expired'
}
