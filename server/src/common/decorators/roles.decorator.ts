import { SetMetadata } from '@nestjs/common'
import type { OrgRole } from '../../orgs/schemas/membership.schema'

export const ROLES_KEY = 'orgRoles'

/** Minimum role required. Roles are ranked, so `Roles('admin')` admits owners. */
export const Roles = (role: OrgRole): MethodDecorator => SetMetadata(ROLES_KEY, role)
