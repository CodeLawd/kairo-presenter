import type { ScriptureAPI, ScriptureSuggestion } from './ipc'

type ScriptureTabPresentationAPI = Pick<
  ScriptureAPI,
  'presentDirectly' | 'register' | 'approve'
>

/** Presents a browsed verse without publishing it as transcription-detected content. */
export async function pushScriptureFromTab(
  api: ScriptureTabPresentationAPI,
  suggestion: ScriptureSuggestion,
): Promise<void> {
  await api.presentDirectly(suggestion)
}
