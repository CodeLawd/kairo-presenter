import { ForbiddenException } from '@nestjs/common'
import { EngageInternalGuard } from './engage-internal.guard'
import { EngagementIndexService } from './engagement-index.service'
import { loadConfig } from '../config/env'

const config = loadConfig({ MONGO_URL: 'mongodb://localhost/test', JWT_SECRET: 'test', VAULT_ENCRYPTION_KEY: 'test', ENGAGE_INTERNAL_SECRET: 'correct-secret' })
const context = (authorization?: string): any => ({ switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }) })
describe('Engage internal authentication', () => {
  it('admits only an exact bearer secret and fails closed when unconfigured', () => {
    const guard = new EngageInternalGuard(config)
    expect(guard.canActivate(context('Bearer correct-secret'))).toBe(true)
    for (const value of [undefined, 'Bearer wrong', 'correct-secret', 'Bearer correct-secret-extra']) {
      expect(() => guard.canActivate(context(value))).toThrow(ForbiddenException)
    }
    expect(() => new EngageInternalGuard({ ...config, engageInternalSecret: null }).canActivate(context('Bearer correct-secret'))).toThrow(ForbiddenException)
  })
})
describe('Engagement index', () => {
  it('upserts only index metadata, and deletes only within the owning org', async () => {
    const records = new Map<string, any>()
    const model: any = {
      updateOne: async (where: any, update: any) => { records.set(`${where.orgId}:${where.id}`, update.$set) },
      deleteOne: async (where: any) => { records.delete(`${where.orgId}:${where.id}`) },
    }
    const service = new EngagementIndexService(model)
    const item = { orgId: '012345678901234567890123', id: 'room', code: 'ABC123', name: 'Sunday', status: 'open' as const, startsAt: null, endsAt: null }
    await service.write({ ...item, token: 'must-not-persist' } as any)
    expect([...records.values()]).toEqual([item])
    await service.write({ ...item, orgId: '112345678901234567890123', deleted: true })
    expect(records.size).toBe(1)
    await service.write({ ...item, deleted: true })
    expect(records.size).toBe(0)
  })
})

import { Reflector } from '@nestjs/core'
import { GUARDS_METADATA } from '@nestjs/common/constants'
import { EngageInternalController, EngagementsController } from './engage.controller'
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator'
import { OrgRoleGuard } from '../common/guards/org-role.guard'
import { validate } from 'class-validator'
import { EngageInviteDto, EngagementIndexDto } from './engage.dto'

describe('Engage route security', () => {
  it('exempts only internal endpoints from JWT and guards them with the secret', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, EngageInternalController)).toContain(EngageInternalGuard)
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, EngageInternalController.prototype.write)).toBe(true)
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, EngageInternalController.prototype.invite)).toBe(true)
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, EngagementsController)).toBeUndefined()
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, EngagementsController.prototype.list)).toBeUndefined()
  })
  it('allows admin and owner listing, rejects viewers and other organizations', async () => {
    const orgs: any = { membershipOf: async (userId: string, orgId: string) => orgId === 'mine' ? { role: userId } : null }
    const guard = new OrgRoleGuard(new Reflector(), orgs)
    const request = (role: string, orgId = 'mine'): any => ({
      getHandler: () => EngagementsController.prototype.list,
      getClass: () => EngagementsController,
      switchToHttp: () => ({ getRequest: () => ({ user: { sub: role }, params: { orgId } }) }),
    })
    expect(await guard.canActivate(request('admin'))).toBe(true)
    expect(await guard.canActivate(request('owner'))).toBe(true)
    await expect(guard.canActivate(request('viewer'))).rejects.toBeInstanceOf(ForbiddenException)
    await expect(guard.canActivate(request('owner', 'theirs'))).rejects.toBeInstanceOf(ForbiddenException)
  })
  it('rejects invalid index metadata and unsafe invitation URL schemes', async () => {
    expect((await validate(Object.assign(new EngagementIndexDto(), { orgId: 'bad', id: '', name: '', code: '', status: 'invalid', startsAt: -1 }))).length).toBeGreaterThan(0)
    expect((await validate(Object.assign(new EngageInviteDto(), { to: 'a@example.com', engagementName: 'Sunday', link: 'javascript:alert(1)' }))).length).toBeGreaterThan(0)
  })
})
