import type { AppConfig } from '../config/env'

/**
 * Kairo staff access, strongest first. A superadmin is listed in
 * SUPERADMIN_EMAILS; an admin holds `platformRole: 'admin'` on their account.
 */
export type PlatformRole = 'superadmin' | 'admin'

export function platformRoleOf(
  user: { email: string; platformRole?: 'admin' | null; status?: string },
  config: Pick<AppConfig, 'superadminEmails'>,
): PlatformRole | null {
  if (user.status && user.status !== 'active') return null
  if (config.superadminEmails.includes(user.email.trim().toLowerCase())) return 'superadmin'
  return user.platformRole === 'admin' ? 'admin' : null
}
