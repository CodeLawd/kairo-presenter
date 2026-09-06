import { hashToken, hashesEqual } from './token.service'

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
