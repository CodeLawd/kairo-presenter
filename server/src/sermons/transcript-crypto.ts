import type { SermonUploadSegment } from '@contracts/contracts'
import { decryptJson, encryptJson, vaultKeyFromSecret } from '../orgs/vault-crypto'

export interface TranscriptEnvelope {
  ciphertext: string
  iv: string
  authTag: string
}

/**
 * A separate key from the org-secrets vault, derived from the same env secret.
 *
 * Domain separation: a transcript envelope and an API-key envelope should never
 * be decryptable with each other's key, so a bug that hands the wrong envelope
 * to the wrong reader fails closed instead of leaking.
 */
export function transcriptKeyFromSecret(secret: string): Buffer {
  return vaultKeyFromSecret(`${secret}|kairo-sermon-transcript`)
}

export function encryptTranscript(
  key: Buffer,
  segments: readonly SermonUploadSegment[],
): TranscriptEnvelope {
  return encryptJson(key, { segments })
}

export function decryptTranscript(
  key: Buffer,
  envelope: TranscriptEnvelope,
): SermonUploadSegment[] {
  return decryptJson<{ segments: SermonUploadSegment[] }>(key, envelope).segments
}
