import { randomUUID } from 'node:crypto'
import { Controller, Get, Inject, Req, Res, UseGuards } from '@nestjs/common'
import type { Request, Response } from 'express'
import { AuthService } from './auth.service'
import { GoogleAuthGuard } from '../common/guards/google-auth.guard'
import { Public } from '../common/decorators/public.decorator'
import { APP_CONFIG } from '../config/config.module'
import type { AppConfig } from '../config/env'
import type { GoogleProfile } from './strategies/google.strategy'

const REFRESH_COOKIE = 'pa_refresh'

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
  @UseGuards(GoogleAuthGuard)
  @Get()
  // Passport redirects to Google before this body ever runs.
  start(): void {}

  @Public()
  @UseGuards(GoogleAuthGuard)
  @Get('callback')
  async callback(@Req() request: Request, @Res() response: Response): Promise<void> {
    const profile = request.user as GoogleProfile
    const result = await this.auth.signInWithGoogle(profile, {
      clientKind: 'web',
      deviceId: randomUUID(),
      userAgent: request.headers['user-agent'],
      ip: request.ip,
    })

    response.cookie(REFRESH_COOKIE, result.refreshToken, {
      httpOnly: true,
      secure: this.config.nodeEnv === 'production',
      sameSite: 'lax',
      path: '/v1/auth',
      maxAge: this.config.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
    })

    // `state` carries where the person was going — commonly /activate, when
    // they started this to pair a booth machine.
    const target = safeReturnTo(request.query.state, this.config.publicWebUrl)
    response.redirect(target)
  }
}

/**
 * Only ever redirect within our own web app. An open redirect here would let a
 * crafted link bounce a freshly-authenticated person to an attacker's page.
 */
function safeReturnTo(state: unknown, baseUrl: string): string {
  if (typeof state !== 'string' || !state.startsWith('/')) return `${baseUrl}/auth/callback`
  if (state.startsWith('//')) return `${baseUrl}/auth/callback`
  return `${baseUrl}${state}`
}
