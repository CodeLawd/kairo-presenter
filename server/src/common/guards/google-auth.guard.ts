import { ExecutionContext, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import type { Request } from 'express'
import { APP_CONFIG } from '../../config/config.module'
import type { AppConfig } from '../../config/env'

/**
 * Fails loudly and correctly when Google is not configured.
 *
 * Without this the passport strategy simply would not exist and the route would
 * answer a bare 500 — indistinguishable from a real outage. 503 with a plain
 * message tells an operator exactly what is missing.
 */
@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    super()
  }

  canActivate(context: ExecutionContext) {
    if (!this.config?.google) {
      throw new ServiceUnavailableException('Google sign-in is not configured on this server')
    }
    return super.canActivate(context)
  }

  /**
   * Carries the caller's `?returnTo=` across the round trip as the OAuth
   * `state` parameter. That is the sessionless equivalent of passport's
   * `state: true`, which would require server-side session storage this API
   * deliberately does not have.
   */
  getAuthenticateOptions(context: ExecutionContext): Record<string, unknown> {
    const request = context.switchToHttp().getRequest<Request>()
    const returnTo = request.query?.returnTo
    return typeof returnTo === 'string' && returnTo.startsWith('/') ? { state: returnTo } : {}
  }
}
