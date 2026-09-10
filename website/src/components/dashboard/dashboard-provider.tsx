'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ApiError, api } from '@/lib/api'
import { getSession, mintAccessToken, type SessionSnapshot } from '@/lib/session'

type DashboardContextValue = {
  session: SessionSnapshot
  accessToken: string
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
  const [session, setSession] = useState<SessionSnapshot | null>(null)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      const token = await mintAccessToken()
      const snapshot = await getSession(token)
      setAccessToken(token)
      setSession(snapshot)
      setError(null)
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) {
        router.replace(`/login?returnTo=${encodeURIComponent('/dashboard')}`)
        return
      }
      setError(failure instanceof ApiError ? failure.message : 'Could not load your account.')
    }
  }, [router])

  useEffect(() => {
    void load()
  }, [load])

  const signOut = useCallback(async (): Promise<void> => {
    try {
      if (accessToken) {
        await api('/v1/auth/logout', { method: 'POST', accessToken })
      }
    } catch {
      // Still clear the local session — a failed logout must not trap them.
    }
    router.replace('/login')
  }, [accessToken, router])

  const value = useMemo<DashboardContextValue | null>(() => {
    if (!session || !accessToken) return null
    return { session, accessToken, refresh: load, signOut }
  }, [session, accessToken, load, signOut])

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
      <div className="flex min-h-dvh items-center justify-center bg-background text-muted-foreground">
        Loading your account…
      </div>
    )
  }

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>
}
