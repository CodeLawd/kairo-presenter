import type { CookieOptions, Response } from 'express'
import type { AppConfig } from '../config/env'

/** Name of the web refresh cookie. Desktop never sees it. */
export const REFRESH_COOKIE = 'pa_refresh'

/**
 * HttpOnly refresh cookie for the web client.
 *
 * The website proxies `/v1` through Next.js, so the browser stores this as a
 * first-party cookie on the site origin. Lax is enough — and avoids depending
 * on third-party cookie behaviour between Vercel and Render.
 */
export function setRefreshCookie(
  response: Response,
  token: string,
  config: AppConfig,
): void {
  const production = config.nodeEnv === 'production'
  const options: CookieOptions = {
    httpOnly: true,
    secure: production,
    sameSite: 'lax',
    // Scoped to the auth routes: no other endpoint has any use for it.
    path: '/v1/auth',
    maxAge: config.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
  }
  response.cookie(REFRESH_COOKIE, token, options)
}

export function clearRefreshCookie(response: Response, config: AppConfig): void {
  const production = config.nodeEnv === 'production'
  response.clearCookie(REFRESH_COOKIE, {
    path: '/v1/auth',
    secure: production,
    sameSite: 'lax',
  })
}
