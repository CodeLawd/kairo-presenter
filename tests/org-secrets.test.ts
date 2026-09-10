import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyOrgSecretsToSettings,
  mergeSecretSection,
  redactSettingsSecrets,
  secretsConfiguredFromSettings,
  settingsToOrgSecretsPatch,
} from '../src/lib/cloud/org-secrets'
import type { AppSettings } from '../src/lib/ipc'

const baseStt: AppSettings['stt'] = {
  provider: 'none',
  apiKey: 'local-dg',
  anthropicApiKey: '',
  deepseekApiKey: '',
  llmProvider: 'anthropic',
  bibleApiKey: 'local-bible',
  language: 'en-US',
}

const baseLyrics: AppSettings['lyrics'] = {
  braveApiKey: '',
  googleTranslateApiKey: 'gt-local',
  glossColor: '#D4A017',
}

describe('org-secrets helpers', () => {
  it('lets cloud overwrite local, including empties', () => {
    const merged = applyOrgSecretsToSettings(
      { stt: baseStt, lyrics: baseLyrics },
      {
        deepgramApiKey: 'cloud-dg',
        anthropicApiKey: '',
        deepseekApiKey: '',
        bibleApiKey: '',
        braveApiKey: 'cloud-brave',
        googleTranslateApiKey: '',
        updatedAt: null,
      },
    )
    assert.equal(merged.stt.apiKey, 'cloud-dg')
    assert.equal(merged.stt.bibleApiKey, '')
    assert.equal(merged.lyrics.braveApiKey, 'cloud-brave')
    assert.equal(merged.lyrics.googleTranslateApiKey, '')
  })

  it('omits empty locals on push and nulls only cleared keys', () => {
    const patch = settingsToOrgSecretsPatch({ stt: baseStt, lyrics: baseLyrics })
    assert.equal(patch.deepgramApiKey, 'local-dg')
    assert.equal(patch.bibleApiKey, 'local-bible')
    assert.equal(patch.googleTranslateApiKey, 'gt-local')
    assert.equal(patch.braveApiKey, undefined)
    assert.equal(patch.anthropicApiKey, undefined)

    const cleared = settingsToOrgSecretsPatch(
      { stt: { ...baseStt, apiKey: '' }, lyrics: baseLyrics },
      ['apiKey'],
    )
    assert.equal(cleared.deepgramApiKey, null)
    assert.equal(cleared.bibleApiKey, 'local-bible')
  })

  it('merges settings.set empty secrets as unchanged unless cleared', () => {
    const kept = mergeSecretSection(
      baseStt,
      { ...baseStt, apiKey: '', bibleApiKey: '' },
      ['apiKey', 'anthropicApiKey', 'deepseekApiKey', 'bibleApiKey'],
    )
    assert.equal(kept.apiKey, 'local-dg')
    assert.equal(kept.bibleApiKey, 'local-bible')

    const cleared = mergeSecretSection(
      baseStt,
      { ...baseStt, apiKey: '', clearKeys: ['apiKey'] },
      ['apiKey', 'anthropicApiKey', 'deepseekApiKey', 'bibleApiKey'],
    )
    assert.equal(cleared.apiKey, '')
    assert.equal(cleared.bibleApiKey, 'local-bible')
  })

  it('redacts secret strings and reports configured flags', () => {
    const settings = {
      stt: baseStt,
      lyrics: baseLyrics,
    } as Pick<AppSettings, 'stt' | 'lyrics'>
    const flags = secretsConfiguredFromSettings(settings)
    assert.equal(flags.deepgram, true)
    assert.equal(flags.bible, true)
    assert.equal(flags.brave, false)
    assert.equal(flags.googleTranslate, true)

    const redacted = redactSettingsSecrets({
      ...({} as AppSettings),
      stt: baseStt,
      lyrics: baseLyrics,
    })
    assert.equal(redacted.stt.apiKey, '')
    assert.equal(redacted.stt.bibleApiKey, '')
    assert.equal(redacted.lyrics.googleTranslateApiKey, '')
  })
})
