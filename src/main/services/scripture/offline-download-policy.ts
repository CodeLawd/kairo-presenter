/**
 * Whole-translation offline download is a licence decision, never something
 * inferred from possession of an API key. Two provisioning paths exist:
 *
 * 1. the `scripture.offlineDownloadBibleIds` setting, written per install; and
 * 2. the `PROAUTOMATE_OFFLINE_BIBLE_IDS` environment variable, for a build or
 *    deployment that ships with rights already confirmed.
 *
 * Public-domain translations are exempt — no approval is needed to store text
 * that carries no licence restriction.
 */
export const OFFLINE_BIBLE_IDS_ENV_VAR = 'PROAUTOMATE_OFFLINE_BIBLE_IDS'

const PUBLIC_DOMAIN = /public\s+domain/i

export function resolveOfflineDownloadBibleIds(
  stored: string[] | undefined,
  env: Record<string, string | undefined> = process.env,
): string[] {
  const fromEnv = (env[OFFLINE_BIBLE_IDS_ENV_VAR] ?? '').split(/[,\s]+/)
  const ids = [...(stored ?? []), ...fromEnv].map((id) => id.trim()).filter(Boolean)
  return [...new Set(ids)]
}

export function isOfflineDownloadPermitted(
  bibleId: string,
  allowlist: string[],
  copyright: string,
): boolean {
  return allowlist.includes(bibleId) || PUBLIC_DOMAIN.test(copyright)
}
