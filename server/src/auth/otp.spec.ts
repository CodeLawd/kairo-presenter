import { OTP_LENGTH, generateOtp, isWellFormedOtp, normalizeOtp } from './otp'

describe('one-time codes', () => {
  it('is always six digits, including when the number is small', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateOtp()
      expect(code).toMatch(/^\d{6}$/)
      expect(code).toHaveLength(OTP_LENGTH)
    }
  })

  it('does not repeat itself in any obvious way', () => {
    const codes = new Set(Array.from({ length: 200 }, generateOtp))
    // Not a randomness proof — a guard against a constant or an off-by-one loop.
    expect(codes.size).toBeGreaterThan(150)
  })

  it('accepts a code the way a person pastes it', () => {
    for (const typed of ['123 456', '123-456', ' 123456 ', '123456']) {
      expect(normalizeOtp(typed)).toBe('123456')
      expect(isWellFormedOtp(typed)).toBe(true)
    }
  })

  it('rejects anything that is not six digits', () => {
    expect(isWellFormedOtp('12345')).toBe(false)
    expect(isWellFormedOtp('1234567')).toBe(false)
    expect(isWellFormedOtp('abcdef')).toBe(false)
    expect(isWellFormedOtp('')).toBe(false)
  })
})
