import { ForbiddenException, Injectable } from '@nestjs/common'

/** Plaintext map stored inside the AES envelope. Empty string = not set. */
export interface OrgSecretsPayload {
  deepgramApiKey: string
  anthropicApiKey: string
  deepseekApiKey: string
  bibleApiKey: string
  braveApiKey: string
  googleTranslateApiKey: string
}

export type OrgSecretsPatch = {
  [K in keyof OrgSecretsPayload]?: string | null
}

const EMPTY: OrgSecretsPayload = {
  deepgramApiKey: '',
  anthropicApiKey: '',
  deepseekApiKey: '',
  bibleApiKey: '',
  braveApiKey: '',
  googleTranslateApiKey: '',
}

const KEYS = Object.keys(EMPTY) as (keyof OrgSecretsPayload)[]

export function mergeSecretsPatch(
  current: OrgSecretsPayload,
  patch: OrgSecretsPatch,
): OrgSecretsPayload {
  const next = { ...current }
  for (const key of KEYS) {
    if (!(key in patch)) continue
    const value = patch[key]
    if (value === null) next[key] = ''
    else if (typeof value === 'string') next[key] = value.trim()
  }
  return next
}

export function secretsResponse(
  payload: OrgSecretsPayload,
  updatedAt: Date | null,
): OrgSecretsPayload & { updatedAt: string | null } {
  return {
    deepgramApiKey: payload.deepgramApiKey || '',
    anthropicApiKey: payload.anthropicApiKey || '',
    deepseekApiKey: payload.deepseekApiKey || '',
    bibleApiKey: payload.bibleApiKey || '',
    braveApiKey: payload.braveApiKey || '',
    googleTranslateApiKey: payload.googleTranslateApiKey || '',
    updatedAt: updatedAt ? updatedAt.toISOString() : null,
  }
}

@Injectable()
export class OrgSecretsService {
  async get(orgId: string): Promise<ReturnType<typeof secretsResponse>> {
    void orgId
    return secretsResponse(EMPTY, null)
  }

  async put(
    orgId: string,
    userId: string,
    patch: OrgSecretsPatch,
  ): Promise<ReturnType<typeof secretsResponse>> {
    void orgId; void userId; void patch
    throw new ForbiddenException('Provider keys are now managed centrally by Kairo. Contact your platform superadmin; church API-key editing is no longer available.')
  }

}
