import { Body, Controller, Get, Inject, Param, Post, BadRequestException, UseGuards } from '@nestjs/common'
import { Public } from '../common/decorators/public.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { OrgRoleGuard } from '../common/guards/org-role.guard'
import { MailService } from '../mail/mail.service'
import { APP_CONFIG } from '../config/config.module'
import type { AppConfig } from '../config/env'
import { EngageInternalGuard } from './engage-internal.guard'
import { EngageInviteDto, EngagementIndexDto } from './engage.dto'
import { EngagementIndexService } from './engagement-index.service'

@Controller('v1/internal/engage')
@UseGuards(EngageInternalGuard)
export class EngageInternalController {
  constructor(
    private readonly index: EngagementIndexService,
    private readonly mail: MailService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('index')
  async write(@Body() dto: EngagementIndexDto): Promise<{ ok: true }> {
    await this.index.write(dto)
    return { ok: true }
  }

  @Public()
  @Post('invite')
  async invite(@Body() dto: EngageInviteDto): Promise<{ ok: true }> {
    const url = new URL(dto.link)
    if (url.origin !== new URL(this.config.publicWebUrl).origin || !/^\/engage\/m\/[^/]+$/.test(url.pathname) || url.search || url.hash || url.username || url.password) {
      throw new BadRequestException('Invalid Engage invitation URL')
    }
    await this.mail.sendEngageInvite(dto.to, dto.engagementName, dto.link, dto.orgName)
    return { ok: true }
  }
}

@Controller('v1/orgs/:orgId/engagements')
@UseGuards(OrgRoleGuard)
export class EngagementsController {
  constructor(private readonly index: EngagementIndexService) {}

  @Get()
  @Roles('admin')
  list(@Param('orgId') orgId: string) {
    return this.index.list(orgId)
  }
}
