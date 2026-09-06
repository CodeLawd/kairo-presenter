// ─── Cloud API contracts ──────────────────────────────────────────────────────
// TYPES ONLY. No runtime code, no imports of anything that has runtime code.
//
// This file is compiled by BOTH the Electron app and the NestJS server (which
// maps it as `@contracts/*`). The moment it contains a value — a zod schema, a
// constant, an enum — the two builds must share a real package, and the simple
// folder arrangement stops working. Keep it declarations only.

export type OrgRole = 'viewer' | 'operator' | 'admin' | 'owner'

export interface CloudUser {
  id: string
  email: string
  name: string
  emailVerified: boolean
}

export interface CloudOrg {
  id: string
  name: string
  role: OrgRole
}

/** What the API returns from signup, login, and a completed device pairing. */
export interface AuthResultPayload {
  accessToken: string
  refreshToken: string
  expiresIn: string
  user: CloudUser
  org: CloudOrg
}

export interface RefreshPayload {
  accessToken: string
  refreshToken: string
  expiresIn: string
}

export interface DeviceStartPayload {
  deviceCode: string
  userCode: string
  verificationUri: string
  interval: number
  expiresIn: number
}

export type DevicePollPayload =
  | { state: 'pending' | 'slow_down' | 'denied' | 'expired' }
  | ({ state: 'approved' } & AuthResultPayload)

// ─── Desktop-side session state ───────────────────────────────────────────────

/**
 * `stale` is the important one: signed in, but the API could not be reached to
 * refresh. It is NOT signed out — the operator keeps every feature, and the
 * only sign of it is a quiet chip in the status bar. Nothing about the cloud
 * may interrupt a service.
 */
export type CloudSessionState = 'signed-out' | 'active' | 'stale'

export interface SessionSnapshot {
  state: CloudSessionState
  user: CloudUser | null
  org: CloudOrg | null
  /** Every org this account can switch into. */
  orgs: CloudOrg[]
  /** When the API was last reached successfully. */
  lastSyncedAt: number | null
}

export interface DevicePairingState {
  status: 'idle' | 'waiting' | 'approved' | 'denied' | 'expired' | 'error'
  userCode: string | null
  verificationUri: string | null
  expiresAt: number | null
  message: string | null
}

export interface SignUpInput {
  email: string
  password: string
  name: string
  /** Church name — becomes the organization. Required; never derived from the person. */
  orgName: string
}

export interface SignInInput {
  email: string
  password: string
}

/** Why cloud features are unavailable, when the account itself is fine. */
export type CloudBlockReason = 'email-unverified' | null

/** Every cloud call resolves to this rather than throwing across the IPC bridge. */
export interface CloudResult<T> {
  ok: boolean
  data: T | null
  /** Operator-facing, already plain English. */
  error: string | null
}

/** Org API-key vault — plaintext only on the wire to authenticated desktop main. */
export interface OrgSecretsPayload {
  deepgramApiKey: string
  anthropicApiKey: string
  deepseekApiKey: string
  bibleApiKey: string
  braveApiKey: string
  googleTranslateApiKey: string
  updatedAt: string | null
}

/** Partial upsert: omit = leave, null = clear. */
export type OrgSecretsPatch = {
  [K in Exclude<keyof OrgSecretsPayload, 'updatedAt'>]?: string | null
}
