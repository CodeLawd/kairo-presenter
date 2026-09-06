import { Injectable } from '@nestjs/common'
import * as argon2 from 'argon2'

/**
 * Argon2id at the OWASP-recommended floor: 64 MiB, 3 passes, 4 lanes.
 *
 * Deliberately expensive — the whole point is that an attacker holding the
 * hashes cannot try many candidates per second. Do not lower these to speed up
 * the login endpoint; a login is one hash, an attack is billions.
 */
const OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
}

/** Deliberately low: the rule is length, not punctuation gymnastics. */
export const MIN_PASSWORD_LENGTH = 10

@Injectable()
export class PasswordService {
  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, OPTIONS)
  }

  /**
   * A malformed or missing hash is a false, never a throw — a Google-only
   * account has no password, and that must read as "wrong credentials" rather
   * than as a server error that tells an attacker the account exists.
   */
  async verify(hash: string | undefined, plain: string): Promise<boolean> {
    if (!hash) return false
    try {
      return await argon2.verify(hash, plain)
    } catch {
      return false
    }
  }
}
