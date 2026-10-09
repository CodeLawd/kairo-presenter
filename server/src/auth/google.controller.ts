import { randomUUID } from 'node:crypto'
import { Controller, Get, Inject, Req, Res, UseGuards } from '@nestjs/common'
import type { Response } from 'express'
import { AuthService } from './auth.service'
import { GoogleAuthGuard, type GoogleRequest } from '../common/guards/google-auth.guard'
import { Public } from '../common/decorators/public.decorator'
import { APP_CONFIG } from '../config/config.module'
import type { AppConfig } from '../config/env'
import type { GoogleProfile } from './strategies/google.strategy'
import { setRefreshCookie } from './refresh-cookie'
import { googleFailureUrl } from './google-state'

/**
 * Google sign-in, browser only.
 *
 * The desktop app never performs this itself: an Electron window holding a
 * Google login is both a phishing pattern and a support burden. It opens the
 * system browser, the person signs in here, and the desktop is paired with a
 * device code instead — which is why the callback can always redirect to the
 * web app.
 */
@Controller('v1/auth/google')
export class GoogleController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Get('status')
  status(): { enabled: boolean } { return { enabled: Boolean(this.config.google) } }

  @Public()
  @UseGuards(GoogleAuthGuard)
  @Get()
  // Passport redirects to Google before this body ever runs.
  start(): void {}

  @Public()
  @UseGuards(GoogleAuthGuard)
  @Get('callback')
  async callback(@Req() request: GoogleRequest, @Res() response: Response): Promise<void> {
    try {
      const profile = request.user as GoogleProfile
      const result = await this.auth.signInWithGoogle(profile, {
        clientKind: 'web',
        deviceId: randomUUID(),
        userAgent: request.headers['user-agent'],
        ip: request.ip,
      })
      setRefreshCookie(response, result.refreshToken, this.config)
      const destination = new URL(request.googleReturnTo ?? '/dashboard', this.config.publicWebUrl)
      if (result.isNewUser && destination.pathname !== '/onboarding') {
        const onboarding = new URL('/onboarding', this.config.publicWebUrl)
        onboarding.searchParams.set('returnTo', `${destination.pathname}${destination.search}${destination.hash}`)
        response.redirect(onboarding.toString())
      } else {
        response.redirect(destination.toString())
      }
    } catch {
      response.redirect(googleFailureUrl(this.config, 'failed', request.googleReturnTo))
    }
  }
}
