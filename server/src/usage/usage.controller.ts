import { Body, Controller, HttpCode, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { IsString, MaxLength } from 'class-validator'
import type { UsageReport, UsageReportResult } from '@contracts/usage'
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator'
import { UsageService } from './usage.service'

export class PageViewDto {
  @IsString()
  @MaxLength(200)
  path!: string
}

/**
 * Usage statistics in. Signed-in only (the global JWT and confirmed-email
 * guards apply); the install is the token's device, never the body's claim.
 * The report body is validated field by field in the service, because its
 * maps are keyed by feature names checked against a fixed list.
 */
@Controller('v1/usage')
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('report')
  report(@CurrentUser() user: RequestUser, @Body() body: UsageReport): Promise<UsageReportResult> {
    return this.usage.report({ userId: user.sub, orgId: user.orgId, deviceId: user.deviceId }, body)
  }

  @HttpCode(204)
  @Post('page')
  async page(@CurrentUser() user: RequestUser, @Body() body: PageViewDto): Promise<void> {
    await this.usage.page({ userId: user.sub, orgId: user.orgId, deviceId: user.deviceId }, body.path)
  }
}
