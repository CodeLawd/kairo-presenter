/** Keep local phone-page development on the same local room Worker as desktop. */
export function audiencePhoneApiBase(hostname: string, configured?: string): string {
  if (configured?.trim()) return configured.trim().replace(/\/$/, '')
  if (hostname === 'localhost' || hostname === '127.0.0.1') return `http://${hostname}:8787`
  return 'https://api.kairopresenter.com'
}
