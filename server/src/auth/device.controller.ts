import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { Types } from 'mongoose'
import { DeviceFlowService } from './device-flow.service'
import { AuthService, AuthResult } from './auth.service'
import { DeviceApproveDto, DeviceStartDto, DeviceTokenDto } from './dto/device.dto'
import { Public } from '../common/decorators/public.decorator'
import { CurrentUser, RequestUser } from '../common/decorators/current-user.decorator'

/**
 * Device pairing, RFC 8628 shape.
 *
 * The polling endpoints answer 200 with a `state` rather than an error status:
 * "not approved yet" is the expected case for the entire duration of the flow,
 * and a client that treats it as a failure would give up on the first poll.
 */
@Controller('v1/auth/device')
export class DeviceController {
  constructor(
    private readonly devices: DeviceFlowService,
    private readonly auth: AuthService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('start')
  async start(@Body() dto: DeviceStartDto): Promise<unknown> {
    return this.devices.start(dto)
  }

  @Public()
  @HttpCode(200)
  @Post('token')
  async token(
    @Body() dto: DeviceTokenDto,
  ): Promise<{ state: string } | ({ state: 'approved' } & AuthResult)> {
    const result = await this.devices.poll(dto.deviceCode)
    if (result.state !== 'approved') return { state: result.state }

    const session = await this.auth.completeDevicePairing({
      userId: result.userId,
      orgId: result.orgId,
      deviceId: result.deviceId,
      deviceName: result.deviceName,
      device: result.device,
    })
    return { state: 'approved', ...session }
  }

  /** What the approval page shows before anyone taps Approve. */
  @Public()
  @Get('describe')
  async describe(@Query('userCode') userCode: string): Promise<unknown> {
    return this.devices.describe(userCode ?? '')
  }

  @HttpCode(200)
  @Post('approve')
  async approve(
    @CurrentUser() user: RequestUser,
    @Body() dto: DeviceApproveDto,
  ): Promise<{ approved: true; deviceName: string }> {
    // Granted into the org the approver is currently in — pairing never widens
    // access beyond what the person doing it already has.
    const { deviceName } = await this.devices.approve(dto.userCode, {
      userId: new Types.ObjectId(user.sub),
      orgId: new Types.ObjectId(user.orgId),
    })
    return { approved: true, deviceName }
  }

  @HttpCode(200)
  @Post('deny')
  async deny(@Body() dto: DeviceApproveDto): Promise<{ denied: true }> {
    await this.devices.deny(dto.userCode)
    return { denied: true }
  }
}
