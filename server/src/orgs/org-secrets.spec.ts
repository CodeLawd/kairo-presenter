import { decryptJson, encryptJson, vaultKeyFromSecret } from './vault-crypto'
import { mergeSecretsPatch, type OrgSecretsPayload } from './org-secrets.service'

const EMPTY: OrgSecretsPayload = {
  deepgramApiKey: '',
  anthropicApiKey: '',
  deepseekApiKey: '',
  bibleApiKey: '',
  braveApiKey: '',
  googleTranslateApiKey: '',
}

describe('vault-crypto', () => {
  it('round-trips a secrets payload', () => {
    const key = vaultKeyFromSecret('unit-test-vault-passphrase-long')
    const plaintext = { ...EMPTY, deepgramApiKey: 'dg-secret', bibleApiKey: 'bible-secret' }
    const envelope = encryptJson(key, plaintext)
    expect(envelope.ciphertext).toBeTruthy()
    expect(envelope.iv).toBeTruthy()
    expect(envelope.authTag).toBeTruthy()
    expect(decryptJson(key, envelope)).toEqual(plaintext)
  })

  it('rejects a tampered ciphertext', () => {
    const key = vaultKeyFromSecret('unit-test-vault-passphrase-long')
    const envelope = encryptJson(key, { hello: 'world' })
    const bad = Buffer.from(envelope.ciphertext, 'base64')
    bad[0] ^= 0xff
    expect(() =>
      decryptJson(key, { ...envelope, ciphertext: bad.toString('base64') }),
    ).toThrow()
  })

  it('accepts a raw 32-byte base64 key', () => {
    const raw = Buffer.alloc(32, 7)
    const key = vaultKeyFromSecret(raw.toString('base64'))
    expect(key.equals(raw)).toBe(true)
  })
})

describe('mergeSecretsPatch', () => {
  it('leaves omitted fields alone, sets strings, clears nulls', () => {
    const current: OrgSecretsPayload = {
      ...EMPTY,
      deepgramApiKey: 'keep',
      bibleApiKey: 'old-bible',
      braveApiKey: 'brave',
    }
    const merged = mergeSecretsPatch(current, {
      bibleApiKey: 'new-bible',
      braveApiKey: null,
    })
    expect(merged).toEqual({
      ...EMPTY,
      deepgramApiKey: 'keep',
      bibleApiKey: 'new-bible',
      braveApiKey: '',
    })
  })
})
