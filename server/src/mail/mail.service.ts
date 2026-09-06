import { Inject, Injectable, Logger } from '@nestjs/common'
import { render } from '@react-email/render'
import { APP_CONFIG } from '../config/config.module'
import type { AppConfig } from '../config/env'
import { BrevoTransport, OutboundEmail } from './brevo.transport'
import { WelcomeEmail, welcomeEmailText } from './templates/welcome.email'
import { PasswordResetEmail, passwordResetEmailText } from './templates/password-reset.email'

/**
 * Renders the React Email templates and hands them to Brevo.
 *
 * With no BREVO_API_KEY the message is logged instead of sent, including the
 * link it carries. That is what lets a developer run signup and verification
 * end to end with no third-party account — and it means a missing key degrades
 * to "no email" rather than to a failed request.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name)
  private readonly transport: BrevoTransport | null

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.transport = this.config.mail ? new BrevoTransport(this.config.mail) : null
  }

  get enabled(): boolean {
    return this.transport !== null
  }

  async sendWelcome(
    to: string,
    firstName: string,
    confirmation: { code: string; url: string },
  ): Promise<void> {
    await this.deliver({
      to,
      subject: `${confirmation.code} is your Kairo confirmation code`,
      html: await render(WelcomeEmail({ firstName, ...confirmation })),
      text: welcomeEmailText({ firstName, ...confirmation }),
    })
  }

  async sendPasswordReset(to: string, resetUrl: string): Promise<void> {
    await this.deliver({
      to,
      subject: 'Reset your Kairo password',
      html: await render(PasswordResetEmail({ resetUrl })),
      text: passwordResetEmailText({ resetUrl }),
    })
  }

  /**
   * A failed send is logged, never thrown.
   *
   * The account, invite or reset that triggered the email already exists —
   * failing the request because a mail provider was slow would leave the caller
   * believing nothing happened when in fact everything did.
   */
  private async deliver(message: OutboundEmail): Promise<void> {
    if (!this.transport) {
      this.logger.log(`[mail:not-configured] to=${message.to} subject="${message.subject}"`)
      this.logger.log(message.text)
      return
    }
    await this.transport.send(message)
  }
}
