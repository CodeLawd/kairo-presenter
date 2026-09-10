'use client'

import { useCallback, useRef } from 'react'
import { api } from './api'

export interface SessionSnapshot {
  user: { id: string; email: string; name: string; emailVerified: boolean }
  orgId: string | null
  role: string | null
  orgs: { id: string; name: string; role: string }[]
}

/**
 * Trades the HttpOnly refresh cookie for a short-lived access token.
 *
 * The page cannot read the cookie — that is the point of it — so any call that
 * needs a Bearer token mints one first and uses it immediately.
 */
export async function mintAccessToken(): Promise<string> {
  const { accessToken } = await api<{ accessToken: string; expiresIn: string }>(
    '/v1/auth/refresh',
    { method: 'POST', body: {} },
  )
  return accessToken
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
