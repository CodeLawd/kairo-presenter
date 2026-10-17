import { createOutputSettingsWriter } from '@shared/output-settings'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'

export const saveOutputSettings = createOutputSettingsWriter({
  read: () => useBootstrapStore.getState().settings.overlay,
  publish: (overlay) => useBootstrapStore.getState().patchSettings('overlay', overlay),
  persist: (patch) => window.api.settings.set('overlay', patch),
})
