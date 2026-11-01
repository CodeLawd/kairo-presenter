import { Body, Container, Head, Hr, Html, Img, Link, Preview, Section, Tailwind, Text } from 'react-email'
import { createEmailTailwindConfig } from '@/components/email/email-theme'
import { defaultTheme } from '@/components/email/theme-default'

export const PRODUCT_NAME = 'Kairo'
export const BRAND_INK = '#0A0B10'
export const BRAND_COLOR = '#3B6BFF'
export const BRAND_LINK = '#2F5BE0'
export const BRAND_LOGO_URL = 'https://kairopresenter.com/brand/logo-white.png'

/**
 * The shell every transactional email renders inside.
 *
 * Clean, left-aligned layout with the Kairo brand lockup at the top,
 * structured body copy, sign-off, and footer.
 */
export function EmailLayout({
  preview,
  baseUrl = 'https://kairopresenter.com',
  children,
}: {
  preview: string
  baseUrl?: string
  children: React.ReactNode
}): React.ReactElement {
  const cleanBase = baseUrl.replace(/\/$/, '')
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Tailwind config={createEmailTailwindConfig(defaultTheme)}>
        <Body
          style={{
            backgroundColor: '#F3F4F7',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
            margin: 0,
            padding: '24px 12px',
          }}
        >
          <Container
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: '12px',
              margin: '0 auto',
              maxWidth: '600px',
              padding: '40px 40px 32px',
            }}
          >
            <Section style={{ paddingBottom: '24px' }}>
              <Link href={cleanBase} style={{ display: 'inline-block', textDecoration: 'none' }}>
                <Img
                  src={BRAND_LOGO_URL}
                  alt={PRODUCT_NAME}
                  width="117"
                  height="28"
                  style={{
                    display: 'block',
                    filter: 'brightness(0)',
                    WebkitFilter: 'brightness(0)',
                    height: '28px',
                    opacity: 0.93,
                    width: '117px',
                  }}
                />
              </Link>
            </Section>

            {children}

            <Section style={{ paddingTop: '24px' }}>
              <Text
                style={{
                  color: BRAND_INK,
                  fontSize: '16px',
                  lineHeight: '24px',
                  margin: 0,
                }}
              >
                Best,
                <br />
                Your {PRODUCT_NAME} team
              </Text>
            </Section>

            <Section style={{ paddingTop: '32px' }}>
              <Hr style={{ borderColor: '#E8EAF0', margin: '0 0 20px' }} />
              <Text
                style={{
                  color: '#565B6E',
                  fontSize: '12px',
                  lineHeight: '20px',
                  margin: '0 0 4px',
                }}
              >
                Made with <span style={{ color: BRAND_COLOR }}>&#10084;</span> by {PRODUCT_NAME}
              </Text>
              <Text
                style={{
                  color: '#565B6E',
                  fontSize: '12px',
                  lineHeight: '20px',
                  margin: '0 0 4px',
                }}
              >
                <Link href={`${cleanBase}/support`} style={{ color: '#565B6E', textDecoration: 'underline' }}>
                  Help Center
                </Link>
                {' | '}
                <Link href={`${cleanBase}/privacy`} style={{ color: '#565B6E', textDecoration: 'underline' }}>
                  Privacy Statement
                </Link>
                {' | '}
                <Link href={`${cleanBase}/terms`} style={{ color: '#565B6E', textDecoration: 'underline' }}>
                  Terms of Service
                </Link>
              </Text>
              <Text
                style={{
                  color: '#666B7E',
                  fontSize: '12px',
                  lineHeight: '20px',
                  margin: '0 0 16px',
                }}
              >
                This is an automated email, please do not reply.
              </Text>
              <Text
                style={{
                  color: '#666B7E',
                  fontSize: '12px',
                  lineHeight: '18px',
                  margin: 0,
                }}
              >
                &copy; {new Date().getFullYear()} {PRODUCT_NAME}. All rights reserved.
              </Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}
