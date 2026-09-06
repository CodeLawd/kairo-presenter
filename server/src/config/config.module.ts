import { Global, Module } from '@nestjs/common'
import { config as loadDotenv } from 'dotenv'
import { AppConfig, loadConfig } from './env'

export const APP_CONFIG = Symbol('APP_CONFIG')

/**
 * Config is resolved once, at boot, and injected everywhere as a plain object.
 * Nothing downstream reads `process.env` — that keeps every consumer testable
 * with a literal, and keeps validation in exactly one place.
 */
@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => {
        // Tests must be hermetic: whatever a developer happens to have in their
        // own .env (real Google keys, a live Brevo key) must never decide what
        // the suite exercises, or a passing run on one machine proves nothing
        // about another.
        if (process.env.NODE_ENV !== 'test') {
          // Real environment variables win — dotenv never overwrites them, so
          // .env stays a local convenience while Render's injected variables
          // remain authoritative in production.
          loadDotenv()
        }
        return loadConfig()
      },
    },
  ],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
