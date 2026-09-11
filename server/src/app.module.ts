import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { MongooseModule } from '@nestjs/mongoose'
import { ThrottlerModule } from '@nestjs/throttler'
import { AppConfigModule, APP_CONFIG } from './config/config.module'
import type { AppConfig } from './config/env'
import { AuthModule } from './auth/auth.module'
import { UsersModule } from './users/users.module'
import { OrgsModule } from './orgs/orgs.module'
import { SermonsModule } from './sermons/sermons.module'
import { MailModule } from './mail/mail.module'
import { HealthController } from './health/health.controller'
import { JwtAuthGuard } from './common/guards/jwt-auth.guard'
import { VerifiedEmailGuard } from './common/guards/verified-email.guard'
import { AppThrottlerGuard } from './common/guards/app-throttler.guard'

@Module({
  imports: [
    AppConfigModule,
    MailModule,
    MongooseModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({ uri: config.mongoUrl }),
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    UsersModule,
    OrgsModule,
    SermonsModule,
    AuthModule,
  ],
  controllers: [HealthController],
  providers: [
    // Protected by default — a route is public only when it says so.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Order matters: this runs after the JWT guard, so `request.user` exists.
    // Every authenticated route needs a confirmed address unless it is one of
    // the few things required to GET confirmed (@AllowUnverified).
    { provide: APP_GUARD, useClass: VerifiedEmailGuard },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
  ],
})
export class AppModule {}
