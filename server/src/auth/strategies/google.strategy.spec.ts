import type { Profile } from 'passport-google-oauth20'
import { GoogleStrategy } from './google.strategy'

const strategy = new GoogleStrategy({ clientId: 'id', clientSecret: 'secret', callbackUrl: 'http://localhost:3001/v1/auth/google/callback' })
function validate(email: string, verified: boolean, hd?: string) {
  let outcome: { error: unknown; profile: unknown } | undefined
  const profile = { id: 'google-subject', provider: 'google', displayName: 'Joshua', emails: [{ value: email, verified }], _json: { email, email_verified: verified, hd } } as unknown as Profile
  strategy.validate('access', 'refresh', profile, (error, resolved) => { outcome = { error, profile: resolved } })
  return outcome!
}

describe('Google identity validation', () => {
  it('refuses an unverified email', () => {
    expect(validate('person@gmail.com', false).error).toBeInstanceOf(Error)
  })
  it('allows linking only when Google is authoritative for the email', () => {
    expect(validate('person@gmail.com', true).profile).toMatchObject({ emailAuthoritative: true })
    expect(validate('person@church.test', true, 'church.test').profile).toMatchObject({ emailAuthoritative: true })
    expect(validate('person@thirdparty.test', true).profile).toMatchObject({ emailAuthoritative: false })
  })
})
