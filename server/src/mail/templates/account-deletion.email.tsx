import { Heading, Section, Text } from 'react-email'
import { BRAND_INK, EmailLayout, PRODUCT_NAME } from './layout'

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
          Delete your {PRODUCT_NAME} account
        </Heading>

        <Text
          style={{
            color: BRAND_INK,
            fontSize: '16px',
            lineHeight: '26px',
            margin: '0 0 20px',
          }}
        >
          Hi <strong>{firstName}</strong>, enter this code in the {PRODUCT_NAME} dashboard to
          confirm you want to delete your account. The code is <strong>valid for 15 minutes</strong>.
        </Text>

        <Section
          style={{
            backgroundColor: '#E8EAF0',
            borderRadius: '10px',
            marginBottom: '20px',
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

        <Text
          style={{
            color: '#666B7E',
            fontSize: '14px',
            lineHeight: '22px',
            margin: 0,
          }}
        >
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
    '',
    'Best,',
    `Your ${PRODUCT_NAME} team`,
  ].join('\n')
}
