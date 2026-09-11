import type { SermonUploadSegment } from '@contracts/contracts'
import { vaultKeyFromSecret } from '../orgs/vault-crypto'
import {
  decryptTranscript,
  encryptTranscript,
  transcriptKeyFromSecret,
} from './transcript-crypto'

const SECRET = 'a'.repeat(48)

const segments: SermonUploadSegment[] = [
  {
    id: 'seg-1',
    text: 'The Lord is my shepherd',
    timestamp: 1_000,
    duration: 2.5,
    words: [{ word: 'shepherd', start: 1.8, end: 2.3, confidence: 0.99 }],
  },
]

describe('transcript crypto', () => {
  it('round-trips a transcript, word timings included', () => {
    const key = transcriptKeyFromSecret(SECRET)
    expect(decryptTranscript(key, encryptTranscript(key, segments))).toEqual(segments)
  })

  it('refuses a transcript encrypted under a different secret', () => {
    const envelope = encryptTranscript(transcriptKeyFromSecret(SECRET), segments)
    const other = transcriptKeyFromSecret('b'.repeat(48))
    expect(() => decryptTranscript(other, envelope)).toThrow()
  })

  it('uses a different key from the org-secrets vault', () => {
    // Domain separation: a transcript envelope must not be readable with the
    // key that opens the API-key vault, even though both come from one secret.
    const transcriptKey = transcriptKeyFromSecret(SECRET)
    const vaultKey = vaultKeyFromSecret(SECRET)
    expect(transcriptKey.equals(vaultKey)).toBe(false)

    const envelope = encryptTranscript(transcriptKey, segments)
    expect(() => decryptTranscript(vaultKey, envelope)).toThrow()
  })

  it('rejects a tampered envelope', () => {
    const key = transcriptKeyFromSecret(SECRET)
    const envelope = encryptTranscript(key, segments)
    const tampered = { ...envelope, ciphertext: Buffer.from('nope').toString('base64') }
    expect(() => decryptTranscript(key, tampered)).toThrow()
  })
})
