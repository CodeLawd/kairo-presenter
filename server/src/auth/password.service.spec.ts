import { PasswordService } from './password.service'

describe('PasswordService', () => {
  const service = new PasswordService()

  it('produces an argon2id hash that verifies', async () => {
    const hash = await service.hash('correct horse battery staple')
    expect(hash.startsWith('$argon2id$')).toBe(true)
    await expect(service.verify(hash, 'correct horse battery staple')).resolves.toBe(true)
    await expect(service.verify(hash, 'wrong password')).resolves.toBe(false)
  }, 20_000)

  it('salts — the same password never hashes to the same string twice', async () => {
    const [a, b] = await Promise.all([service.hash('same'), service.hash('same')])
    expect(a).not.toBe(b)
  }, 20_000)

  it('treats a passwordless (Google-only) account as wrong credentials, not an error', async () => {
    await expect(service.verify(undefined, 'anything')).resolves.toBe(false)
    await expect(service.verify('not-a-hash', 'anything')).resolves.toBe(false)
  })
})
