import { canonicalActivationKey, newActivationKey } from './activation-key'

describe('activation keys', () => {
  it('look like product keys and read back as themselves', () => {
    const key = newActivationKey()
    expect(key).toMatch(/^KAIRO(-[0-9A-HJKMNP-TV-Z]{4}){6}$/)
    expect(canonicalActivationKey(key)).toBe(key)
    expect(newActivationKey()).not.toBe(key)
  })

  it('forgive case, spacing, missing dashes and look-alike letters', () => {
    const key = 'KAIRO-7F3K-Q9PX-M2TD-WC8H-4RNB-ZJ61'
    expect(canonicalActivationKey(' kairo 7f3k q9px m2td wc8h 4rnb zj61 ')).toBe(key)
    expect(canonicalActivationKey('7F3KQ9PXM2TDWC8H4RNBZJ6L')).toBe(key)
    expect(canonicalActivationKey('KAIRO-7F3K-Q9PX-M2TD-WC8H-4RNB-ZJ6I')).toBe(key)
  })

  it('keep accepting keys issued before the new format', () => {
    const hex = 'a'.repeat(24) + '0123456789abcdef01234567'
    expect(canonicalActivationKey(hex.toUpperCase())).toBe(hex)
  })

  it('refuse anything else', () => {
    for (const bad of ['', 'KAIRO-7F3K', 'KAIRO-7F3K-Q9PX-M2TD-WC8H-4RNB-ZJ6U', 42, 'x'.repeat(600)]) {
      expect(canonicalActivationKey(bad)).toBeNull()
    }
  })
})
