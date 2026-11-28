import { Body, Controller, Delete, Get, HttpCode, Inject, Post, Put, Res } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { NodeResponse as Response } from '@nestjs/platform-node'
import { AccountService, DeletionPreview } from './account.service'
import { DeleteAccountDto, ImagineKeyDto } from './dto/account.dto'
import { ImagineKeyService } from './imagine-key.service'
import { AllowUnverified } from '../common/decorators/allow-unverified.decorator'
import { CurrentUser, RequestUser } from '../common/decorators/current-user.decorator'
import { APP_CONFIG } from '../config/config.module'
import type { AppConfig } from '../config/env'
import { clearRefreshCookie } from '../auth/refresh-cookie'

/**
 * The signed-in person's own data rights: a copy of it, and deleting it.
 *
 * Every route is @AllowUnverified on purpose — someone who signed up with a
 * mistyped email still has the right to see and erase what was stored.
 */
@Controller('v1/account')
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly imagineKeys: ImagineKeyService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** The person's own OpenAI key for Imagine, synced to each device they sign in on. */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('imagine-key')
  async imagineKey(@CurrentUser() user: RequestUser): Promise<{ key: string | null }> {
    return { key: await this.imagineKeys.get(user.sub) }
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Put('imagine-key')
  async saveImagineKey(
    @CurrentUser() user: RequestUser,
    @Body() dto: ImagineKeyDto,
  ): Promise<{ saved: true }> {
    await this.imagineKeys.set(user.sub, dto.key)
    return { saved: true }
  }

  @Delete('imagine-key')
  async clearImagineKey(@CurrentUser() user: RequestUser): Promise<{ cleared: true }> {
    await this.imagineKeys.clear(user.sub)
    return { cleared: true }
  }

  @AllowUnverified()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Get('export')
  async export(@CurrentUser() user: RequestUser): Promise<Record<string, unknown>> {
    return this.account.export(user.sub)
  }

  @AllowUnverified()
  @Get('deletion')
  async previewDeletion(@CurrentUser() user: RequestUser): Promise<DeletionPreview> {
    return this.account.previewDeletion(user.sub)
  }

  /** For an account with no password: the emailed code stands in for it. */
  @AllowUnverified()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(202)
  @Post('deletion/code')
  async sendDeletionCode(@CurrentUser() user: RequestUser): Promise<{ sent: true }> {
    await this.account.sendDeletionCode(user.sub)
    return { sent: true }
  }

  /** Throttled: the password and the code are both guessable given enough tries. */
  @AllowUnverified()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('delete')
  async delete(
    @CurrentUser() user: RequestUser,
    @Body() dto: DeleteAccountDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ deleted: true; deletedOrgIds: string[] }> {
    const { deletedOrgIds } = await this.account.deleteAccount(user.sub, dto)
    clearRefreshCookie(response, this.config)
    return { deleted: true, deletedOrgIds }
  }
}
