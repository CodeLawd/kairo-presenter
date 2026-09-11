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
]
