import type { AppSettings } from '../ipc'
import type { OrgSecretsPayload, OrgSecretsPatch } from './contracts'

/**
 * Maps the org vault onto local AppSettings secret fields.
 *
 * Cloud is the source of truth for these six keys: a successful pull replaces
 * local values, including empties, so a clear on the website sticks on the booth.
 */
export function applyOrgSecretsToSettings(
  settings: Pick<AppSettings, 'stt' | 'lyrics'>,
  secrets: OrgSecretsPayload,
): { stt: AppSettings['stt']; lyrics: AppSettings['lyrics'] } {
  return {
    stt: {
      ...settings.stt,
      apiKey: secrets.deepgramApiKey ?? '',
      anthropicApiKey: secrets.anthropicApiKey ?? '',
      deepseekApiKey: secrets.deepseekApiKey ?? '',
      bibleApiKey: secrets.bibleApiKey ?? '',
    },
    lyrics: {
      ...settings.lyrics,
      braveApiKey: secrets.braveApiKey ?? '',
      googleTranslateApiKey: secrets.googleTranslateApiKey ?? '',
    },
  }
}

const LOCAL_TO_CLOUD: Record<string, keyof OrgSecretsPatch> = {
  apiKey: 'deepgramApiKey',
  anthropicApiKey: 'anthropicApiKey',
  deepseekApiKey: 'deepseekApiKey',
  bibleApiKey: 'bibleApiKey',
  braveApiKey: 'braveApiKey',
  googleTranslateApiKey: 'googleTranslateApiKey',
}

/**
 * Build a vault PUT patch from local settings.
 *
 * Non-empty locals are written. Empty locals are omitted (leave the vault alone)
 * unless listed in `clearLocalKeys`, which maps to an explicit `null` clear.
 * That stops a fresh booth with empty locals from wiping keys saved on the web.
 */
export function settingsToOrgSecretsPatch(
  settings: Pick<AppSettings, 'stt' | 'lyrics'>,
  clearLocalKeys: readonly string[] = [],
): OrgSecretsPatch {
  const clear = new Set(clearLocalKeys)
  const patch: OrgSecretsPatch = {}

  const write = (localKey: string, value: string | undefined): void => {
    const cloudKey = LOCAL_TO_CLOUD[localKey]
    if (!cloudKey) return
    if (clear.has(localKey)) {
      patch[cloudKey] = null
      return
    }
    const trimmed = value?.trim() ?? ''
    if (trimmed) patch[cloudKey] = trimmed
  }

  write('apiKey', settings.stt.apiKey)
  write('anthropicApiKey', settings.stt.anthropicApiKey)
  write('deepseekApiKey', settings.stt.deepseekApiKey)
  write('bibleApiKey', settings.stt.bibleApiKey)
  write('braveApiKey', settings.lyrics.braveApiKey)
  write('googleTranslateApiKey', settings.lyrics.googleTranslateApiKey)

  return patch
}

export type SttSecretKey = 'apiKey' | 'anthropicApiKey' | 'deepseekApiKey' | 'bibleApiKey'
export type LyricsSecretKey = 'braveApiKey' | 'googleTranslateApiKey'

/**
 * Merge a settings.set payload for secret-bearing sections.
 * Empty string = unchanged; listed clearKeys = wipe.
 */
export function mergeSecretSection<T extends Record<string, unknown>>(
  current: T,
  incoming: T & { clearKeys?: string[] },
  secretKeys: readonly string[],
): T {
  const clear = new Set(incoming.clearKeys ?? [])
  const next = { ...current, ...incoming } as T & { clearKeys?: string[] }
  delete next.clearKeys

  for (const key of secretKeys) {
    if (clear.has(key)) {
      ;(next as Record<string, unknown>)[key] = ''
      continue
    }
    const value = incoming[key]
    if (typeof value !== 'string' || value.trim() === '') {
      ;(next as Record<string, unknown>)[key] = current[key]
    } else {
      ;(next as Record<string, unknown>)[key] = value.trim()
    }
  }
  return next as T
}

export const STT_SECRET_KEYS = [
  'apiKey',
  'anthropicApiKey',
  'deepseekApiKey',
  'bibleApiKey',
] as const satisfies readonly SttSecretKey[]

export const LYRICS_SECRET_KEYS = [
  'braveApiKey',
  'googleTranslateApiKey',
] as const satisfies readonly LyricsSecretKey[]

export interface SecretsConfigured {
  deepgram: boolean
  anthropic: boolean
  deepseek: boolean
  bible: boolean
  brave: boolean
  googleTranslate: boolean
}

export function secretsConfiguredFromSettings(
  settings: Pick<AppSettings, 'stt' | 'lyrics'>,
): SecretsConfigured {
  return {
    deepgram: Boolean(settings.stt.apiKey?.trim()),
    anthropic: Boolean(settings.stt.anthropicApiKey?.trim()),
    deepseek: Boolean(settings.stt.deepseekApiKey?.trim()),
    bible: Boolean(settings.stt.bibleApiKey?.trim()),
    brave: Boolean(settings.lyrics.braveApiKey?.trim()),
    googleTranslate: Boolean(settings.lyrics.googleTranslateApiKey?.trim()),
  }
}

/** Strip secret strings before crossing into the renderer. */
export function redactSettingsSecrets(settings: AppSettings): AppSettings {
  return {
    ...settings,
    stt: {
      ...settings.stt,
      apiKey: '',
      anthropicApiKey: '',
      deepseekApiKey: '',
      bibleApiKey: '',
    },
    lyrics: {
      ...settings.lyrics,
      braveApiKey: '',
      googleTranslateApiKey: '',
    },
  }
}
