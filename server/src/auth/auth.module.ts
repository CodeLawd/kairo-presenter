import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { MongooseModule } from '@nestjs/mongoose'
import { PassportModule } from '@nestjs/passport'
import { AuthController } from './auth.controller'
import { DeviceController } from './device.controller'
import { DeviceFlowService } from './device-flow.service'
import { AuthService } from './auth.service'
import { PasswordService } from './password.service'
import { TokenService } from './token.service'
import { JwtStrategy } from './strategies/jwt.strategy'
import { GoogleStrategy } from './strategies/google.strategy'
import { GoogleController } from './google.controller'
import { OrgDevicesController } from './org-devices.controller'
import { Session, SessionSchema } from './schemas/session.schema'
import { EmailToken, EmailTokenSchema } from './schemas/email-token.schema'
import {
  DeviceAuthRequest,
  DeviceAuthRequestSchema,
} from './schemas/device-auth-request.schema'
import { UsersModule } from '../users/users.module'
import { OrgsModule } from '../orgs/orgs.module'
import { APP_CONFIG } from '../config/config.module'
import type { AppConfig } from '../config/env'

@Module({
  imports: [
    UsersModule,
    OrgsModule,
    PassportModule,
    MongooseModule.forFeature([
      { name: Session.name, schema: SessionSchema },
      { name: EmailToken.name, schema: EmailTokenSchema },
      { name: DeviceAuthRequest.name, schema: DeviceAuthRequestSchema },
    ]),
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({ secret: config.jwtSecret }),
    }),
  ],
  controllers: [AuthController, DeviceController, GoogleController, OrgDevicesController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    DeviceFlowService,
    JwtStrategy,
    {
      // Built only when credentials exist. Passport registers a strategy as a
      // side effect of construction, so building this unconditionally would
      // advertise a Google button that could never complete.
      provide: GoogleStrategy,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.google ? new GoogleStrategy(config.google) : null,
    },
  ],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
