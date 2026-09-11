/**
 * Where the Nest API actually lives.
 *
 * Server-side only. Browser code goes through `lib/api.ts`, which uses relative
 * paths so requests stay same-origin and the HttpOnly refresh cookie stays
 * first-party. Server components have no origin to be relative to, so they need
 * the real address — the public sermon page is the one that does.
 */
export function apiTarget(): string {
  return (
    process.env.API_PROXY_TARGET ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '')
}
