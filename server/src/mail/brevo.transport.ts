import { Logger } from '@nestjs/common'

export interface BrevoConfig {
  apiKey: string
  fromEmail: string
  fromName: string
}

export interface OutboundEmail {
  to: string
  subject: string
  html: string
  text: string
}

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email'
/** A slow mail API must not hold a signup request open. */
const REQUEST_TIMEOUT_MS = 10_000

/**
 * Brevo transactional send over HTTPS rather than SMTP.
 *
 * Managed hosts commonly block or throttle outbound SMTP ports, and an HTTP
 * call gives a real status code and error body to log instead of a socket
 * timeout. The API key is a server-side secret — it never reaches the desktop
 * app or the browser.
 */
export class BrevoTransport {
  private readonly logger = new Logger(BrevoTransport.name)

  constructor(private readonly config: BrevoConfig) {}

  /** Resolves false on failure — the caller decides whether that matters. */
  async send(message: OutboundEmail): Promise<boolean> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const response = await fetch(BREVO_ENDPOINT, {
        method: 'POST',
        headers: {
          'api-key': this.config.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender: { email: this.config.fromEmail, name: this.config.fromName },
          to: [{ email: message.to }],
          subject: message.subject,
          htmlContent: message.html,
          textContent: message.text,
        }),
        signal: controller.signal,
      })

      if (response.status === 201 || response.status === 202) return true

      // Brevo puts the reason in the body — a bare status hides "sender not
      // verified", which is the failure everyone hits first.
      const detail = await response.text().catch(() => '')
      this.logger.error(
        `Brevo rejected "${message.subject}" for ${message.to}: ${response.status} ${detail.slice(0, 300)}`,
      )
      return false
    } catch (error) {
      const reason = (error as Error).name === 'AbortError' ? 'timed out' : (error as Error).message
      this.logger.error(`Brevo request failed for ${message.to}: ${reason}`)
      return false
    } finally {
      clearTimeout(timer)
    }
  }
}
