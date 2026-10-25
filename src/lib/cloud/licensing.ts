// Shared declarations only: compiled by desktop, website and server.
export type LicensedFeature = 'presentation' | 'transcription' | 'scripture' | 'summaries' | 'translation' | 'webSearch'
export type LicenseStatus = 'active' | 'suspended' | 'revoked'
export interface LicensePolicy {
  freeIssuanceEnabled: boolean
  defaultMaxDevices: number
  defaultMaxTranscriptionSessions: number
  defaultTranscriptionMinutes: number
  defaultManagedRequests: number
  offlineGraceDays: number
}
export interface LicenseDevice {
  deviceId: string
  name: string
  activatedAt: string
  lastSeenAt: string
}
export interface ChurchLicense {
  orgId: string
  orgName?: string
  status: LicenseStatus
  expiresAt: string | null
  features: LicensedFeature[]
  maxDevices: number
  maxTranscriptionSessions: number
  transcriptionMinutes: number
  managedRequests: number
  devices: LicenseDevice[]
  usage: { period: string; transcriptionMinutes: number; managedRequests: number }
}
/** One row of the superadmin licence list: a licensed church and its owner. */
export interface AdminChurchLicense {
  orgId: string
  orgName: string
  ownerEmail: string
  createdAt: string | null
  license: ChurchLicense
}
export interface LicenseLeaseClaims {
  orgId: string
  deviceId: string
  features: LicensedFeature[]
  /** All timestamps in this signed envelope are Unix seconds. */
  issuedAt: number
  refreshAfter: number
  expiresAt: number
  licenseExpiresAt: number | null
}
export interface SignedLicenseLease {
  claims: LicenseLeaseClaims
  signature: string
  publicKey: string
}
export interface LicenseSnapshot {
  license: ChurchLicense | null
  activated: boolean
  lease: SignedLicenseLease | null
  providers: Record<'deepgram' | 'bible' | 'anthropic' | 'deepseek' | 'brave' | 'googleTranslate', boolean>
}
/**
 * The church's activation key, readable only by its owners and admins. The same
 * key activates every computer until it is revoked or the licence ends.
 */
export interface LicenseActivationKey { id: string; key: string; createdAt: string | null }
export interface LicenseUpdate {
  status?: LicenseStatus
  expiresAt?: string | null
  features?: LicensedFeature[]
  maxDevices?: number
  maxTranscriptionSessions?: number
  transcriptionMinutes?: number
  managedRequests?: number
}
export interface ManagedProviderStatus {
  configured: LicenseSnapshot['providers']
  /** Last four characters of each saved key ('' when unset or too short to reveal safely). */
  hints: Record<keyof LicenseSnapshot['providers'], string>
  updatedAt: string | null
}
export interface ManagedProviderPatch {
  deepgramApiKey?: string | null
  bibleApiKey?: string | null
  anthropicApiKey?: string | null
  deepseekApiKey?: string | null
  braveApiKey?: string | null
  googleTranslateApiKey?: string | null
}
export interface ManagedRequest {
  provider: 'bible' | 'anthropic' | 'deepseek' | 'brave' | 'googleTranslate'
  path: string
  method: 'GET' | 'POST'
  query?: Record<string, string | number | boolean>
  body?: unknown
  /** LLM tasks share a protocol but consume the entitlement for their purpose. */
  purpose?: 'scripture' | 'summaries' | 'translation' | 'webSearch'
}
export interface TranscriptionGrant { accessToken: string; expiresIn: number; sessionId: string; renewAfterSeconds: number }
