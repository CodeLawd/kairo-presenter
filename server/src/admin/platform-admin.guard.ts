import { CanActivate, ExecutionContext, Inject, Injectable, NotFoundException, SetMetadata } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { APP_CONFIG } from '../config/config.module'
import type { AppConfig } from '../config/env'
import { UsersService } from '../users/users.service'
import type { RequestUser } from '../common/decorators/current-user.decorator'
import { platformRoleOf, type PlatformRole } from '../common/platform-admin'

const SUPERADMIN_ONLY = 'platformSuperadminOnly'

/** Narrows a console route to superadmins (e.g. granting the admin role). */
export const SuperadminOnly = (): MethodDecorator => SetMetadata(SUPERADMIN_ONLY, true)

export type AdminRequestUser = RequestUser & { platformRole: PlatformRole }

/**
 * Kairo staff only — distinct from a church's own "admin" role, which governs
 * one church. The role is resolved from the database (and SUPERADMIN_EMAILS)
 * on every request rather than trusted from the token, so revoking it takes
 * effect immediately.
 *
 * Refuses with 404, not 403: to everyone else the admin API does not exist.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly users: UsersService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const claims = context.switchToHttp().getRequest().user as RequestUser | undefined
    if (!claims) throw new NotFoundException()
    const user = await this.users.findById(claims.sub)
    const role = user ? platformRoleOf(user, this.config) : null
    if (!role) throw new NotFoundException()

    const superadminOnly = this.reflector.getAllAndOverride<boolean>(SUPERADMIN_ONLY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (superadminOnly && role !== 'superadmin') throw new NotFoundException()

    ;(claims as AdminRequestUser).platformRole = role
    return true
  }
}
