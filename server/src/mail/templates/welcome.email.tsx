import { Button, Heading, Section, Text } from 'react-email'
import { EmailLayout, PRODUCT_NAME } from './layout'

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
      <Section className="rounded-lg bg-background-muted px-6 py-8 text-center">
        <Heading className="m-0 text-3xl font-bold text-foreground">Welcome, {firstName}</Heading>
        <Text className="mt-3 text-base text-foreground-muted">
          Enter this code in {PRODUCT_NAME} to confirm your email address.
        </Text>

        <Text className="my-6 text-4xl font-bold tracking-[0.3em] text-foreground">{code}</Text>
        <Text className="mt-2 text-sm text-foreground-muted">
          Expires in 24 hours. Only ever type it into Kairo.
        </Text>
        <Button
          href={url}
          className="mt-4 rounded-lg bg-primary px-6 py-3 text-base font-semibold text-white"
        >
          Confirm email address
        </Button>
      </Section>

      <Section className="py-4">
        <Text className="text-sm text-foreground-muted">
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
  ].join('\n')
}
