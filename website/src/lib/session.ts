'use client'

import { useCallback, useMemo, useRef } from 'react'
import { api, type TokenSource } from './api'

export interface SessionSnapshot {
  user: { id: string; email: string; name: string; emailVerified: boolean }
  orgId: string | null
  role: string | null
  orgs: { id: string; name: string; role: string }[]
}

const SEED_KEY = 'pa_access_seed'

/** Renew this long before the token actually dies, to cover flight time. */
const EXPIRY_MARGIN_MS = 60_000

/**
 * When this token stops being accepted, according to the token itself.
 *
 * Read rather than assumed: the previous code guessed "15 minutes from when we
 * received it", which is wrong twice over — a token handed over second-hand (a
 * login seed replayed on the next page) is already partly spent, and the
 * server's TTL is an env var this file cannot see. Guessing produced a window
 * where a dead token looked fresh, which is exactly what a 401 on a page that
 * had been open a while looks like.
 *
 * This is not verification — the signature is the server's business. It only
 * decides when to ask for a new one, so a malformed token simply counts as
 * expired.
 */
function expiryOf(token: string): number {
  try {
    const payload = token.split('.')[1]
    if (!payload) return 0
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const exp = (JSON.parse(json) as { exp?: unknown }).exp
    return typeof exp === 'number' ? exp * 1000 : 0
  } catch {
    return 0
  }
}

function isUsable(token: string): boolean {
  return Date.now() < expiryOf(token) - EXPIRY_MARGIN_MS
}

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
    if (typeof parsed.token !== 'string') return null
    // The token's own expiry decides this, not how long it sat in storage.
    return isUsable(parsed.token) ? parsed.token : null
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
export function useAccessToken(): TokenSource {
  const held = useRef<string | null>(null)

  const refresh = useCallback(async (): Promise<string> => {
    const token = await mintAccessToken()
    held.current = token
    return token
  }, [])

  const get = useCallback(async (): Promise<string> => {
    const current = held.current
    // Renewal is driven by the token's own `exp`, so a seeded token that was
    // already half-spent when we received it is not treated as brand new.
    if (current && isUsable(current)) return current
    return refresh()
  }, [refresh])

  // Stable identity: callers put this in `useCallback`/`useEffect` dependency
  // arrays, and a fresh object every render would re-run their mount effects.
  return useMemo(() => ({ get, refresh }), [get, refresh])
}
