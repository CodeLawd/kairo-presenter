import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { configureApp } from './configure-app'
import { APP_CONFIG } from './config/config.module'
import type { AppConfig } from './config/env'

async function bootstrap(): Promise<void> {
  // Body parsing is installed by hand so the sermon upload route can be wider
  // than everything else — see `configureApp`.
  const app = await NestFactory.create(AppModule, { bodyParser: false })
  const config = app.get<AppConfig>(APP_CONFIG)

  configureApp(app)
  // The desktop app sends no Origin at all, so this allowlist is a web concern.
  app.enableCors({ origin: config.webOrigins, credentials: true })

  await app.listen(config.port)
  new Logger('Bootstrap').log(`Kairo API listening on :${config.port}`)
}

void bootstrap()
