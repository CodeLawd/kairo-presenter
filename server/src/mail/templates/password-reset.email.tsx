import { Button, Heading, Link, Section, Text } from 'react-email'
import { BRAND_COLOR, BRAND_INK, BRAND_LINK, EmailLayout, PRODUCT_NAME } from './layout'

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
      <Section>
        <Heading
          style={{
            color: BRAND_INK,
            fontSize: '24px',
            fontWeight: 700,
            letterSpacing: '-0.02em',
            lineHeight: '32px',
            margin: '0 0 16px',
          }}
        >
          Reset your {PRODUCT_NAME} password
        </Heading>

        <Text
          style={{
            color: BRAND_INK,
            fontSize: '16px',
            lineHeight: '26px',
            margin: '0 0 24px',
          }}
        >
          Click the button below to choose a new password for your <strong>{PRODUCT_NAME}</strong>{' '}
          account. This link works once and is <strong>valid for 30 minutes</strong>.
        </Text>

        <Button
          href={resetUrl}
          style={{
            backgroundColor: BRAND_COLOR,
            borderRadius: '8px',
            color: '#FFFFFF',
            display: 'inline-block',
            fontSize: '16px',
            fontWeight: 600,
            lineHeight: '20px',
            padding: '14px 28px',
            textDecoration: 'none',
          }}
        >
          Choose a new password
        </Button>

        <Text
          style={{
            color: '#565B6E',
            fontSize: '13px',
            lineHeight: '20px',
            margin: '16px 0 4px',
          }}
        >
          Or open this link in your browser:
        </Text>
        <Text
          style={{
            fontSize: '13px',
            lineHeight: '20px',
            margin: '0 0 20px',
            wordBreak: 'break-all',
          }}
        >
          <Link href={resetUrl} style={{ color: BRAND_LINK, textDecoration: 'underline' }}>
            {resetUrl}
          </Link>
        </Text>

        <Text
          style={{
            color: '#666B7E',
            fontSize: '14px',
            lineHeight: '22px',
            margin: 0,
          }}
        >
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
    '',
    'Best,',
    `Your ${PRODUCT_NAME} team`,
  ].join('\n')
}
