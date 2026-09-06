import { useCallback } from 'react'
import type { AppSettings } from '@shared/ipc'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'

/**
 * Reads a settings section from the shared bootstrap snapshot so changes made
 * in Settings (or elsewhere) propagate to open screens without a remount.
 */
export function useSettings<K extends keyof AppSettings>(
  key: K,
  defaultValue: AppSettings[K]
): [AppSettings[K], (value: AppSettings[K]) => Promise<void>] {
  const stored = useBootstrapStore((s) => s.settings[key])
  const value = (stored ?? defaultValue) as AppSettings[K]

  const setSetting = useCallback(
    async (newValue: AppSettings[K]): Promise<void> => {
      useBootstrapStore.getState().patchSettings(key, newValue)
      await window.api.settings.set(key, newValue as import('@shared/ipc').SettingsSectionPatch<K>)
    },
    [key]
  )

  return [value, setSetting]
}
