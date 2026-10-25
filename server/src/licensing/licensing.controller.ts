import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { CurrentUser, RequestUser } from '../common/decorators/current-user.decorator'
import { PlatformAdminGuard, SuperadminOnly } from '../admin/platform-admin.guard'
import { LicensingService } from './licensing.service'
import type { LicensePolicy, LicenseUpdate, ManagedProviderPatch, ManagedRequest } from '@contracts/licensing'

@Controller('v1/licensing')
export class LicensingController {
  constructor(private readonly licensing: LicensingService) {}
  @Get() get(@CurrentUser() user: RequestUser) { return this.licensing.snapshot(user) }
  @Get('key') getKey(@CurrentUser() user: RequestUser) { return this.licensing.getKey(user) }
  @Delete('key') revokeKey(@CurrentUser() user: RequestUser) { return this.licensing.revokeKey(user) }
  @Post('key') key(@CurrentUser() user: RequestUser) { return this.licensing.issueKey(user) }
  @Post('activate') activate(@CurrentUser() user: RequestUser, @Body() body: { key: string; name: string }) { return this.licensing.activate(user, body?.key, body?.name) }
  @Post('refresh') refresh(@CurrentUser() user: RequestUser) { return this.licensing.snapshot(user) }
  @Delete('devices/:deviceId') remove(@CurrentUser() user: RequestUser, @Param('deviceId') id: string) { return this.licensing.deactivate(user, id) }
}
@Controller('v1/admin/licensing')
@UseGuards(PlatformAdminGuard)
export class LicensingAdminController {
  constructor(private readonly licensing: LicensingService) {}
  @Get('policy') @SuperadminOnly() policy() { return this.licensing.policy() }
  @Patch('policy') @SuperadminOnly() updatePolicy(@CurrentUser() user: RequestUser, @Body() body: Partial<LicensePolicy>) { return this.licensing.updatePolicy(user.sub, body) }
  @Get('providers') @SuperadminOnly() providers() { return this.licensing.providerStatus() }
  @Patch('providers') @SuperadminOnly() updateProviders(@CurrentUser() user: RequestUser, @Body() body: ManagedProviderPatch) { return this.licensing.updateProviders(user.sub, body) }
  @Get('licenses') @SuperadminOnly() licenses() { return this.licensing.list() }
  @Patch('licenses/:orgId') @SuperadminOnly() updateLicense(@CurrentUser() user: RequestUser, @Param('orgId') orgId: string, @Body() body: LicenseUpdate) { return this.licensing.updateLicense(user.sub, orgId, body) }
}
@Controller('v1/managed')
export class ManagedController {
  constructor(private readonly licensing: LicensingService) {}
  @Post('request') request(@CurrentUser() user: RequestUser, @Body() body: ManagedRequest) { return this.licensing.managed(user, body) }
  @Post('transcription') transcription(@CurrentUser() user: RequestUser) { return this.licensing.transcription(user) }
  @Post('transcription/:sessionId/renew') renew(@CurrentUser() user: RequestUser, @Param('sessionId') id: string) { return this.licensing.renew(user, id) }
  @Delete('transcription/:sessionId') release(@CurrentUser() user: RequestUser, @Param('sessionId') id: string) { return this.licensing.release(user, id) }
}
