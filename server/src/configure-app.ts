import { INestApplication, ValidationPipe } from '@nestjs/common'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { applyBodyParsers } from './body-parsers'

/**
 * Everything a request passes through before it reaches a controller.
 *
 * Shared by `main.ts` and the e2e harness on purpose. These used to be
 * copy-pasted into both, and the copies drifted — the body-parser limit existed
 * in production but not in tests, which surfaced as a 413 in a test with no
 * visible cause. Anything a route needs in order to work belongs here, so it is
 * true in tests by construction.
 *
 * Create the app with `{ bodyParser: false }` — this installs its own.
 */
export function configureApp(app: INestApplication): void {
  applyBodyParsers(app)
  app.use(helmet())
  app.use(cookieParser())
  app.useGlobalPipes(
    new ValidationPipe({
      // Unknown fields are dropped rather than trusted — a client cannot smuggle
      // in a property a DTO never declared.
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  )
}
