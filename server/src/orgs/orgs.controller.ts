import { Body, Controller, Get, Param, Patch, Put, UseGuards } from '@nestjs/common'
import { OrgsService } from './orgs.service'
import { OrgSecretsService } from './org-secrets.service'
import { UpdateOrgDto } from './dto/org.dto'
import { UpsertOrgSecretsDto } from './dto/secrets.dto'
import { Roles } from '../common/decorators/roles.decorator'
import { OrgRoleGuard } from '../common/guards/org-role.guard'
import { CurrentUser, RequestUser } from '../common/decorators/current-user.decorator'

@Controller('v1/orgs')
@UseGuards(OrgRoleGuard)
export class OrgsController {
  constructor(
    private readonly orgs: OrgsService,
    private readonly secrets: OrgSecretsService,
  ) {}

  /** Every org the caller belongs to — the org switcher's data. */
  @Get()
  async list(@CurrentUser() user: RequestUser): Promise<unknown[]> {
    const memberships = await this.orgs.membershipsOf(user.sub)
    const orgs = await Promise.all(
      memberships.map(async (membership) => {
        const org = await this.orgs.findById(membership.orgId)
        return org ? { id: org._id.toString(), name: org.name, role: membership.role } : null
      }),
    )
    return orgs.filter((org) => org !== null)
  }

  @Get(':orgId')
  @Roles('viewer')
  async get(@Param('orgId') orgId: string): Promise<unknown> {
    const org = await this.orgs.requireById(orgId)
    return {
      id: org._id.toString(),
      name: org.name,
      slug: org.slug,
      timezone: org.timezone,
      serviceTimes: org.serviceTimes,
      seatsUsed: org.seatsUsed,
    }
  }

  @Patch(':orgId')
  @Roles('admin')
  async update(@Param('orgId') orgId: string, @Body() dto: UpdateOrgDto): Promise<unknown> {
    const org = await this.orgs.updateProfile(orgId, {
      name: dto.name,
      timezone: dto.timezone,
      serviceTimes: dto.serviceTimes,
    })
    return {
      id: org._id.toString(),
      name: org.name,
      timezone: org.timezone,
      serviceTimes: org.serviceTimes,
    }
  }

  @Get(':orgId/members')
  @Roles('viewer')
  async members(@Param('orgId') orgId: string): Promise<unknown[]> {
    const members = await this.orgs.listMembers(orgId)
    return members.map((member) => ({
      userId: member.userId.toString(),
      role: member.role,
      status: member.status,
      joinedAt: member.joinedAt,
    }))
  }

  /**
   * Org API-key vault. Any active member can read/write for now; finer roles
   * come later. Values are decrypted only for the response — Mongo holds
   * ciphertext only.
   */
  @Get(':orgId/secrets')
  @Roles('viewer')
  async getSecrets(@Param('orgId') orgId: string): Promise<unknown> {
    return this.secrets.get(orgId)
  }

  @Put(':orgId/secrets')
  @Roles('viewer')
  async putSecrets(
    @Param('orgId') orgId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpsertOrgSecretsDto,
  ): Promise<unknown> {
    return this.secrets.put(orgId, user.sub, {
      deepgramApiKey: dto.deepgramApiKey,
      anthropicApiKey: dto.anthropicApiKey,
      deepseekApiKey: dto.deepseekApiKey,
      bibleApiKey: dto.bibleApiKey,
      braveApiKey: dto.braveApiKey,
      googleTranslateApiKey: dto.googleTranslateApiKey,
    })
  }
}
