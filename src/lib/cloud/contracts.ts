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
  /**
   * False when the OS offers no keychain (bare Linux without a keyring):
   * sign-in works for this launch but is NOT remembered between launches.
   * Renderers should surface this next to the account state. Optional so
   * older snapshots/tests stay valid; the session service always sets it.
   */
  credentialsPersisted?: boolean
}

export interface DevicePairingState {
  status: 'idle' | 'waiting' | 'approved' | 'denied' | 'expired' | 'error'
  userCode: string | null
  verificationUri: string | null
  expiresAt: number | null
  message: string | null
}

/** A booth computer currently signed into the church. */
export interface OrgDevice {
  id: string
  name: string
  hostname: string | null
  os: string | null
  osVersion: string | null
  arch: string | null
  appVersion: string | null
  electronVersion: string | null
  signedInAs: string
  signedInEmail: string | null
  lastSeenAt: string
  lastLoginAt: string
  ip: string | null
  online: boolean
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

/**
 * One row of the org members table.
 *
 * Name and email are joined from the user account — the membership alone only
 * carries the user id, which no human can read.
 */
export interface OrgMember {
  userId: string
  name: string
  email: string
  role: OrgRole
  status: 'active' | 'invited' | 'removed'
  joinedAt: string
}

// ─── Sermons ──────────────────────────────────────────────────────────────────

/**
 * The recap a person reads when they missed the service.
 *
 * Written for someone who was not there: the big idea stands alone, and every
 * quote is verbatim from the transcript (the server drops any the model made up).
 */
export interface SermonSummary {
  headline: string
  /** A self-contained explanation of the message for someone who missed it. */
  bigIdea: string
  keyPoints: { title: string; explanation: string }[]
  memorableQuotes: string[]
  takeaways: string[]
  /** Only passages central to the message, not every reference detected live. */
  keyScriptures: { reference: string; connection: string }[]
  callToAction?: string
}

/** `pending` means the summary is being generated right now. */
export type SermonStatus = 'pending' | 'ready' | 'failed'

/**
 * Why generation failed, in a form a client can act on.
 *
 * Shared rather than stringly-typed so a new code fails the build in every UI
 * that branches on it, instead of silently inheriting a generic "try again".
 */
export type SummaryErrorCode =
  | 'no-api-key'
  | 'provider'
  | 'timeout'
  | 'format'
  | 'refusal'
  | 'stalled'

export interface SermonListItem {
  id: string
  title: string
  speaker: string
  preachedAt: string
  durationMs: number
  wordCount: number
  status: SermonStatus
  headline: string | null
  shareEnabled: boolean
}

export interface SermonTranscriptSegment {
  id: string
  text: string
  timestamp: number
  duration: number
}

/**
 * Everything about a sermon except the transcript, which has its own route —
 * it is an order of magnitude larger, it is read far less often, and it carries
 * a stricter role.
 */
export interface SermonDetail extends SermonListItem {
  summary: SermonSummary | null
  failureReason: string | null
  /** Machine-readable, so the dashboard can offer the right next step. */
  failureCode: SummaryErrorCode | null
  shareToken: string | null
}

export interface SermonTranscriptPayload {
  segments: SermonTranscriptSegment[]
}

/** One page of sermons, newest first. `nextCursor` is null on the last page. */
export interface SermonListPage {
  items: SermonListItem[]
  nextCursor: string | null
}

/** One calendar month of preaching, used to compare this month against last. */
export interface SermonPeriodStats {
  services: number
  durationMs: number
}

/**
 * One chart bucket of preaching. `weekStart` is `YYYY-MM-DD` — Monday for
 * weekly series, the calendar day for daily series (`granularity`).
 */
export interface SermonWeekBucket {
  weekStart: string
  services: number
  durationMs: number
}

export interface SermonSpeakerStat {
  name: string
  services: number
  durationMs: number
}

export interface SermonBookStat {
  book: string
  count: number
}

export type SermonStatsRange = 'today' | '7d' | '4w' | '12w' | '6m' | 'ytd' | 'all' | 'custom'
export type SermonStatsGranularity = 'day' | 'week'

/**
 * Org-wide totals and series for the dashboard.
 *
 * Raw counts only — formatting (compact numbers, hours) lives client-side so
 * the dashboard and any future surface can each present them their own way.
 *
 * Only things we actually store: services, recaps, duration, words, speakers,
 * and scripture references. Attendance and share-page views are not tracked.
 *
 * Totals, speakers and books respect the requested range (or `from`/`to`) and
 * speaker filter. `previous` is the equal-length window immediately before that
 * range, so the dashboard can say "+2 vs previous" without inventing a trend.
 * `speakerNames` is everyone who preached in the range, unfiltered, for the
 * speaker dropdown. `granularity` says whether `weekly` is days or ISO weeks.
 */
export interface SermonStats {
  services: number
  recapsReady: number
  recapsFailed: number
  recapsPending: number
  totalDurationMs: number
  totalWords: number
  scripturePassages: number
  sharedLinks: number
  averageDurationMs: number
  previous: SermonPeriodStats
  granularity: SermonStatsGranularity
  weekly: SermonWeekBucket[]
  speakers: SermonSpeakerStat[]
  scriptureBooks: SermonBookStat[]
  speakerNames: string[]
}

/**
 * What the desktop app uploads when the operator ends a service.
 *
 * `localId` is the desktop `ServiceRecord.id`. The server keys on it so a
 * retried upload — the booth was offline the first time — updates the same
 * sermon instead of creating a duplicate.
 */
export interface SermonUploadInput {
  localId: string
  title: string
  speaker: string
  startedAt: number
  endedAt: number
  transcript: SermonUploadSegment[]
  scriptures: { reference: string; translation: string }[]
}

/** A transcript segment on the wire, word timings included. */
export interface SermonUploadSegment {
  id: string
  text: string
  timestamp: number
  duration: number
  words: { word: string; start: number; end: number; confidence: number }[]
}

export interface SermonUploadResult {
  id: string
  status: SermonStatus
}

/** The public share page — no transcript, no ids, no org internals. */
export interface PublicSermonPayload {
  title: string
  speaker: string
  churchName: string
  preachedAt: string
  summary: SermonSummary
}
