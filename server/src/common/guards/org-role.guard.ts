import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { OrgsService } from '../../orgs/orgs.service'
import { ROLES_KEY } from '../decorators/roles.decorator'
import { ORG_ROLES, OrgRole } from '../../orgs/schemas/membership.schema'
import type { RequestUser } from '../decorators/current-user.decorator'

/**
 * Org scoping, enforced from the database rather than from the token.
 *
 * The JWT carries a role, but it was minted up to 15 minutes ago — and the
 * `:orgId` in the path is whatever the caller typed. So membership is re-read
 * for the org actually being addressed. Without this, any signed-in user could
 * read any other church's data simply by changing the id in the URL.
 */
@Injectable()
export class OrgRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly orgs: OrgsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<OrgRole | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!required) return true

    const request = context.switchToHttp().getRequest()
    const user = request.user as RequestUser | undefined
    if (!user) throw new ForbiddenException('Not signed in')

    const orgId = request.params?.orgId ?? user.orgId
    const membership = await this.orgs.membershipOf(user.sub, orgId)
    if (!membership) throw new ForbiddenException('You do not have access to this organization')

    if (ORG_ROLES.indexOf(membership.role) < ORG_ROLES.indexOf(required)) {
      throw new ForbiddenException(`This action requires the ${required} role`)
    }

    // Hand the live role downstream so controllers never re-read it.
    user.membershipRole = membership.role
    return true
  }
}
