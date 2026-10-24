import { Body, Controller, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { CrashUpload, CrashUploadResult } from '@contracts/crashes'
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator'
import { CrashesService } from './crashes.service'

/**
 * Crash summaries in. Signed-in only (the global JWT and confirmed-email
 * guards apply); the install is the token's device, never the body's claim.
 */
@Controller('v1/crashes')
export class CrashesController {
  constructor(private readonly crashes: CrashesService) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  report(@CurrentUser() user: RequestUser, @Body() body: CrashUpload): Promise<CrashUploadResult> {
    return this.crashes.report({ userId: user.sub, orgId: user.orgId, deviceId: user.deviceId }, body)
  }
}
