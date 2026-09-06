import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { UsersService } from '../../users/users.service'
import { IS_PUBLIC_KEY } from '../decorators/public.decorator'
import { ALLOW_UNVERIFIED_KEY } from '../decorators/allow-unverified.decorator'
import type { RequestUser } from '../decorators/current-user.decorator'

/**
 * Every authenticated route requires a confirmed email address.
 *
 * Applied globally, like the JWT guard, so a new endpoint is protected by
 * default rather than by remembering to decorate it.
 *
 * This cannot take a church off the air: presenting is entirely local — the
 * desktop app talks to ProPresenter, not to this API — so the worst an
 * unverified account suffers is no cloud features until they click the link.
 */
@Injectable()
export class VerifiedEmailGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const bypass = this.reflector.getAllAndOverride<boolean>(ALLOW_UNVERIFIED_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (bypass) return true

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const user = context.switchToHttp().getRequest().user as RequestUser | undefined
    if (!user) return true // The JWT guard already refused this request.

    // Fast path: the token says verified, and verification is never revoked.
    if (user.emailVerified) return true

    // Slow path only for tokens minted before the link was clicked — otherwise
    // someone would stay locked out for up to a full access-token lifetime
    // after doing exactly what they were asked to do.
    const record = await this.users.findById(user.sub)
    if (record?.emailVerifiedAt) {
      user.emailVerified = true
      return true
    }

    throw new ForbiddenException(
      'Confirm your email address first — enter the code we sent you.',
    )
  }
}
