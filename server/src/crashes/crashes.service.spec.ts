import { BadRequestException } from '@nestjs/common'
import { Types } from 'mongoose'
import type { CrashReport } from '@contracts/crashes'
import { CrashesService } from './crashes.service'

const now = new Date('2026-10-24T12:00:00Z')
const who = { userId: new Types.ObjectId().toString(), orgId: new Types.ObjectId().toString(), deviceId: 'device-1' }

function report(patch: Partial<CrashReport> = {}): CrashReport {
  return {
    id: 'r1',
    kind: 'renderer',
    process: 'main-window',
    reason: 'crashed',
    exitCode: -36861,
    firstAt: '2026-10-24T11:54:40.000Z',
    lastAt: '2026-10-24T11:54:51.000Z',
    count: 4,
    system: { os: 'win32', osVersion: '10.0.26100', arch: 'x64', appVersion: '1.0.13', electronVersion: '39', memoryGb: 16, gpu: { gpu_compositing: 'enabled' } },
    errors: ['TypeError: boom'],
    log: '[info] Kairo starting',
    ...patch,
  }
}

function rig() {
  const updateOne = jest.fn().mockResolvedValue({})
  const service = new CrashesService({ updateOne } as never)
  return { service, updateOne }
}

describe('CrashesService.report', () => {
  it('stores a report against the token device, replacing earlier copies by id', async () => {
    const { service, updateOne } = rig()
    const result = await service.report(who, { installId: 'spoofed', reports: [report()] }, now)
    expect(result).toEqual({ accepted: ['r1'] })
    const [filter, update, options] = updateOne.mock.calls[0]
    expect(filter).toEqual({ installId: 'device-1', reportId: 'r1' })
    expect(options).toEqual({ upsert: true })
    expect(update.$set).toMatchObject({ kind: 'renderer', exitCode: -36861, count: 4, appVersion: '1.0.13', os: 'win32' })
    expect(update.$set.system.gpu).toEqual({ gpu_compositing: 'enabled' })
  })

  it('skips malformed reports and clips oversized text', async () => {
    const { service, updateOne } = rig()
    const result = await service.report(
      who,
      {
        installId: 'x',
        reports: [
          report({ id: 'bad-kind', kind: 'main' as never }),
          report({ id: 'bad-time', firstAt: 'yesterday' }),
          report({ id: 'ancient', lastAt: '2020-01-01T00:00:00Z' }),
          report({ id: 'big', log: 'x'.repeat(100_000), errors: Array.from({ length: 50 }, () => 'e'.repeat(5_000)) }),
        ],
      },
      now,
    )
    expect(result.accepted).toEqual(['big'])
    const set = updateOne.mock.calls[0][1].$set
    expect(set.log).toHaveLength(64_000)
    expect(set.windowErrors).toHaveLength(20)
    expect(set.windowErrors[0]).toHaveLength(1_000)
  })

  it('refuses a request without a device or with too many reports', async () => {
    const { service } = rig()
    await expect(service.report({ ...who, deviceId: '' }, { installId: 'x', reports: [] }, now)).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      service.report(who, { installId: 'x', reports: Array.from({ length: 11 }, (_, i) => report({ id: `r${i}` })) }, now),
    ).rejects.toBeInstanceOf(BadRequestException)
  })
})
