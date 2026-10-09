import type { ExecutionContext } from '@nestjs/common'
import type { Response } from 'express'
import { GoogleAuthGuard } from './google-auth.guard'
import { loadConfig } from '../../config/env'

const config = loadConfig({
  JWT_SECRET: 'test-signing-key', MONGO_URL: 'mongodb://localhost/test',
  VAULT_ENCRYPTION_KEY: 'test-vault', GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret',
  PUBLIC_WEB_URL: 'https://kairo.test',
})

function fixture(query: Record<string, string> = {}, cookies: Record<string, string> = {}) {
  const request = { query, cookies, path: '/v1/auth/google' }
  const written: Record<string, string> = {}
  const response = {
    cookie: jest.fn((key: string, value: string) => { written[key] = value }),
    clearCookie: jest.fn(), redirect: jest.fn(),
  } as unknown as Response
  const context = { switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }) } as unknown as ExecutionContext
  return { request, response, context, written }
}

describe('Google OAuth browser binding', () => {
  it('uses unpredictable state and a short-lived HttpOnly browser cookie', () => {
    const guard = new GoogleAuthGuard(config)
    const first = fixture({ returnTo: '/activate?userCode=ABCD-EFGH' })
    const second = fixture({ returnTo: '/activate?userCode=ABCD-EFGH' })
    const a = guard.getAuthenticateOptions(first.context)
    const b = guard.getAuthenticateOptions(second.context)
    expect(a.state).toEqual(expect.any(String))
    expect(a.state).not.toBe('/activate?userCode=ABCD-EFGH')
    expect(a.state).not.toBe(b.state)
    expect(first.response.cookie).toHaveBeenCalledWith('pa_google_state', a.state,
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/v1/auth/google', maxAge: 600_000 }))
  })

  it('rejects a callback from a browser that did not start it', async () => {
    const guard = new GoogleAuthGuard(config)
    const f = fixture({ state: '/dashboard', code: 'attacker-code' })
    f.request.path = '/v1/auth/google/callback'
    expect(await guard.canActivate(f.context)).toBe(false)
    expect(f.response.redirect).toHaveBeenCalledWith('https://kairo.test/login?googleError=expired&returnTo=%2Fdashboard')
  })

  it('handles cancellation only after validating state, preserving the pairing destination', async () => {
    const guard = new GoogleAuthGuard(config)
    const start = fixture({ returnTo: '/activate?userCode=ABCD-EFGH' })
    const { state } = guard.getAuthenticateOptions(start.context)
    const callback = fixture({ state: state as string, error: 'access_denied' }, start.written)
    callback.request.path = '/v1/auth/google/callback'
    expect(await guard.canActivate(callback.context)).toBe(false)
    expect(callback.response.redirect).toHaveBeenCalledWith('https://kairo.test/login?googleError=cancelled&returnTo=%2Factivate%3FuserCode%3DABCD-EFGH')
    expect(callback.response.clearCookie).toHaveBeenCalled()
  })

  it('rejects a modified state even when the browser supplies the same modified cookie', async () => {
    const guard = new GoogleAuthGuard(config)
    const start = fixture({ returnTo: '/dashboard' })
    const { state } = guard.getAuthenticateOptions(start.context)
    const changed = `${state}tampered`
    const f = fixture({ state: changed, error: 'access_denied' }, { pa_google_state: changed })
    f.request.path = '/v1/auth/google/callback'
    expect(await guard.canActivate(f.context)).toBe(false)
    expect(f.response.redirect).toHaveBeenCalledWith(expect.stringContaining('googleError=expired'))
  })

  it('rejects expired state', async () => {
    jest.useFakeTimers()
    try {
      const guard = new GoogleAuthGuard(config)
      const start = fixture({ returnTo: '/dashboard' })
      const { state } = guard.getAuthenticateOptions(start.context)
      jest.advanceTimersByTime(600_001)
      const f = fixture({ state: state as string, error: 'access_denied' }, start.written)
      f.request.path = '/v1/auth/google/callback'
      expect(await guard.canActivate(f.context)).toBe(false)
      expect(f.response.redirect).toHaveBeenCalledWith(expect.stringContaining('googleError=expired'))
    } finally { jest.useRealTimers() }
  })

  it.each(['//evil.test', '/\\evil.test', '/%5cevil.test', 'https://evil.test'])('discards unsafe return path %s', async (returnTo) => {
    const guard = new GoogleAuthGuard(config)
    const start = fixture({ returnTo })
    const { state } = guard.getAuthenticateOptions(start.context)
    const f = fixture({ state: state as string, error: 'access_denied' }, start.written)
    f.request.path = '/v1/auth/google/callback'
    expect(await guard.canActivate(f.context)).toBe(false)
    expect(f.response.redirect).toHaveBeenCalledWith('https://kairo.test/login?googleError=cancelled&returnTo=%2Fdashboard')
  })
})
