import type { AppSettings } from '../ipc'
import type { OrgSecretsPayload, OrgSecretsPatch } from './contracts'

/**
 * Maps the org vault onto local AppSettings secret fields.
 * Cloud non-empty values overwrite local; empty cloud fields leave local alone
 * (explicit clears are handled via OrgSecretsPatch nulls on push, not pull).
 */
export function applyOrgSecretsToSettings(
  settings: Pick<AppSettings, 'stt' | 'lyrics'>,
  secrets: OrgSecretsPayload,
): { stt: AppSettings['stt']; lyrics: AppSettings['lyrics'] } {
  return {
    stt: {
      ...settings.stt,
      apiKey: secrets.deepgramApiKey || settings.stt.apiKey,
      anthropicApiKey: secrets.anthropicApiKey || settings.stt.anthropicApiKey,
      deepseekApiKey: secrets.deepseekApiKey || settings.stt.deepseekApiKey,
      bibleApiKey: secrets.bibleApiKey || settings.stt.bibleApiKey,
    },
    lyrics: {
      ...settings.lyrics,
      braveApiKey: secrets.braveApiKey || settings.lyrics.braveApiKey,
      googleTranslateApiKey:
        secrets.googleTranslateApiKey || settings.lyrics.googleTranslateApiKey,
    },
  }
}

/** Full snapshot for PUT — what this machine currently has stored. */
export function settingsToOrgSecretsPatch(
  settings: Pick<AppSettings, 'stt' | 'lyrics'>,
): OrgSecretsPatch {
  return {
    deepgramApiKey: settings.stt.apiKey || null,
    anthropicApiKey: settings.stt.anthropicApiKey || null,
    deepseekApiKey: settings.stt.deepseekApiKey || null,
    bibleApiKey: settings.stt.bibleApiKey || null,
    braveApiKey: settings.lyrics.braveApiKey || null,
    googleTranslateApiKey: settings.lyrics.googleTranslateApiKey || null,
  }
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
