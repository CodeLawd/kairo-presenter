import { Controller, Get, NotFoundException, Param } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { PublicSermonPayload } from '@contracts/contracts'
import { Public } from '../common/decorators/public.decorator'
import { AllowUnverified } from '../common/decorators/allow-unverified.decorator'
import { OrgsService } from '../orgs/orgs.service'
import { SermonsService } from './sermons.service'

/**
 * The share link — the one route in the app a stranger can reach.
 *
 * Deliberately its own controller. The org controller carries `OrgRoleGuard`
 * and takes `:orgId` from the path; a public route living there would be one
 * missing decorator away from letting anyone enumerate an org.
 */
@Controller('v1/public/sermons')
export class PublicSermonsController {
  constructor(
    private readonly sermons: SermonsService,
    private readonly orgs: OrgsService,
  ) {}

  /**
   * Always 404, never 403. An unknown token, a sermon whose sharing was turned
   * off, and a sermon still being written are indistinguishable from outside —
   * the endpoint says nothing about what exists.
   */
  @Get(':token')
  @Public()
  @AllowUnverified()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async get(@Param('token') token: string): Promise<PublicSermonPayload> {
    const sermon = await this.sermons.findByShareToken(token)
    if (!sermon || !sermon.summary) throw new NotFoundException('That recap is not available.')

    const org = await this.orgs.findById(sermon.orgId)
    // Hand-built rather than spread: this payload leaves the building, so every
    // field on it is here because someone decided it should be. Note it maps the
    // summary directly rather than going through `toDetail`, which would carry
    // internal fields like failureCode and shareToken into scope.
    return {
      title: sermon.title,
      speaker: sermon.speaker,
      churchName: org?.name ?? '',
      preachedAt: sermon.preachedAt.toISOString(),
      summary: this.sermons.toSummary(sermon.summary),
    }
  }
}
