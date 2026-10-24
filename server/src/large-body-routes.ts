/**
 * Routes allowed a body larger than the 100kb default.
 *
 * Kept as data next to the parser that reads it, so granting width to a new
 * upload is one entry rather than an edit to a regex inside middleware. Each
 * entry should say, in a comment, why the route is large.
 */
export interface LargeBodyRoute {
  method: 'POST' | 'PUT' | 'PATCH'
  path: RegExp
  limit: string
}

export const LARGE_BODY_ROUTES: LargeBodyRoute[] = [
  {
    // Sermon upload: a full service transcript with word-level timings. A
    // 45-minute service is roughly 0.5-1 MB; 12mb covers about four hours.
    method: 'POST',
    path: /^\/v\d+\/orgs\/[^/]+\/sermons\/?$/,
    limit: '12mb',
  },
  {
    // Crash summaries: up to 10 queued reports, each with a 64 KB log tail
    // and a few error lines (src/lib/cloud/crashes.ts).
    method: 'POST',
    path: /^\/v\d+\/crashes\/?$/,
    limit: '1mb',
  },
]
