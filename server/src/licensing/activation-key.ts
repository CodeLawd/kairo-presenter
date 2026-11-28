import { randomBytes } from 'node:crypto'

/** Crockford base32: no I, L, O or U, so a key read aloud or retyped survives. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const PREFIX = 'KAIRO'
const GROUPS = 6
const GROUP = 4

/** A new activation key: `KAIRO-7F3K-Q9PX-M2TD-WC8H-4RNB-ZJ6V` (120 random bits). */
export function newActivationKey(): string {
  const bytes = randomBytes(GROUPS * GROUP)
  // 256 is a multiple of 32, so taking each byte modulo 32 stays uniform.
  const chars = [...bytes].map(b => ALPHABET[b % 32]).join('')
  return [PREFIX, ...(chars.match(new RegExp(`.{${GROUP}}`, 'g')) ?? [])].join('-')
}

/**
 * The stored form of a key someone typed or pasted, or null when it cannot
 * be one. Case, spaces and dashes don't matter; O, I and L read as 0, 1 and
 * 1. Keys issued before this format (48 hex characters) still work.
 */
export function canonicalActivationKey(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 512) return null
  const legacy = input.trim().toLowerCase()
  if (/^[a-f0-9]{48}$/.test(legacy)) return legacy
  let body = input.toUpperCase().replace(/[\s-]/g, '')
  if (body.startsWith(PREFIX)) body = body.slice(PREFIX.length)
  body = body.replace(/O/g, '0').replace(/[IL]/g, '1')
  if (body.length !== GROUPS * GROUP || [...body].some(c => !ALPHABET.includes(c))) return null
  return [PREFIX, ...(body.match(new RegExp(`.{${GROUP}}`, 'g')) ?? [])].join('-')
}
