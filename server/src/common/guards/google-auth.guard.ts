import { ExecutionContext, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import type { Request, Response } from 'express'
import { APP_CONFIG } from '../../config/config.module'
import type { AppConfig } from '../../config/env'
import {
  GOOGLE_STATE_COOKIE, GOOGLE_STATE_MAX_AGE, googleStateCookieOptions,
  issueGoogleState, readGoogleState, googleFailureUrl,
} from '../../auth/google-state'

export interface GoogleRequest extends Request { googleReturnTo?: string }

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) { super() }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.config.google) throw new ServiceUnavailableException('Google sign-in is not configured on this server')
    const request = context.switchToHttp().getRequest<GoogleRequest>()
    const response = context.switchToHttp().getResponse<Response>()
    if (!request.path.endsWith('/callback')) return super.canActivate(context) as Promise<boolean>

    const returnTo = readGoogleState(request.query.state, request.cookies?.[GOOGLE_STATE_COOKIE], this.config)
    response.clearCookie(GOOGLE_STATE_COOKIE, googleStateCookieOptions(this.config))
    response.setHeader?.('Cache-Control', 'no-store')
    response.setHeader?.('Referrer-Policy', 'no-referrer')
    if (!returnTo) {
      response.redirect(googleFailureUrl(this.config, 'expired'))
      return false
    }
    request.googleReturnTo = returnTo
    if (request.query.error || typeof request.query.code !== 'string' || !request.query.code) {
      response.redirect(googleFailureUrl(this.config, request.query.error === 'access_denied' ? 'cancelled' : 'failed', returnTo))
      return false
    }
    try { return await super.canActivate(context) as boolean }
    catch {
      response.redirect(googleFailureUrl(this.config, 'failed', returnTo))
      return false
    }
  }

  getAuthenticateOptions(context: ExecutionContext): Record<string, unknown> {
    const request = context.switchToHttp().getRequest<Request>()
    if (request.path.endsWith('/callback')) return {}
    const response = context.switchToHttp().getResponse<Response>()
    const state = issueGoogleState(request.query.returnTo, this.config)
    response.cookie(GOOGLE_STATE_COOKIE, state, { ...googleStateCookieOptions(this.config), maxAge: GOOGLE_STATE_MAX_AGE })
    response.setHeader?.('Cache-Control', 'no-store')
    return { state, prompt: 'select_account' }
  }
}
