import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

const ALGO = 'aes-256-gcm'
const IV_BYTES = 12

/**
 * AES-256-GCM envelope for the org secrets JSON blob.
 *
 * Key material is a 32-byte secret from env (base64 or raw utf8 padded/hashed
 * by the caller into 32 bytes before reaching here).
 */
export function encryptJson(key: Buffer, plaintext: object): {
  ciphertext: string
  iv: string
  authTag: string
} {
  if (key.length !== 32) {
    throw new Error('Vault key must be exactly 32 bytes')
  }
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, key, iv)
  const json = Buffer.from(JSON.stringify(plaintext), 'utf8')
  const encrypted = Buffer.concat([cipher.update(json), cipher.final()])
  const authTag = cipher.getAuthTag()
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  }
}

export function decryptJson<T extends object>(
  key: Buffer,
  envelope: { ciphertext: string; iv: string; authTag: string },
): T {
  if (key.length !== 32) {
    throw new Error('Vault key must be exactly 32 bytes')
  }
  const decipher = createDecipheriv(ALGO, key, Buffer.from(envelope.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ])
  return JSON.parse(decrypted.toString('utf8')) as T
}

/** Accepts base64 (preferred) or a long utf8 passphrase; always yields 32 bytes. */
export function vaultKeyFromSecret(secret: string): Buffer {
  const trimmed = secret.trim()
  try {
    const fromB64 = Buffer.from(trimmed, 'base64')
    if (fromB64.length === 32) return fromB64
  } catch {
    // fall through
  }
  if (Buffer.byteLength(trimmed, 'utf8') === 32) {
    return Buffer.from(trimmed, 'utf8')
  }
  // SHA-256 of whatever they gave us — deterministic, 32 bytes.
  return createHash('sha256').update(trimmed, 'utf8').digest()
}
