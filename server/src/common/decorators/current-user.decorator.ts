import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import type { AccessTokenClaims } from '../../auth/token.service'

export interface RequestUser extends AccessTokenClaims {
  /** Resolved by OrgRoleGuard when the route is org-scoped. */
  membershipRole?: AccessTokenClaims['role']
  /** Upgraded in place by VerifiedEmailGuard after a fresh database check. */
  emailVerified: boolean
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestUser => {
    return context.switchToHttp().getRequest().user as RequestUser
  },
)
