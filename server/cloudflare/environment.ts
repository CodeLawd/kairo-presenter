/** Only API configuration crosses from the Worker into the Node container. */
const REQUIRED = ['MONGO_URL', 'JWT_SECRET', 'VAULT_ENCRYPTION_KEY'] as const
const OPTIONAL = [
  'ACCESS_TOKEN_TTL', 'REFRESH_TOKEN_TTL_DAYS', 'WEB_ORIGIN', 'PUBLIC_WEB_URL',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL',
  'BREVO_API_KEY', 'BREVO_SENDER_EMAIL', 'BREVO_SENDER_NAME',
  'SUPERADMIN_EMAILS', 'ADMIN_EMAILS', 'DOWNLOAD_INGEST_KEY',
  'SERMON_MODEL', 'SERMON_DEEPSEEK_MODEL', 'SERMON_REASONING_EFFORT',
] as const

export function containerEnvironment(bindings: Record<string, unknown>): Record<string, string> {
  const missing = REQUIRED.filter((key) => typeof bindings[key] !== 'string' || !String(bindings[key]).trim())
  if (missing.length) throw new Error(`Missing API container secrets: ${missing.join(', ')}`)
  const env: Record<string, string> = {
    NODE_ENV: 'production', PORT: '3000',
    PUBLIC_WEB_URL: 'https://kairopresenter.com', WEB_ORIGIN: 'https://kairopresenter.com',
  }
  for (const key of [...REQUIRED, ...OPTIONAL]) {
    const value = bindings[key]
    if (typeof value === 'string' && value.trim()) env[key] = value
  }
  return env
}
