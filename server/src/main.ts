import 'reflect-metadata'
import { Logger, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { AppModule } from './app.module'
import { APP_CONFIG } from './config/config.module'
import type { AppConfig } from './config/env'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule)
  const config = app.get<AppConfig>(APP_CONFIG)

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
  // The desktop app sends no Origin at all, so this allowlist is a web concern.
  app.enableCors({ origin: config.webOrigins, credentials: true })

  await app.listen(config.port)
  new Logger('Bootstrap').log(`Kairo API listening on :${config.port}`)
}

void bootstrap()
