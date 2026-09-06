import { Inject, Injectable } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { APP_CONFIG } from '../../config/config.module'
import type { AppConfig } from '../../config/env'
import type { AccessTokenClaims } from '../token.service'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.jwtSecret,
    })
  }

  /**
   * The claims ARE the identity — no database read on the hot path. That is the
   * whole reason the access token is short-lived: a revoked user keeps working
   * for at most one token lifetime, and rotation is where revocation bites.
   */
  validate(payload: AccessTokenClaims): AccessTokenClaims {
    return payload
  }
}
