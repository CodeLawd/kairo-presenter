/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { ipcRenderer } from 'electron'
import { pendingQueueButton, readSlidoPage, SLIDO_SELECTORS } from '../main/services/audience/sources/slido-selectors'

// An isolated sandbox preload. Exposes no API or IPC bridge to the remote page.
const code = process.argv.find(value => value.startsWith('--audience-slido-code='))?.split('=')[1] || ''
const moderator = process.argv.includes('--audience-slido-moderator')
window.addEventListener('DOMContentLoaded', () => {
  let joined = false
  let pendingOpened = false
  const read = (): void => {
    const participant = location.hostname === 'app.sli.do'
    if (participant && !location.pathname.startsWith('/event/') && !joined && /^[a-zA-Z0-9-]{1,32}$/.test(code)) {
      const input = document.querySelector<HTMLInputElement>(SLIDO_SELECTORS.joinInput)
      const button = document.querySelector<HTMLButtonElement>(SLIDO_SELECTORS.joinButton)
      if (input && button && !button.disabled && input.value !== code) {
        // Only submit the event-code search. Never address ask, vote or moderation buttons.
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(input, code)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
      } else if (input?.value === code && button && !button.disabled) {
        button.click()
        joined = true
      }
    }
    // The join page reports a wrong code; the event page reports its name.
    if (participant) {
      const page = readSlidoPage(document, location, 'public')
      if (!moderator || page.notFound || page.eventName) ipcRenderer.send('audience:slido:read', moderator ? { ...page, questions: [], empty: false } : page)
      if (!moderator) return
    }
    if (location.hostname !== 'admin.sli.do') return
    // Send a heartbeat even when content is unchanged, so selector failure after
    // a successful parse is detected too. Main deduplicates the queue updates.
    ipcRenderer.send('audience:slido:read', readSlidoPage(document, location, 'moderator'))
    // Read the current live cards before opening the pending view.
    if (moderator && !pendingOpened) {
      const pending = pendingQueueButton(document)
      if (pending) { pending.click(); pendingOpened = true }
    }
  }
  read()
  const timer = setInterval(read, 1000)
  window.addEventListener('unload', () => clearInterval(timer), { once: true })
})
