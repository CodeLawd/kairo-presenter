import { Body, Container, Head, Hr, Html, Preview, Section, Tailwind, Text } from 'react-email'
import { createEmailTailwindConfig } from '@/components/email/email-theme'
import { defaultTheme } from '@/components/email/theme-default'

export const PRODUCT_NAME = 'Kairo'

/**
 * The shell every transactional email renders inside.
 *
 * One layout rather than per-email markup: an operator should recognise a
 * Kairo email at a glance, and a shared shell is the only way the wordmark
 * and footer cannot drift apart between messages.
 */
export function EmailLayout({
  preview,
  children,
}: {
  preview: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Tailwind config={createEmailTailwindConfig(defaultTheme)}>
        <Body className="bg-background font-sans">
          <Container className="mx-auto max-w-container p-8">
            <Section className="py-4">
              <Text className="text-lg font-bold text-foreground">{PRODUCT_NAME}</Text>
            </Section>
            {children}
            <Section className="pt-6">
              <Hr className="border-border" />
              <Text className="text-xs text-foreground-muted">
                {PRODUCT_NAME} · Built for calm, reliable church presentation.
              </Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}
