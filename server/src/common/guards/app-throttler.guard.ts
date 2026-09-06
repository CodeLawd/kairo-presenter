import { Inject, Injectable } from '@nestjs/common'
import { ThrottlerGuard } from '@nestjs/throttler'
import { APP_CONFIG } from '../../config/config.module'
import type { AppConfig } from '../../config/env'

/**
 * Rate limiting, off under test.
 *
 * The limits are deliberately tight — ten guesses a minute against a six-digit
 * code is the difference between a typo allowance and a brute-force window. But
 * every test speaks from the same address, so leaving it on would make suites
 * fail for reasons that have nothing to do with what they assert, and the usual
 * fix (spacing tests out) trades real coverage for wall-clock time.
 *
 * The trade: throttling itself is exercised by the deployed configuration and
 * by `config/env.spec.ts`, not by the e2e suite.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  @Inject(APP_CONFIG) private readonly appConfig!: AppConfig

  protected async shouldSkip(): Promise<boolean> {
    return this.appConfig?.nodeEnv === 'test'
  }
}
