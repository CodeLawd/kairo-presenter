import { randomUUID } from 'node:crypto'
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { Request, Response } from 'express'
import { Types } from 'mongoose'
import { AuthService, AuthContext, AuthResult } from './auth.service'
import {
  ForgotPasswordDto,
  RefreshDto,
  ResetPasswordDto,
  SignInDto,
  SignUpDto,
  VerifyEmailCodeDto,
  VerifyEmailDto,
} from './dto/auth.dto'
import { Public } from '../common/decorators/public.decorator'
import { AllowUnverified } from '../common/decorators/allow-unverified.decorator'
import { CurrentUser, RequestUser } from '../common/decorators/current-user.decorator'
import { UsersService } from '../users/users.service'
import { OrgsService } from '../orgs/orgs.service'
import { APP_CONFIG } from '../config/config.module'
import type { AppConfig } from '../config/env'
import { clearRefreshCookie, REFRESH_COOKIE, setRefreshCookie } from './refresh-cookie'

@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly orgs: OrgsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('signup')
  async signUp(
    @Body() dto: SignUpDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResult | Omit<AuthResult, 'refreshToken'>> {
    const result = await this.auth.signUp(dto, contextOf(request, dto.deviceId, dto.deviceName, dto.device))
    return this.deliver(result, request, response)
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  async signIn(
    @Body() dto: SignInDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResult | Omit<AuthResult, 'refreshToken'>> {
    const result = await this.auth.signIn(dto, contextOf(request, dto.deviceId, dto.deviceName, dto.device))
    return this.deliver(result, request, response)
  }

  @Public()
  @HttpCode(200)
  @Post('refresh')
  async refresh(
    @Body() dto: RefreshDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ accessToken: string; expiresIn: string; refreshToken?: string }> {
    // Web keeps the token in an HttpOnly cookie the page cannot read; desktop
    // holds it in its own encrypted store and sends it in the body.
    const token = dto.refreshToken ?? (request.cookies?.[REFRESH_COOKIE] as string | undefined)
    if (!token) throw new UnauthorizedException('No refresh token supplied')

    const pair = await this.auth.refresh(token, {
      userAgent: request.headers['user-agent'],
      ip: request.ip,
      deviceName: dto.deviceName ?? dto.device?.name,
      device: dto.device,
    })
    if (isWeb(request)) {
      setRefreshCookie(response, pair.refreshToken, this.config)
      return { accessToken: pair.accessToken, expiresIn: pair.expiresIn }
    }
    return pair
  }

  @AllowUnverified()
  @HttpCode(204)
  @Post('logout')
  async signOut(
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.signOut(new Types.ObjectId(user.sub), user.deviceId)
    clearRefreshCookie(response, this.config)
  }

  /**
   * Asks for the confirmation link again. Public and rate-limited: someone
   * locked out by a lost email has no token to prove anything with.
   */
  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(202)
  @Post('resend-verification')
  async resendVerification(@Body() dto: ForgotPasswordDto): Promise<{ sent: true }> {
    await this.auth.resendVerification(dto.email)
    // Always 202 — an unknown or already-confirmed address must look identical.
    return { sent: true }
  }

  /**
   * Confirms with the six-digit code from the email — the path someone in front
   * of the desktop app takes, with no browser involved.
   *
   * Throttled hard: the code is short, and guessing is the only attack on it.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('verify-email-code')
  async verifyEmailCode(@Body() dto: VerifyEmailCodeDto): Promise<{ verified: true }> {
    await this.auth.verifyEmailCode(dto.email, dto.code)
    return { verified: true }
  }

  @Public()
  @HttpCode(200)
  @Post('verify-email')
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<{ verified: true }> {
    await this.auth.verifyEmail(dto.token)
    return { verified: true }
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(202)
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ sent: true }> {
    await this.auth.requestPasswordReset(dto.email)
    // Always 202, account or not — the response must not reveal who is registered.
    return { sent: true }
  }

  @Public()
  @HttpCode(200)
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<{ reset: true }> {
    await this.auth.resetPassword(dto.token, dto.password)
    return { reset: true }
  }

  /** Who the caller is, plus every org they can switch into. */
  @AllowUnverified()
  @Get('session')
  async session(@CurrentUser() claims: RequestUser): Promise<unknown> {
    const user = await this.users.findById(claims.sub)
    if (!user) throw new UnauthorizedException('Account no longer exists')
    const memberships = await this.orgs.membershipsOf(user._id)
    const orgs = await Promise.all(
      memberships.map(async (membership) => {
        const org = await this.orgs.findById(membership.orgId)
        return org
          ? { id: org._id.toString(), name: org.name, role: membership.role }
          : null
      }),
    )
    return {
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        emailVerified: user.emailVerifiedAt !== null,
      },
      orgId: claims.orgId,
      role: claims.role,
      orgs: orgs.filter((org): org is NonNullable<typeof org> => org !== null),
    }
  }

  /**
   * Web gets the refresh token as an HttpOnly cookie so no script on the page
   * can read it; desktop gets it in the body because it has an encrypted store
   * and no cookie jar.
   */
  private deliver(
    result: AuthResult,
    request: Request,
    response: Response,
  ): AuthResult | Omit<AuthResult, 'refreshToken'> {
    if (!isWeb(request)) return result
    setRefreshCookie(response, result.refreshToken, this.config)
    const { refreshToken: _omitted, ...rest } = result
    return rest
  }
}

function isWeb(request: Request): boolean {
  return request.headers['x-pa-client'] !== 'desktop'
}

function contextOf(
  request: Request,
  deviceId?: string,
  deviceName?: string,
  device?: AuthContext['device'],
): AuthContext {
  return {
    clientKind: isWeb(request) ? 'web' : 'desktop',
    // A browser has no stable install id, so one is minted per session.
    deviceId: deviceId?.trim() || randomUUID(),
    deviceName: deviceName?.trim() || device?.name?.trim(),
    device,
    userAgent: request.headers['user-agent'],
    ip: request.ip,
  }
}
