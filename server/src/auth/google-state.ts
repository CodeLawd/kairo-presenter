import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { CookieOptions } from 'express'
import type { AppConfig } from '../config/env'
import { safeReturnPath } from '@contracts/return-path'

export const GOOGLE_STATE_COOKIE = 'pa_google_state'
const TTL_MS = 10 * 60_000

export function googleStateCookieOptions(config: AppConfig): CookieOptions {
  return { httpOnly: true, secure: config.nodeEnv === 'production', sameSite: 'lax', path: '/v1/auth/google' }
}

function signature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(`google-oauth:${payload}`).digest('base64url')
}

export function issueGoogleState(returnTo: unknown, config: AppConfig): string {
  const payload = Buffer.from(JSON.stringify({
    nonce: randomBytes(32).toString('base64url'),
    returnTo: safeReturnPath(returnTo),
    expiresAt: Date.now() + TTL_MS,
  })).toString('base64url')
  return `${payload}.${signature(payload, config.jwtSecret)}`
}

/** Both the signature and the initiating browser's HttpOnly cookie must match. */
export function readGoogleState(state: unknown, cookie: unknown, config: AppConfig): string | null {
  if (typeof state !== 'string' || typeof cookie !== 'string' || state.length > 4096 || state !== cookie) return null
  const parts = state.split('.')
  if (parts.length !== 2) return null
  const expected = Buffer.from(signature(parts[0], config.jwtSecret))
  const supplied = Buffer.from(parts[1])
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString()) as { expiresAt?: number; returnTo?: unknown }
    if (typeof payload.expiresAt !== 'number' || payload.expiresAt <= Date.now()) return null
    return safeReturnPath(payload.returnTo)
  } catch { return null }
}

export function googleFailureUrl(config: AppConfig, reason: 'expired' | 'cancelled' | 'failed' | 'unavailable', returnTo: unknown = '/dashboard'): string {
  const url = new URL('/login', config.publicWebUrl)
  url.searchParams.set('googleError', reason)
  url.searchParams.set('returnTo', safeReturnPath(returnTo))
  return url.toString()
}

export const GOOGLE_STATE_MAX_AGE = TTL_MS
