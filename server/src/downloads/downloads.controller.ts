import { Body, Controller, Headers, HttpCode, Inject, NotFoundException, Post, UnauthorizedException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Throttle } from '@nestjs/throttler'
import { timingSafeEqual } from 'crypto'
import { Model } from 'mongoose'
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator'
import { APP_CONFIG } from '../config/config.module'
import type { AppConfig } from '../config/env'
import { Public } from '../common/decorators/public.decorator'
import { DOWNLOAD_PLATFORMS, DownloadEvent, type DownloadEventDocument, type DownloadPlatform } from './schemas/download-event.schema'

export class RecordDownloadDto {
  @IsIn(DOWNLOAD_PLATFORMS)
  platform!: DownloadPlatform

  @IsOptional()
  @IsString()
  @MaxLength(32)
  version?: string

  @IsOptional()
  @Matches(/^[a-z0-9-]{1,32}$/)
  source?: string

  @IsOptional()
  @Matches(/^[A-Z]{2}$/)
  country?: string

  @IsOptional()
  @IsBoolean()
  served?: boolean
}

/**
 * Ingest for installer downloads. Public to the JWT guard (the caller is the
 * website's server, not a person) but locked to a shared key, so the counts
 * cannot be inflated from outside.
 */
@Controller('v1/downloads')
export class DownloadsController {
  constructor(
    @InjectModel(DownloadEvent.name) private readonly events: Model<DownloadEventDocument>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @HttpCode(204)
  @Post('events')
  async record(@Headers('x-ingest-key') key: string | undefined, @Body() body: RecordDownloadDto): Promise<void> {
    const expected = this.config.downloadIngestKey
    if (!expected) throw new NotFoundException()
    if (!key || !sameSecret(key, expected)) throw new UnauthorizedException()
    await this.events.create({
      platform: body.platform,
      version: body.version ?? '',
      source: body.source ?? 'direct',
      country: body.country ?? '',
      served: body.served ?? true,
    })
  }
}

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}
