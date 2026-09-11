import type { ConfirmationLevel } from './scripture-trace'
import type { OverlayOutputKind, ProPresenterStatus } from './ipc'

export interface PresenterConfirmationInput {
  reference: string
  successfulKinds: readonly OverlayOutputKind[]
  readStatus: () => ProPresenterStatus
  timeoutMs?: number
  pollMs?: number
  now?: () => number
  wait?: (ms: number) => Promise<void>
}

function comparable(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export async function confirmPresenterOutput(
  input: PresenterConfirmationInput,
): Promise<ConfirmationLevel> {
  if (!input.successfulKinds.includes('library')) return 'request-accepted'
  const now = input.now ?? Date.now
  const wait = input.wait ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const deadline = now() + (input.timeoutMs ?? 1_500)
  const expected = comparable(input.reference)

  do {
    const status = input.readStatus()
    if (status.state !== 'connected') return 'none'
    if (status.activePresentationName && comparable(status.activePresentationName).includes(expected)) {
      return 'active-document'
    }
    await wait(input.pollMs ?? 75)
  } while (now() < deadline)

  return 'request-accepted'
}
