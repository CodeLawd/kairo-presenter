import { Button, Heading, Link, Section, Text } from 'react-email'
import { BRAND_COLOR, BRAND_INK, BRAND_LINK, EmailLayout, PRODUCT_NAME } from './layout'

export interface EngageInviteEmailProps {
  engagementName: string
  orgName?: string
  link: string
  baseUrl?: string
}

export function EngageInviteEmail({
  engagementName,
  orgName,
  link,
  baseUrl = 'https://kairopresenter.com',
}: EngageInviteEmailProps): React.ReactElement {
  const cleanBase = baseUrl.replace(/\/$/, '')
  const hostLabel = orgName && orgName.trim() && orgName.trim() !== PRODUCT_NAME ? orgName.trim() : null

  return (
    <EmailLayout
      preview={`You've been invited to collaborate on ${engagementName}`}
      baseUrl={cleanBase}
    >
      <Section>
        <Heading
          style={{
            color: BRAND_INK,
            fontSize: '24px',
            fontWeight: 700,
            letterSpacing: '-0.02em',
            lineHeight: '32px',
            margin: '0 0 20px',
          }}
        >
          You&apos;ve been invited to collaborate on a {PRODUCT_NAME} engagement
        </Heading>

        <Text
          style={{
            color: BRAND_INK,
            fontSize: '16px',
            lineHeight: '26px',
            margin: '0 0 18px',
          }}
        >
          {hostLabel ? (
            <>
              <strong>{hostLabel}</strong> needs your help with their {PRODUCT_NAME} engagement{' '}
              <strong>{engagementName}</strong>.
            </>
          ) : (
            <>
              You&apos;ve been invited to help with the {PRODUCT_NAME} engagement{' '}
              <strong>{engagementName}</strong>.
            </>
          )}{' '}
          Once you join, you&apos;ll be able to manage polls and moderate the Q&amp;A.
        </Text>

        <Text
          style={{
            color: BRAND_INK,
            fontSize: '16px',
            lineHeight: '26px',
            margin: '0 0 24px',
          }}
        >
          To accept the invitation, click the button below to open the moderation view. The
          invitation is <strong>valid for 72 hours</strong>.
        </Text>

        <Button
          href={link}
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
          Accept invite
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
            margin: '0 0 24px',
            wordBreak: 'break-all',
          }}
        >
          <Link href={link} style={{ color: BRAND_LINK, textDecoration: 'underline' }}>
            {link}
          </Link>
        </Text>

        <Text
          style={{
            color: BRAND_INK,
            fontSize: '15px',
            lineHeight: '24px',
            margin: '0 0 12px',
          }}
        >
          By accepting the invitation you agree to the{' '}
          <Link href={`${cleanBase}/terms`} style={{ color: BRAND_LINK, textDecoration: 'underline' }}>
            {PRODUCT_NAME} Terms
          </Link>
          .
        </Text>
      </Section>
    </EmailLayout>
  )
}

export function engageInviteEmailText({
  engagementName,
  orgName,
  link,
}: EngageInviteEmailProps): string {
  const hostLabel = orgName && orgName.trim() && orgName.trim() !== PRODUCT_NAME ? orgName.trim() : null
  return [
    `You've been invited to collaborate on a ${PRODUCT_NAME} engagement`,
    '',
    hostLabel
      ? `${hostLabel} needs your help with their ${PRODUCT_NAME} engagement "${engagementName}". Once you join, you'll be able to manage polls and moderate the Q&A.`
      : `You've been invited to help with the ${PRODUCT_NAME} engagement "${engagementName}". Once you join, you'll be able to manage polls and moderate the Q&A.`,
    '',
    'To accept the invitation, open the link below in your browser. The invitation is valid for 72 hours and can be used once:',
    link,
    '',
    'Best,',
    `Your ${PRODUCT_NAME} team`,
  ].join('\n')
}
