'use client'

import { useCallback, useEffect, useState } from 'react'
import { DASHBOARD_THEME_KEY, DEFAULT_THEME, THEMED_PATH_SOURCE } from './dashboard-theme-script'

/**
 * Light / dark for the dashboard, admin console and account pages (sign-in,
 * sign-up and the rest) — the marketing site keeps its own look. Light until
 * the person switches it. The resolved theme is written to
 * `<html data-dash-theme>`, which globals.css keys the light tokens off, so
 * portalled menus and dialogs follow it too.
 */
export type DashboardThemePreference = 'light' | 'dark' | 'system'

function readPreference(): DashboardThemePreference {
  try {
    const value = localStorage.getItem(DASHBOARD_THEME_KEY)
    return value === 'light' || value === 'dark' || value === 'system' ? value : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

function resolve(preference: DashboardThemePreference): 'light' | 'dark' {
  if (preference !== 'system') return preference
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

/** Applies the saved theme while mounted and clears it on the way out. */
export function useDashboardTheme(): {
  preference: DashboardThemePreference
  setPreference: (next: DashboardThemePreference) => void
} {
  // Null until read from storage: applying a guessed 'system' first would undo
  // the boot script's choice for a moment and flash the wrong theme.
  const [preference, setPreferenceState] = useState<DashboardThemePreference | null>(null)

  useEffect(() => {
    setPreferenceState(readPreference())
  }, [])

  useEffect(() => {
    if (!preference) return
    const root = document.documentElement
    const apply = (): void => root.setAttribute('data-dash-theme', resolve(preference))
    apply()
    // "System" follows the OS live, e.g. when macOS switches at sunset.
    const media = window.matchMedia('(prefers-color-scheme: light)')
    if (preference === 'system') media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [preference])

  // Leaving for the marketing site: drop back to its own (dark) look. Moving
  // between themed pages (sign-in → dashboard) keeps it, so nothing flickers.
  useEffect(
    () => () => {
      if (!new RegExp(THEMED_PATH_SOURCE).test(window.location.pathname)) {
        document.documentElement.removeAttribute('data-dash-theme')
      }
    },
    [],
  )

  const setPreference = useCallback((next: DashboardThemePreference): void => {
    setPreferenceState(next)
    try {
      localStorage.setItem(DASHBOARD_THEME_KEY, next)
    } catch {
      // Private mode — the choice still applies for this visit.
    }
  }, [])

  return { preference: preference ?? DEFAULT_THEME, setPreference }
}
