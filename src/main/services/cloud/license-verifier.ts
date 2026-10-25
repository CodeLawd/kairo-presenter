import { createPublicKey, verify } from 'node:crypto'
import type { LicensedFeature, SignedLicenseLease } from '@shared/cloud/licensing'

/** The trusted key comes from build configuration or a separately protected online pin. */
export function validLicenseLease(lease: SignedLicenseLease | null, publicKey: string | null, orgId: string, deviceId: string, feature?: LicensedFeature, now = Math.floor(Date.now() / 1000)): boolean {
  if (!lease || !publicKey || !orgId || !deviceId) return false
  try {
    const c = lease.claims
    if (c.orgId !== orgId || c.deviceId !== deviceId || !Array.isArray(c.features)) return false
    if (![c.issuedAt, c.refreshAfter, c.expiresAt].every(Number.isFinite)) return false
    if (c.issuedAt > now + 60 || c.expiresAt <= now || c.expiresAt <= c.issuedAt || c.expiresAt - c.issuedAt > 14 * 86400) return false
    if (c.licenseExpiresAt !== null && (!Number.isFinite(c.licenseExpiresAt) || c.licenseExpiresAt <= now || c.expiresAt > c.licenseExpiresAt)) return false
    if (feature && !c.features.includes(feature)) return false
    return verify(null, Buffer.from(JSON.stringify(c)), createPublicKey(publicKey), Buffer.from(lease.signature, 'base64'))
  } catch { return false }
}
