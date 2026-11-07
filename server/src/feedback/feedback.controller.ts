import { Body, Controller, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { Transform } from 'class-transformer'
import { FEEDBACK_KINDS, FEEDBACK_MAX_CHARS, type FeedbackKind, type FeedbackUploadResult } from '@contracts/feedback'
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator'
import { FeedbackService } from './feedback.service'

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value)

export class FeedbackDto {
  @IsIn(FEEDBACK_KINDS)
  kind!: FeedbackKind

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(FEEDBACK_MAX_CHARS)
  message!: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  context?: string

  @IsOptional()
  @IsString()
  @MaxLength(32)
  appVersion?: string

  @IsOptional()
  @IsString()
  @MaxLength(32)
  os?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  osVersion?: string
}

/**
 * Feedback in. Signed-in only (the global JWT and confirmed-email guards
 * apply); the sender is the token's user, never the body's claim.
 */
@Controller('v1/feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post()
  send(@CurrentUser() user: RequestUser, @Body() body: FeedbackDto): Promise<FeedbackUploadResult> {
    return this.feedback.create({ userId: user.sub, orgId: user.orgId, deviceId: user.deviceId }, body)
  }
}
