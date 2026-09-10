'use client'

import { useCallback, useRef } from 'react'
import { api } from './api'

export interface SessionSnapshot {
  user: { id: string; email: string; name: string; emailVerified: boolean }
  orgId: string | null
  role: string | null
  orgs: { id: string; name: string; role: string }[]
}

const SEED_KEY = 'pa_access_seed'

/** In-flight refresh shared across callers — Strict Mode remounts must not rotate twice. */
let refreshInFlight: Promise<string> | null = null

/**
 * Stash the access token returned by signup/login so the next page can talk to
 * the API without an immediate refresh round-trip.
 */
export function seedAccessToken(token: string): void {
  try {
    sessionStorage.setItem(SEED_KEY, JSON.stringify({ token, at: Date.now() }))
  } catch {
    // Private mode / disabled storage — refresh cookie is the fallback.
  }
}

function consumeAccessTokenSeed(): string | null {
  try {
    const raw = sessionStorage.getItem(SEED_KEY)
    if (!raw) return null
    sessionStorage.removeItem(SEED_KEY)
    const parsed = JSON.parse(raw) as { token?: unknown; at?: unknown }
    if (typeof parsed.token !== 'string' || typeof parsed.at !== 'number') return null
    if (Date.now() - parsed.at >= 14 * 60 * 1000) return null
    return parsed.token
  } catch {
    return null
  }
}

/**
 * Returns a short-lived access token: prefer a just-seeded one from login/
 * signup, otherwise trade the HttpOnly refresh cookie via `/v1/auth/refresh`.
 */
export async function mintAccessToken(): Promise<string> {
  const seeded = consumeAccessTokenSeed()
  if (seeded) return seeded

  if (!refreshInFlight) {
    refreshInFlight = api<{ accessToken: string; expiresIn: string }>('/v1/auth/refresh', {
      method: 'POST',
      body: {},
    })
      .then((result) => result.accessToken)
      .finally(() => {
        refreshInFlight = null
      })
  }
  return refreshInFlight
}

export async function getSession(accessToken: string): Promise<SessionSnapshot> {
  return api<SessionSnapshot>('/v1/auth/session', { accessToken })
}

/**
 * Holds one access token for the lifetime of a flow rather than minting a fresh
 * one per request. Tokens live ~15 minutes; this re-mints a minute out from
 * that, and `refresh()` forces a new one after a 401.
 */
export function useAccessToken(): {
  get: () => Promise<string>
  refresh: () => Promise<string>
} {
  const held = useRef<{ token: string; mintedAt: number } | null>(null)

  const refresh = useCallback(async (): Promise<string> => {
    const token = await mintAccessToken()
    held.current = { token, mintedAt: Date.now() }
    return token
  }, [])

  const get = useCallback(async (): Promise<string> => {
    const current = held.current
    // Deliberately conservative: the server's TTL is not visible here, so this
    // assumes the default 15 minutes and renews well before it.
    if (current && Date.now() - current.mintedAt < 14 * 60 * 1000) return current.token
    return refresh()
  }, [refresh])

  return { get, refresh }
}
