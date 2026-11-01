import { Button, Heading, Link, Section, Text } from 'react-email'
import { BRAND_COLOR, BRAND_INK, BRAND_LINK, EmailLayout, PRODUCT_NAME } from './layout'

export interface WelcomeEmailProps {
  firstName: string
  /** Six digits, typed straight into the app. */
  code: string
  /** Same confirmation, for someone reading this on a phone. */
  url: string
}

/**
 * Sent once, at signup.
 *
 * The code comes first and large, because the person is most likely sitting in
 * front of Kairo waiting to type it — a booth machine often has no mail
 * client at all. The link is the fallback for whoever reads this on a phone.
 */
export function WelcomeEmail({ firstName, code, url }: WelcomeEmailProps): React.ReactElement {
  return (
    <EmailLayout preview={`${code} is your ${PRODUCT_NAME} confirmation code`}>
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
          Welcome to {PRODUCT_NAME}, {firstName}
        </Heading>

        <Text
          style={{
            color: BRAND_INK,
            fontSize: '16px',
            lineHeight: '26px',
            margin: '0 0 20px',
          }}
        >
          Enter this confirmation code in <strong>{PRODUCT_NAME}</strong> to verify your email
          address, or click the button below. The code is <strong>valid for 24 hours</strong>.
        </Text>

        <Section
          style={{
            backgroundColor: '#E8EAF0',
            borderRadius: '10px',
            marginBottom: '24px',
            padding: '20px 24px',
            textAlign: 'center',
          }}
        >
          <Text
            style={{
              color: BRAND_INK,
              fontSize: '32px',
              fontWeight: 700,
              letterSpacing: '0.28em',
              margin: 0,
            }}
          >
            {code}
          </Text>
        </Section>

        <Button
          href={url}
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
          Confirm email address
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
          <Link href={url} style={{ color: BRAND_LINK, textDecoration: 'underline' }}>
            {url}
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
          Did not create this account? Ignore this email and nothing happens.
        </Text>
      </Section>
    </EmailLayout>
  )
}

/** Plain-text alternative. Every send carries one — some clients show only this. */
export function welcomeEmailText({ firstName, code, url }: WelcomeEmailProps): string {
  return [
    `Hi ${firstName},`,
    '',
    `Your ${PRODUCT_NAME} confirmation code is: ${code}`,
    '',
    `Enter it in ${PRODUCT_NAME}, or use this link instead:`,
    url,
    '',
    'Both expire in 24 hours. Only ever type this code into Kairo.',
    '',
    'If you did not create this account, you can ignore this message.',
    '',
    'Best,',
    `Your ${PRODUCT_NAME} team`,
  ].join('\n')
}
