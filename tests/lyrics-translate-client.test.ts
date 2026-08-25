import assert from 'node:assert/strict'
import test from 'node:test'
import axios from 'axios'

import { translateSections } from '../src/main/services/lyrics/translate'
import type { LyricsSongSection } from '../src/lib/ipc'

test('translateSections requires an API key when nothing can be resolved', async () => {
  await assert.rejects(
    () => translateSections([{ type: 'verse', label: 'Verse', lines: ['Hola'] }], { apiKey: '' }),
    /Google Translate|Anthropic|DeepSeek|online glosses/i
  )
})

test('translateSections inserts English glosses under each line', async () => {
  const originalPost = axios.post
  // @ts-expect-error test stub
  axios.post = async () => ({
    data: {
      data: {
        translations: [
          { translatedText: 'There is no other Name like Jesus', detectedSourceLanguage: 'yo' },
          { translatedText: 'He made the lame walk', detectedSourceLanguage: 'yo' },
        ],
      },
    },
  })

  try {
    const sections: LyricsSongSection[] = [
      {
        type: 'chorus',
        label: 'Chorus',
        lines: ['Odudu dabu Jesus no', '', 'Ide na lolu le'],
      },
    ]

    const result = await translateSections(sections, { apiKey: 'test-key', target: 'en' })
    assert.deepEqual(result[0].lines, [
      'Odudu dabu Jesus no',
      '(There is no other Name like Jesus)',
      '',
      'Ide na lolu le',
      '(He made the lame walk)',
    ])
  } finally {
    axios.post = originalPost
  }
})

test('translateSections skips lines Google detects as English', async () => {
  const originalPost = axios.post
  // @ts-expect-error test stub
  axios.post = async () => ({
    data: {
      data: {
        translations: [
          { translatedText: 'There is no other Name', detectedSourceLanguage: 'yo' },
        ],
      },
    },
  })

  try {
    const result = await translateSections(
      [
        {
          type: 'chorus',
          label: 'Chorus',
          lines: ['Power belongs to Jesus', 'Odudu dabu Jesus no'],
        },
      ],
      { apiKey: 'test-key' }
    )
    assert.deepEqual(result[0].lines, [
      'Power belongs to Jesus',
      'Odudu dabu Jesus no',
      '(There is no other Name)',
    ])
  } finally {
    axios.post = originalPost
  }
})

test('translateSections passes forced source language to Google', async () => {
  const originalPost = axios.post
  let body: Record<string, unknown> | null = null
  // @ts-expect-error test stub
  axios.post = async (_url: string, payload: Record<string, unknown>) => {
    body = payload
    return {
      data: {
        data: {
          translations: [{ translatedText: 'The mark of God is upon me' }],
        },
      },
    }
  }

  try {
    const result = await translateSections(
      [{ type: 'verse', label: 'V', lines: ['Amioluwa o mbe lori mi'] }],
      { apiKey: 'test-key', sourceLanguage: 'yo' }
    )
    assert.equal(body?.source, 'yo')
    assert.deepEqual(result[0].lines, [
      'Amioluwa o mbe lori mi',
      '(The mark of God is upon me)',
    ])
  } finally {
    axios.post = originalPost
  }
})

test('translateSections surfaces API errors', async () => {
  const originalPost = axios.post
  // @ts-expect-error test stub
  axios.post = async () => {
    const err = new Error('Request failed') as Error & {
      isAxiosError: boolean
      response: { status: number; data: { error: { message: string } } }
    }
    err.isAxiosError = true
    err.response = { status: 403, data: { error: { message: 'PERMISSION_DENIED' } } }
    throw err
  }

  try {
    await assert.rejects(
      () =>
        translateSections([{ type: 'verse', label: 'V', lines: ['Hola'] }], {
          apiKey: 'bad',
        }),
      /denied|billing|Translate/i
    )
  } finally {
    axios.post = originalPost
  }
})
