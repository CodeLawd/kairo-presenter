/**
 * Feedback from inside the app — an idea, a problem, or a kind word — shared by
 * the desktop (which sends it) and the API (which stores it for the staff
 * console). Who sent it is never in the body: the API takes the user, church
 * and install from the signed-in token, so staff can reply to the right person.
 */

export const FEEDBACK_KINDS = ['idea', 'problem', 'praise', 'other'] as const
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]

export const FEEDBACK_STATUSES = ['new', 'read', 'done'] as const
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number]

export const FEEDBACK_MAX_CHARS = 5000

export interface FeedbackUpload {
  kind: FeedbackKind
  message: string
  /** Where the operator was when they wrote it (e.g. "operator", "lyrics"). */
  context?: string
  appVersion: string
  os: string
  osVersion: string
}

export interface FeedbackUploadResult {
  id: string
}
