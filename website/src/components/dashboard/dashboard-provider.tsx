'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { KairoMark } from '@/components/brand/KairoMark'
import { ApiError, authedApi } from '@/lib/api'
import { getSession, useAccessToken, type SessionSnapshot } from '@/lib/session'

type DashboardContextValue = {
  session: SessionSnapshot
  /**
   * An authenticated request against the API.
   *
   * Deliberately a function rather than the token itself: a token handed out as
   * a value is captured by whatever effect reads it and is still being sent
   * long after it expired — which is how a dashboard left open on a polling
   * page ends up showing "Unauthorized".
   */
  request: <T>(path: string, options?: { method?: string; body?: unknown }) => Promise<T>
  /**
   * A valid access token, for the rare request that cannot go through
   * `request` — a file download, where the response is bytes rather than JSON.
   * Still a function, for the same reason `request` is: anything that hands
   * out the token as a value goes stale.
   */
  getAccessToken: () => Promise<string>
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const DashboardContext = createContext<DashboardContextValue | null>(null)

export function useDashboard(): DashboardContextValue {
  const value = useContext(DashboardContext)
  if (!value) throw new Error('useDashboard must be used inside DashboardProvider')
  return value
}

export function DashboardProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const router = useRouter()
  const tokens = useAccessToken()
  const [session, setSession] = useState<SessionSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  const request = useCallback(
    async <T,>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> => {
      try {
        return await authedApi<T>(path, tokens, options)
      } catch (failure) {
        // `authedApi` already re-minted and replayed once. A 401 that survives
        // that means the refresh cookie is gone too — the session is over, and
        // no amount of "Try again" on the page will bring it back. Send them to
        // the one screen that can fix it instead of a dead end.
        if (failure instanceof ApiError && failure.status === 401) {
          router.replace(`/login?returnTo=${encodeURIComponent(window.location.pathname)}`)
        }
        throw failure
      }
    },
    [tokens, router],
  )

  const load = useCallback(async (): Promise<void> => {
    try {
      const snapshot = await getSession(await tokens.refresh())
      setSession(snapshot)
      setError(null)
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) {
        router.replace(`/login?returnTo=${encodeURIComponent('/dashboard')}`)
        return
      }
      setError(failure instanceof ApiError ? failure.message : 'Could not load your account.')
    }
  }, [router, tokens])

  useEffect(() => {
    void load()
  }, [load])

  const signOut = useCallback(async (): Promise<void> => {
    try {
      await request('/v1/auth/logout', { method: 'POST' })
    } catch {
      // Still clear the local session — a failed logout must not trap them.
    }
    router.replace('/login')
  }, [request, router])

  const value = useMemo<DashboardContextValue | null>(() => {
    if (!session) return null
    return { session, request, getAccessToken: tokens.get, refresh: load, signOut }
  }, [session, request, tokens, load, signOut])

  if (error) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-6 text-center">
        <div className="max-w-md">
          <p className="text-lg font-medium text-foreground">{error}</p>
          <button
            type="button"
            className="mt-4 text-sm text-primary underline-offset-4 hover:underline"
            onClick={() => void load()}
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  if (!value) {
    return (
      <div
        className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-background px-6"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <KairoMark
          size={56}
          glow
          className="motion-safe:animate-mark-breathe motion-reduce:animate-none"
        />
        <p className="text-sm text-muted-foreground">Loading your account…</p>
      </div>
    )
  }

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>
}
