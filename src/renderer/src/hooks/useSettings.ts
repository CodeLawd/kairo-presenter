import { useState, useEffect, useCallback } from 'react'
import type { AppSettings } from '@shared/ipc'

export function useSettings<K extends keyof AppSettings>(
  key: K,
  defaultValue: AppSettings[K]
): [AppSettings[K], (value: AppSettings[K]) => Promise<void>] {
  const [value, setValue] = useState<AppSettings[K]>(defaultValue)

  useEffect(() => {
    window.api.settings.get(key).then((stored) => {
      if (stored !== undefined && stored !== null) {
        setValue(stored)
      }
    })
  }, [key])

  const setSetting = useCallback(
    async (newValue: AppSettings[K]): Promise<void> => {
      setValue(newValue)
      await window.api.settings.set(key, newValue)
    },
    [key]
  )

  return [value, setSetting]
}
