/** Shared by app quit and the main-window close path on every platform. */
export function createQuitConfirmation(prompt: () => void) {
  let allowed = false
  let prompting = false
  return {
    confirm(): boolean {
      if (allowed) return true
      if (!prompting) {
        prompting = true
        prompt()
      }
      return false
    },
    pending(): boolean { return prompting },
    respond(confirmed: boolean): boolean {
      if (!prompting) return false
      prompting = false
      allowed = confirmed
      return allowed
    },
    allow(): void { allowed = true; prompting = false },
  }
}
