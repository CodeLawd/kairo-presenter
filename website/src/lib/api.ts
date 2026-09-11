/**
 * The one place the web app talks to the API.
 *
 * Requests stay same-origin (`/v1/...`) and are proxied by
 * `src/app/v1/[...path]/route.ts`. That keeps the HttpOnly refresh cookie
 * first-party — required when the site is on Vercel and the API on Render.
 */
const API_URL = ''

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message)
  }
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; accessToken?: string } = {},
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-PA-Client': 'web',
        ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch {
    throw new ApiError('Could not reach Kairo. Check your connection.', null)
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    // Nest's ValidationPipe returns an array; the first entry is the one the
    // person needs to read.
    const raw = (payload as { message?: string | string[] } | null)?.message
    const message = Array.isArray(raw) ? raw[0] : raw
    throw new ApiError(message ?? 'Something went wrong.', response.status)
  }

  return (await response.json().catch(() => null)) as T
}

/**
 * A renewable access token. `useAccessToken` in `lib/session.ts` is the one
 * implementation; the indirection exists so `authedApi` can re-mint without
 * knowing where the token is held.
 */
export interface TokenSource {
  get: () => Promise<string>
  refresh: () => Promise<string>
}

/**
 * An authenticated request that survives its own token expiring.
 *
 * Access tokens last ~15 minutes. `get()` renews before that, which covers a
 * page left open; this also replays once on a 401, which covers the token
 * expiring between `get()` and the server reading it. Without the replay, a
 * long-lived dashboard shows "Unauthorized" and its retry button reuses the
 * same dead token.
 *
 * The replay is deliberately single-shot: a second 401 means the refresh cookie
 * itself is gone, and retrying that is a loop, not a recovery.
 */
export async function authedApi<T>(
  path: string,
  tokens: TokenSource,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  try {
    return await api<T>(path, { ...options, accessToken: await tokens.get() })
  } catch (failure) {
    if (!(failure instanceof ApiError) || failure.status !== 401) throw failure
    return api<T>(path, { ...options, accessToken: await tokens.refresh() })
  }
}
