import { Injectable } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { Strategy, Profile, VerifyCallback } from 'passport-google-oauth20'
import type { AppConfig } from '../../config/env'

export interface GoogleProfile {
  googleId: string
  email: string
  emailAuthoritative: boolean
  name: string
  avatarUrl?: string
}

/**
 * Constructed only when both halves of the credential are present — see the
 * provider in `auth.module.ts`. Passport registers a strategy by side effect at
 * construction, so building this unconditionally would advertise a Google
 * button that could never work.
 */
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: NonNullable<AppConfig['google']>) {
    super({
      clientID: config.clientId,
      clientSecret: config.clientSecret,
      callbackURL: config.callbackUrl,
      scope: ['email', 'profile'],
      // GoogleAuthGuard signs state and binds it to an HttpOnly browser cookie.
      state: false,
    })
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): void {
    const email = profile.emails?.[0]?.value?.trim().toLowerCase()
    const claims = profile._json as { email_verified?: boolean; hd?: string }
    if (claims.email_verified !== true) {
      done(new Error('Google email address is not verified'), undefined)
      return
    }
    if (!email) {
      // Google can return a profile with no address on some workspace configs;
      // there is no account to link without one.
      done(new Error('Google account has no email address'), undefined)
      return
    }
    const resolved: GoogleProfile = {
      googleId: profile.id,
      email,
      emailAuthoritative: email.endsWith('@gmail.com') || Boolean(claims.hd && email.endsWith(`@${claims.hd.toLowerCase()}`)),
      name: profile.displayName || email.split('@')[0],
      avatarUrl: profile.photos?.[0]?.value,
    }
    done(null, resolved)
  }
}
