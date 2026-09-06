import { Section, Text } from 'react-email'
import { CallToActionSection } from '@/components/email/call-to-action'
import { EmailLayout, PRODUCT_NAME } from './layout'

export interface PasswordResetEmailProps {
  resetUrl: string
}

/**
 * Deliberately plainer than the welcome email: someone reading this may be
 * locked out mid-service, or may not have asked for it at all. One action, one
 * reassurance, nothing to scroll past.
 */
export function PasswordResetEmail({ resetUrl }: PasswordResetEmailProps): React.ReactElement {
  return (
    <EmailLayout preview={`Reset your ${PRODUCT_NAME} password`}>
      <CallToActionSection
        heading="Reset your password"
        subtext="Choose a new password. The link works once and expires in 30 minutes."
        ctaLabel="Choose a new password"
        ctaHref={resetUrl}
      />

      <Section className="py-4">
        <Text className="text-sm text-foreground-muted">
          If you did not ask for this, nothing has changed on your account and you can ignore this
          email.
        </Text>
      </Section>
    </EmailLayout>
  )
}

export function passwordResetEmailText({ resetUrl }: PasswordResetEmailProps): string {
  return [
    'Use the link below to choose a new password:',
    resetUrl,
    '',
    'The link expires in 30 minutes and can only be used once.',
    '',
    'If you did not ask for this, nothing has changed on your account.',
  ].join('\n')
}
