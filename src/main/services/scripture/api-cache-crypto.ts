import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import fs from 'fs'
import path from 'path'

const ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32
const IV_BYTES = 12
const AUTH_TAG_BYTES = 16

export interface EncryptedValue {
  ciphertext: string
  iv: string
  authTag: string
}

/** Wraps/unwraps the data key with the OS keychain. Injectable for tests. */
export interface KeyProtector {
  isAvailable(): boolean
  protect(key: Buffer): Buffer
  unprotect(blob: Buffer): Buffer
}

export class ApiCacheUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ApiCacheUnavailableError'
  }
}

/**
 * AES-256-GCM for API.Bible-derived verse text. The data key lives only in the
 * main process and is stored on disk wrapped by Electron `safeStorage`; when the
 * OS offers no encryption we fail closed rather than persist licensed plaintext.
 */
export class ApiCacheCrypto {
  private constructor(private readonly key: Buffer) {
    if (key.length !== KEY_BYTES) {
      throw new Error(`API cache key must be ${KEY_BYTES} bytes`)
    }
  }

  encrypt(plaintext: string): EncryptedValue {
    const iv = randomBytes(IV_BYTES)
    const cipher = createCipheriv(ALGORITHM, this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    }
  }

  decrypt(value: EncryptedValue): string {
    const iv = Buffer.from(value.iv, 'base64')
    const authTag = Buffer.from(value.authTag, 'base64')
    if (iv.length !== IV_BYTES) throw new Error('API cache IV is malformed')
    if (authTag.length !== AUTH_TAG_BYTES) throw new Error('API cache auth tag is malformed')
    const decipher = createDecipheriv(ALGORITHM, this.key, iv)
    decipher.setAuthTag(authTag)
    return Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  }

  /**
   * Loads the wrapped data key at `keyPath`, creating one on first use.
   * Throws `ApiCacheUnavailableError` when OS-backed encryption is unavailable.
   */
  static open(keyPath: string, protector: KeyProtector = safeStorageProtector()): ApiCacheCrypto {
    if (!protector.isAvailable()) {
      throw new ApiCacheUnavailableError(
        'OS encryption is unavailable, so licensed scripture cannot be cached.',
      )
    }
    if (fs.existsSync(keyPath)) {
      return new ApiCacheCrypto(protector.unprotect(fs.readFileSync(keyPath)))
    }
    const key = randomBytes(KEY_BYTES)
    fs.mkdirSync(path.dirname(keyPath), { recursive: true })
    fs.writeFileSync(keyPath, protector.protect(key), { mode: 0o600 })
    return new ApiCacheCrypto(key)
  }

  static forTesting(key: Buffer): ApiCacheCrypto {
    return new ApiCacheCrypto(key)
  }
}

/** Resolved lazily so this module stays importable outside an Electron runtime. */
function safeStorageProtector(): KeyProtector {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { safeStorage } = require('electron') as typeof import('electron')
  return {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    protect: (key) => safeStorage.encryptString(key.toString('base64')),
    unprotect: (blob) => Buffer.from(safeStorage.decryptString(blob), 'base64'),
  }
}
