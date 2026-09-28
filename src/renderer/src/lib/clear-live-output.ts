import { useAppStore } from '@/stores/useAppStore'

/** Drop verse/lyric text on output. The dock background stays. */
export async function clearLiveText(): Promise<void> {
  try {
    await window.api.output.clearText()
  } catch (err) {
    console.error(err)
  } finally {
    useAppStore.getState().clearScriptureLiveOutput()
  }
}

/** Blank the program: text and dock background. Preview matches. */
export async function clearLiveAll(): Promise<void> {
  try {
    await window.api.output.clearAll()
  } catch (err) {
    console.error(err)
  } finally {
    useAppStore.getState().clearScriptureLiveOutput()
  }
}
