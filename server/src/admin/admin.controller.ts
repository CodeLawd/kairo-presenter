import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { Transform, Type } from 'class-transformer'
import { IsEmail, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { AdminService, type Actor, type AdminEntry } from './admin.service'
import { PlatformAdminGuard, SuperadminOnly, type AdminRequestUser } from './platform-admin.guard'

export class ListQuery {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number
}

export class DownloadsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number
}

export class GrantAdminDto {
  // Pasted addresses often carry spaces; trim before judging the format.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail()
  email!: string
}

export class SetUserStatusDto {
  @IsIn(['active', 'disabled'])
  status!: 'active' | 'disabled'
}

/** Kairo staff console: every church and account, plus product analytics. */
@UseGuards(PlatformAdminGuard)
@Controller('v1/admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  overview(): Promise<unknown> {
    return this.admin.overview()
  }

  @Get('users')
  users(@Query() query: ListQuery): Promise<unknown> {
    return this.admin.listUsers(query)
  }

  @HttpCode(204)
  @Patch('users/:id')
  async setUserStatus(
    @CurrentUser() actor: AdminRequestUser,
    @Param('id') id: string,
    @Body() body: SetUserStatusDto,
  ): Promise<void> {
    await this.admin.setUserStatus(actorOf(actor), id, body.status)
  }

  /** Who has console access. Every staff member can see the team. */
  @Get('admins')
  admins(): Promise<AdminEntry[]> {
    return this.admin.listAdmins()
  }

  @SuperadminOnly()
  @Post('admins')
  grantAdmin(@CurrentUser() actor: AdminRequestUser, @Body() body: GrantAdminDto): Promise<AdminEntry> {
    return this.admin.grantAdmin(actorOf(actor), body.email)
  }

  @SuperadminOnly()
  @HttpCode(204)
  @Delete('admins/:id')
  async revokeAdmin(@CurrentUser() actor: AdminRequestUser, @Param('id') id: string): Promise<void> {
    await this.admin.revokeAdmin(actorOf(actor), id)
  }

  @Get('churches')
  churches(@Query() query: ListQuery): Promise<unknown> {
    return this.admin.listChurches(query)
  }

  @Get('downloads')
  downloads(@Query() query: DownloadsQuery): Promise<unknown> {
    return this.admin.downloadStats(query.days ?? 30)
  }
}

function actorOf(user: AdminRequestUser): Actor {
  return { id: user.sub, role: user.platformRole }
}
