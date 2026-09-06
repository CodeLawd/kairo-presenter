import { randomInt } from 'node:crypto'

/** Six digits: short enough to read off a phone, long enough with a hard cap. */
export const OTP_LENGTH = 6

/**
 * Wrong guesses allowed before the code is burned.
 *
 * Six digits is a million combinations, so the cap — not the length — is what
 * makes this safe. Five is generous for a typo and useless for an attack.
 */
export const OTP_MAX_ATTEMPTS = 5

/** Uniform over the whole range, leading zeros preserved. */
export function generateOtp(): string {
  return randomInt(0, 10 ** OTP_LENGTH)
    .toString()
    .padStart(OTP_LENGTH, '0')
}

/** Accepts what people paste: spaces, dashes, stray non-digits. */
export function normalizeOtp(input: string): string {
  return input.replace(/\D/g, '')
}

export function isWellFormedOtp(input: string): boolean {
  return new RegExp(`^\\d{${OTP_LENGTH}}$`).test(normalizeOtp(input))
}
