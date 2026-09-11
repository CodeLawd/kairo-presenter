import { Types } from 'mongoose'
import {
  hashToken,
  hashesEqual,
  RefreshTokenInvalidError,
  RefreshTokenReuseError,
  TokenService,
} from './token.service'

describe('hashesEqual', () => {
  it('matches identical digests', () => {
    const digest = hashToken('482913')
    expect(hashesEqual(digest, hashToken('482913'))).toBe(true)
  })

  it('rejects a different code, including one that shares a long prefix', () => {
    const digest = hashToken('482913')
    expect(hashesEqual(digest, hashToken('482914'))).toBe(false)
    // Same first half, different second — the case a short-circuiting compare
    // would answer faster than a mismatch in the first character.
    const forged = digest.slice(0, 32) + 'f'.repeat(32)
    expect(hashesEqual(digest, forged)).toBe(false)
  })

  it('refuses empty or malformed input instead of throwing', () => {
    expect(hashesEqual('', '')).toBe(false)
    expect(hashesEqual(hashToken('x'), '')).toBe(false)
    expect(hashesEqual(hashToken('x'), 'not-hex')).toBe(false)
  })
})

/**
 * Rotation with an in-memory session store. The point under test is the
 * replay rule: a just-spent token chains forward, a stale one revokes.
 */
describe('rotate', () => {
  interface FakeDoc {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any
    save: jest.Mock
  }

  function setup() {
    const store = new Map<string, FakeDoc>()
    const sessions = {
      findOne: jest.fn(({ tokenHash }: { tokenHash: string }) => {
        const doc = store.get(tokenHash) ?? null
        return Object.assign(Promise.resolve(doc), { exec: () => Promise.resolve(doc) })
      }),
      create: jest.fn(async (data: Record<string, unknown>) => {
        const doc: FakeDoc = { ...data, save: jest.fn(async () => undefined) }
        store.set(data['tokenHash'] as string, doc)
        return doc
      }),
      updateMany: jest.fn(async () => ({ acknowledged: true })),
    }
    const jwt = { signAsync: jest.fn(async () => 'access-token') }
    const config = { accessTokenTtl: '15m', refreshTokenTtlDays: 60 }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new TokenService(jwt as any, sessions as any, config as any)
    const revoke = jest.spyOn(service, 'revokeFamily')

    const seed = (overrides: Record<string, unknown> = {}): { doc: FakeDoc; token: string } => {
      const token = `refresh-${store.size}-${Math.random()}`
      const doc: FakeDoc = {
        userId: new Types.ObjectId(),
        orgId: new Types.ObjectId(),
        deviceId: 'web-1',
        deviceName: '',
        device: undefined,
        clientKind: 'web',
        lastLoginAt: null,
        createdAt: new Date(),
        tokenHash: hashToken(token),
        familyId: 'family-1',
        consumedAt: null,
        replacedByTokenHash: null,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 3_600_000),
        save: jest.fn(async () => undefined),
        ...overrides,
      }
      store.set(doc['tokenHash'] as string, doc)
      return { doc, token }
    }

    return { store, sessions, service, revoke, seed }
  }

  const context = { role: 'viewer' as const, emailVerified: true }

  it('rotates a fresh token and links the successor', async () => {
    const { service, seed } = setup()
    const { doc, token } = seed()

    const pair = await service.rotate(token, context)

    expect(pair.refreshToken).toBeTruthy()
    expect(pair.refreshToken).not.toBe(token)
    expect(doc.consumedAt).toBeInstanceOf(Date)
    expect(doc.replacedByTokenHash).toBe(hashToken(pair.refreshToken))
  })

  it('replays a just-spent token forward instead of revoking the family', async () => {
    const { service, revoke, seed } = setup()
    const { token } = seed()

    await service.rotate(token, context)
    const pair = await service.rotate(token, context)

    expect(revoke).not.toHaveBeenCalled()
    expect(pair.refreshToken).toBeTruthy()
  })

  it('follows a two-deep chain for three concurrent refreshes', async () => {
    const { service, revoke, seed } = setup()
    const { token } = seed()

    await service.rotate(token, context)
    await service.rotate(token, context)
    const pair = await service.rotate(token, context)

    expect(revoke).not.toHaveBeenCalled()
    expect(pair.refreshToken).toBeTruthy()
  })

  it('revokes the family when the replay arrives after the grace window', async () => {
    const { service, revoke, seed } = setup()
    const { doc, token } = seed()

    await service.rotate(token, context)
    doc.consumedAt = new Date(Date.now() - 120_000)

    await expect(service.rotate(token, context)).rejects.toBeInstanceOf(RefreshTokenReuseError)
    expect(revoke).toHaveBeenCalledWith('family-1')
  })

  it('revokes when the successor is gone — a chain that leads nowhere is theft', async () => {
    const { service, revoke, store, seed } = setup()
    const { token } = seed()

    const first = await service.rotate(token, context)
    store.delete(hashToken(first.refreshToken))

    await expect(service.rotate(token, context)).rejects.toBeInstanceOf(RefreshTokenReuseError)
    expect(revoke).toHaveBeenCalledTimes(1)
  })

  it('rejects an unknown token without touching the family', async () => {
    const { service, revoke } = setup()

    await expect(service.rotate('nope', context)).rejects.toBeInstanceOf(
      RefreshTokenInvalidError,
    )
    expect(revoke).not.toHaveBeenCalled()
  })
})
