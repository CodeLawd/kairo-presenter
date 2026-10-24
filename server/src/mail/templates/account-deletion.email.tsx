import { Heading, Section, Text } from 'react-email'
import { EmailLayout, PRODUCT_NAME } from './layout'

export interface AccountDeletionEmailProps {
  firstName: string
  /** Six digits, typed into the dashboard's delete-account step. */
  code: string
}

/**
 * Sent when someone without a password asks to delete their account.
 *
 * No link on purpose: deleting is irreversible, so it only happens from the
 * dashboard, where the person has just read exactly what will be removed.
 */
export function AccountDeletionEmail({ firstName, code }: AccountDeletionEmailProps): React.ReactElement {
  return (
    <EmailLayout preview={`${code} is your code to delete your ${PRODUCT_NAME} account`}>
      <Section className="rounded-lg bg-background-muted px-6 py-8 text-center">
        <Heading className="m-0 text-2xl font-bold text-foreground">Delete your account</Heading>
        <Text className="mt-3 text-base text-foreground-muted">
          Hi {firstName}, enter this code in the {PRODUCT_NAME} dashboard to confirm you want to
          delete your account.
        </Text>
        <Text className="my-6 text-4xl font-bold tracking-[0.3em] text-foreground">{code}</Text>
        <Text className="mt-2 text-sm text-foreground-muted">Expires in 15 minutes.</Text>
      </Section>

      <Section className="py-4">
        <Text className="text-sm text-foreground-muted">
          If you did not ask for this, nothing has been deleted. Someone may be signed in to your
          account — sign out your devices from the dashboard.
        </Text>
      </Section>
    </EmailLayout>
  )
}

export function accountDeletionEmailText({ firstName, code }: AccountDeletionEmailProps): string {
  return [
    `Hi ${firstName},`,
    '',
    `Your code to delete your ${PRODUCT_NAME} account is: ${code}`,
    '',
    'Enter it in the dashboard to confirm. It expires in 15 minutes.',
    '',
    'If you did not ask for this, nothing has been deleted. Someone may be signed in to your',
    'account — sign out your devices from the dashboard.',
  ].join('\n')
}
