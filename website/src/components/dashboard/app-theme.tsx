'use client'

import { useDashboardTheme } from '@/lib/dashboard-theme'

/**
 * Applies the app theme on pages outside the dashboard provider — sign-in,
 * sign-up, device activation — so they match the dashboard they lead into.
 */
export function AppTheme(): null {
  useDashboardTheme()
  return null
}
