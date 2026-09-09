/**
 * The one place the web app talks to the API.
 *
 * `credentials: 'include'` on every call because the refresh token is an
 * HttpOnly cookie the page cannot read — that is deliberate, and it means the
 * browser must be allowed to carry it.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'

export interface ApiFailure {
  message: string
  status: number | null
}

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
