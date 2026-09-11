import type { AppConfig } from './env'
import { loadConfig } from './env'

/**
 * An `AppConfig` for unit tests.
 *
 * Built from `loadConfig` with the minimum env it demands, so a new config
 * field picks up its real default here instead of being hand-typed into every
 * spec that happens to need a config object.
 */
export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ...loadConfig({
      NODE_ENV: 'test',
      MONGO_URL: 'mongodb://localhost/test',
      JWT_SECRET: 'x'.repeat(48),
      VAULT_ENCRYPTION_KEY: 'y'.repeat(48),
    }),
    ...overrides,
  }
}
