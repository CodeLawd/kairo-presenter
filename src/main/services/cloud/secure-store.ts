import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import fs from 'fs'
import path from 'path'
import { safeStorage, app } from 'electron'
import log from 'electron-log/main'

const ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32
const IV_BYTES = 12

/** Wraps the data key with the OS keychain. Injectable so tests need no keychain. */
export interface KeyProtector {
  isAvailable(): boolean
  protect(key: Buffer): Buffer
  unprotect(blob: Buffer): Buffer
}

interface StoredBlob {
  ciphertext: string
  iv: string
  authTag: string
}

/**
 * Encrypted at-rest storage for the refresh token.
 *
 * Same AES-256-GCM + `safeStorage`-wrapped data key as
 * `scripture/api-cache-crypto.ts`, with one deliberate difference: this one
 * FAILS OPEN. That module refuses to run without encryption because it caches
 * licensed Bible text; here, a machine with no keychain (a bare Linux box, a
 * locked-down image) must still run Kairo — it simply will not remember
 * the sign-in between launches. Refusing to launch over a missing keyring would
 * take a church off the air for a feature they may not even use.
 *
 * The token never goes near `kairo-settings.json`, which is plaintext and
 * gets copied around.
 */
export class SecureStore {
  private key: Buffer | null = null

  constructor(
    private readonly dir: string,
    private readonly protector: KeyProtector,
  ) {}

  /** False when the OS offers no encryption — the caller degrades, never throws. */
  get available(): boolean {
    return this.protector.isAvailable()
  }

  read(name: string): string | null {
    if (!this.available) return null
    const file = this.pathFor(name)
    if (!fs.existsSync(file)) return null

    try {
      const blob = JSON.parse(fs.readFileSync(file, 'utf8')) as StoredBlob
      const key = this.loadKey()
      if (!key) return null

      const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(blob.iv, 'base64'))
      decipher.setAuthTag(Buffer.from(blob.authTag, 'base64'))
      return Buffer.concat([
        decipher.update(Buffer.from(blob.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8')
    } catch (error) {
      // A tampered or key-rotated blob is not recoverable and not worth a crash:
      // drop it and let the operator sign in again.
      log.warn('[Cloud] Stored credential could not be read — discarding', {
        error: (error as Error).message,
      })
      this.clear(name)
      return null
    }
  }

  write(name: string, value: string): boolean {
    if (!this.available) {
      log.info('[Cloud] No OS encryption available — the sign-in will not persist')
      return false
    }
    try {
      const key = this.loadKey() ?? this.createKey()
      const iv = randomBytes(IV_BYTES)
      const cipher = createCipheriv(ALGORITHM, key, iv)
      const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      const blob: StoredBlob = {
        ciphertext: ciphertext.toString('base64'),
        iv: iv.toString('base64'),
        authTag: cipher.getAuthTag().toString('base64'),
      }
      fs.mkdirSync(this.dir, { recursive: true })
      fs.writeFileSync(this.pathFor(name), JSON.stringify(blob), { mode: 0o600 })
      return true
    } catch (error) {
      log.warn('[Cloud] Could not store credential', { error: (error as Error).message })
      return false
    }
  }

  clear(name: string): void {
    try {
      fs.rmSync(this.pathFor(name), { force: true })
    } catch {
      // Nothing to do — a credential we cannot delete is one we already ignore.
    }
  }

  private pathFor(name: string): string {
    return path.join(this.dir, `${name}.enc`)
  }

  private keyPath(): string {
    return path.join(this.dir, 'key.bin')
  }

  private loadKey(): Buffer | null {
    if (this.key) return this.key
    const file = this.keyPath()
    if (!fs.existsSync(file)) return null
    try {
      this.key = this.protector.unprotect(fs.readFileSync(file))
      return this.key.length === KEY_BYTES ? this.key : null
    } catch {
      return null
    }
  }

  private createKey(): Buffer {
    const key = randomBytes(KEY_BYTES)
    fs.mkdirSync(this.dir, { recursive: true })
    fs.writeFileSync(this.keyPath(), this.protector.protect(key), { mode: 0o600 })
    this.key = key
    return key
  }
}

/** The real protector, backed by the OS keychain. */
export const electronKeyProtector: KeyProtector = {
  isAvailable: () => {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  },
  protect: (key) => safeStorage.encryptString(key.toString('base64')),
  unprotect: (blob) => Buffer.from(safeStorage.decryptString(blob), 'base64'),
}

export function createSecureStore(protector: KeyProtector = electronKeyProtector): SecureStore {
  return new SecureStore(path.join(app.getPath('userData'), 'cloud'), protector)
}
