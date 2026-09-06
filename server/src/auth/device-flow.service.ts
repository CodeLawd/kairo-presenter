import { randomBytes } from 'node:crypto'
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import {
  DEVICE_POLL_INTERVAL_SEC,
  normalizeUserCode,
  userCodeFromBytes,
} from '@contracts/device-code'
import {
  DeviceAuthRequest,
  DeviceAuthRequestDocument,
} from './schemas/device-auth-request.schema'
import { hashToken } from './token.service'
import { APP_CONFIG } from '../config/config.module'
import type { AppConfig } from '../config/env'

/** A pairing attempt is short-lived — an abandoned code must not linger. */
const REQUEST_TTL_MS = 15 * 60 * 1000
/** Polls closer together than this earn a `slow_down`. */
const MIN_POLL_GAP_MS = (DEVICE_POLL_INTERVAL_SEC - 1) * 1000

export interface DeviceStartResult {
  deviceCode: string
  userCode: string
  verificationUri: string
  interval: number
  expiresIn: number
}

export type DevicePollResult =
  | { state: 'pending' }
  | { state: 'slow_down' }
  | { state: 'denied' }
  | { state: 'expired' }
  | { state: 'approved'; userId: Types.ObjectId; orgId: Types.ObjectId; deviceId: string }

@Injectable()
export class DeviceFlowService {
  constructor(
    @InjectModel(DeviceAuthRequest.name)
    private readonly requests: Model<DeviceAuthRequestDocument>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async start(input: { deviceId: string; deviceName?: string }): Promise<DeviceStartResult> {
    const deviceCode = randomBytes(32).toString('base64url')
    const userCode = await this.uniqueUserCode()

    await this.requests.create({
      deviceCodeHash: hashToken(deviceCode),
      userCode,
      deviceId: input.deviceId,
      deviceName: input.deviceName ?? '',
      expiresAt: new Date(Date.now() + REQUEST_TTL_MS),
    })

    return {
      deviceCode,
      userCode,
      verificationUri: `${this.config.publicWebUrl}/activate`,
      interval: DEVICE_POLL_INTERVAL_SEC,
      expiresIn: Math.floor(REQUEST_TTL_MS / 1000),
    }
  }

  /**
   * One poll. Approval is reported exactly once — `redeemedAt` closes the code
   * so a leaked device code cannot be replayed for a second set of tokens.
   */
  async poll(deviceCode: string): Promise<DevicePollResult> {
    const request = await this.requests.findOne({ deviceCodeHash: hashToken(deviceCode) })
    if (!request) throw new NotFoundException('Unknown device code')

    if (request.expiresAt.getTime() <= Date.now() || request.redeemedAt) {
      return { state: 'expired' }
    }
    if (request.status === 'denied') return { state: 'denied' }

    // Rate limit before answering: an impatient client must not be able to poll
    // in a tight loop just because the answer is still "not yet".
    const since = request.lastPolledAt ? Date.now() - request.lastPolledAt.getTime() : Infinity
    request.lastPolledAt = new Date()

    if (request.status === 'pending') {
      await request.save()
      return since < MIN_POLL_GAP_MS ? { state: 'slow_down' } : { state: 'pending' }
    }

    request.redeemedAt = new Date()
    await request.save()
    return {
      state: 'approved',
      userId: request.userId!,
      orgId: request.orgId!,
      deviceId: request.deviceId,
    }
  }

  /** Called by a signed-in person from the web page, phone in hand. */
  async approve(
    userCode: string,
    grant: { userId: Types.ObjectId; orgId: Types.ObjectId },
  ): Promise<{ deviceName: string }> {
    const request = await this.pendingByUserCode(userCode)
    request.status = 'approved'
    request.userId = grant.userId
    request.orgId = grant.orgId
    await request.save()
    return { deviceName: request.deviceName }
  }

  async deny(userCode: string): Promise<void> {
    const request = await this.pendingByUserCode(userCode)
    request.status = 'denied'
    await request.save()
  }

  /** What the approval page shows before anyone clicks Approve. */
  async describe(userCode: string): Promise<{ deviceName: string; expiresAt: Date }> {
    const request = await this.pendingByUserCode(userCode)
    return { deviceName: request.deviceName, expiresAt: request.expiresAt }
  }

  private async pendingByUserCode(userCode: string): Promise<DeviceAuthRequestDocument> {
    const request = await this.requests.findOne({
      userCode: normalizeUserCode(userCode),
      status: 'pending',
      expiresAt: { $gt: new Date() },
    })
    if (!request) {
      throw new BadRequestException('That code is not valid, or it has already been used.')
    }
    return request
  }

  /** Codes are short, so a collision with a LIVE code is possible — retry. */
  private async uniqueUserCode(): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = userCodeFromBytes(randomBytes(8))
      const clash = await this.requests.exists({
        userCode: candidate,
        status: 'pending',
        expiresAt: { $gt: new Date() },
      })
      if (!clash) return candidate
    }
    throw new Error('Could not allocate a device code')
  }
}
