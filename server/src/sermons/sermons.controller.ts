import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type {
  SermonDetail,
  SermonListPage,
  SermonStats,
  SermonTranscriptPayload,
  SermonUploadResult,
} from '@contracts/contracts'
import { Roles } from '../common/decorators/roles.decorator'
import { OrgRoleGuard } from '../common/guards/org-role.guard'
import { CurrentUser, RequestUser } from '../common/decorators/current-user.decorator'
import { SermonsService } from './sermons.service'
import { SermonGenerationService } from './sermon-generation.service'
import { ListSermonsDto, ShareSermonDto, StatsQueryDto, UpdateSermonDto, UploadSermonDto } from './dto/sermon.dto'

/**
 * Every route here carries `@Roles` deliberately: `OrgRoleGuard` returns true
 * when the metadata is absent, so an org-scoped route without it would be
 * readable across tenants.
 */
@Controller('v1/orgs/:orgId/sermons')
@UseGuards(OrgRoleGuard)
export class SermonsController {
  constructor(
    private readonly sermons: SermonsService,
    private readonly generation: SermonGenerationService,
  ) {}

  /**
   * The booth uploading a finished service. Returns as soon as the transcript
   * is stored — the summary is generated afterwards, so a slow model never
   * holds a church's upload open.
   */
  @Post()
  @Roles('operator')
  @HttpCode(202)
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  async upload(
    @Param('orgId') orgId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UploadSermonDto,
  ): Promise<SermonUploadResult> {
    const sermon = await this.sermons.upload(orgId, user.sub, dto)
    this.generation.enqueue(sermon._id.toString())
    return { id: sermon._id.toString(), status: sermon.status }
  }

  @Get()
  @Roles('viewer')
  async list(
    @Param('orgId') orgId: string,
    @Query() query: ListSermonsDto,
  ): Promise<SermonListPage> {
    return this.sermons.list(orgId, {
      limit: query.limit,
      cursor: query.cursor,
      range: query.range,
      from: query.from,
      to: query.to,
      speaker: query.speaker,
    })
  }

  /**
   * Org-wide totals for the dashboard. Declared before `:sermonId` on
   * purpose — Nest matches in order, and otherwise "stats" reads as an id.
   */
  @Get('stats')
  @Roles('viewer')
  async stats(
    @Param('orgId') orgId: string,
    @Query() query: StatsQueryDto,
  ): Promise<SermonStats> {
    return this.sermons.stats(orgId, {
      range: query.range,
      from: query.from,
      to: query.to,
      speaker: query.speaker,
    })
  }

  @Get(':sermonId')
  @Roles('viewer')
  async detail(
    @Param('orgId') orgId: string,
    @Param('sermonId') sermonId: string,
  ): Promise<SermonDetail> {
    const sermon = await this.sermons.requireInOrg(orgId, sermonId)
    return this.sermons.toDetail(sermon)
  }

  /** Separate from the detail route: much larger, read far less, stricter role. */
  @Get(':sermonId/transcript')
  @Roles('operator')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async transcript(
    @Param('orgId') orgId: string,
    @Param('sermonId') sermonId: string,
  ): Promise<SermonTranscriptPayload> {
    const sermon = await this.sermons.requireInOrg(orgId, sermonId, { withTranscript: true })
    return { segments: this.sermons.readableTranscriptOf(sermon) }
  }

  /** Write the recap again — after a failure, or when the first one was poor. */
  @Post(':sermonId/summary')
  @Roles('operator')
  @HttpCode(202)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  async regenerate(
    @Param('orgId') orgId: string,
    @Param('sermonId') sermonId: string,
  ): Promise<SermonDetail> {
    const sermon = await this.sermons.resetForRegeneration(orgId, sermonId)
    this.generation.enqueue(sermon._id.toString())
    return this.sermons.toDetail(sermon)
  }

  /**
   * Keep the recap that is already on the page and drop the rewrite in flight.
   *
   * Declared after `summary` so Nest does not treat "cancel" as a sermon id;
   * the extra path segment is what distinguishes the two.
   */
  @Post(':sermonId/summary/cancel')
  @Roles('operator')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async cancel(
    @Param('orgId') orgId: string,
    @Param('sermonId') sermonId: string,
  ): Promise<SermonDetail> {
    // Restore `ready` before dropping the queue: a first recap (no summary yet)
    // is refused, and dequeueing it first would leave generation stranded.
    const sermon = await this.sermons.cancelRegeneration(orgId, sermonId)
    this.generation.cancel(sermonId)
    return this.sermons.toDetail(sermon)
  }

  @Patch(':sermonId')
  @Roles('operator')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async update(
    @Param('orgId') orgId: string,
    @Param('sermonId') sermonId: string,
    @Body() dto: UpdateSermonDto,
  ): Promise<SermonDetail> {
    const sermon = await this.sermons.updateMeta(orgId, sermonId, {
      title: dto.title,
      speaker: dto.speaker,
      headline: dto.headline,
    })
    return this.sermons.toDetail(sermon)
  }

  @Put(':sermonId/share')
  @Roles('admin')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async share(
    @Param('orgId') orgId: string,
    @Param('sermonId') sermonId: string,
    @Body() dto: ShareSermonDto,
  ): Promise<SermonDetail> {
    const sermon = await this.sermons.setShare(orgId, sermonId, {
      enabled: dto.enabled,
      rotate: dto.rotate,
    })
    return this.sermons.toDetail(sermon)
  }

  @Delete(':sermonId')
  @Roles('admin')
  @HttpCode(204)
  async remove(
    @Param('orgId') orgId: string,
    @Param('sermonId') sermonId: string,
  ): Promise<void> {
    await this.sermons.remove(orgId, sermonId)
  }
}
