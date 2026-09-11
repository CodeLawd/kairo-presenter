import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import type { OrgDevice } from '@contracts/contracts'
import { Roles } from '../common/decorators/roles.decorator'
import { OrgRoleGuard } from '../common/guards/org-role.guard'
import { UsersService } from '../users/users.service'
import {
  blankToNull,
  DEVICE_ONLINE_MS,
  displayDeviceName,
  inferDeviceFromUserAgent,
  mergeDeviceInfo,
  osLabel,
} from './device-info'
import { TokenService } from './token.service'

/**
 * Booth machines currently signed into this church.
 *
 * Lives next to auth rather than orgs: the source of truth is the session
 * table, and importing TokenService into OrgsModule would cycle Auth ↔ Orgs.
 */
@Controller('v1/orgs/:orgId/devices')
@UseGuards(OrgRoleGuard)
export class OrgDevicesController {
  constructor(
    private readonly tokens: TokenService,
    private readonly users: UsersService,
  ) {}

  @Get()
  @Roles('viewer')
  async list(@Param('orgId') orgId: string): Promise<OrgDevice[]> {
    const rows = await this.tokens.listLiveDesktop(orgId)
    const people = await this.users.findByIds(rows.map((row) => row.userId))
    const byId = new Map(people.map((person) => [person._id.toString(), person]))
    const now = Date.now()
    return rows.map((row) => {
      const person = byId.get(row.userId.toString())
      const device = mergeDeviceInfo(inferDeviceFromUserAgent(row.userAgent), row.device)
      const hostname = blankToNull(device.hostname)
      return {
        id: row.deviceId,
        name: displayDeviceName({ hostname: hostname ?? undefined, deviceName: row.deviceName }),
        hostname,
        os: osLabel(blankToNull(device.os)),
        osVersion: blankToNull(device.osVersion),
        arch: blankToNull(device.arch),
        appVersion: blankToNull(device.appVersion),
        electronVersion: blankToNull(device.electronVersion),
        signedInAs: person?.name || person?.email || 'Unknown',
        signedInEmail: person?.email ?? null,
        lastSeenAt: row.lastSeenAt.toISOString(),
        lastLoginAt: row.lastLoginAt.toISOString(),
        ip: blankToNull(row.ip),
        online: now - row.lastSeenAt.getTime() < DEVICE_ONLINE_MS,
      }
    })
  }
}
