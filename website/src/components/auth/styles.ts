/**
 * Class recipes for the auth forms.
 *
 * Same idiom as the landing page's primitives: exported strings rather than CSS
 * classes, so there is one styling language across the whole site and Tailwind
 * can see every utility it needs to emit.
 */

export const field = 'block'

export const label = 'mb-1.5 block text-[13px] font-medium text-dim'

export const input =
  'w-full rounded-[10px] border border-paper/15 bg-panel px-3.5 py-2.5 text-[14.5px] text-paper transition-[border-color,box-shadow] placeholder:text-faint focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/20 disabled:opacity-50'

/** The device-pairing code: wide tracking, centred, monospaced. */
export const codeInput = `${input} text-center font-mono text-[20px] uppercase tracking-[0.18em]`

const btnBase =
  'inline-flex w-full items-center justify-center gap-[9px] rounded-[10px] border px-5 py-[11px] text-[14.5px] font-medium transition duration-200 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:h-[15px] [&_svg]:w-[15px] [&_svg]:flex-none'

export const btnPrimary = `${btnBase} border-transparent bg-paper text-ink hover:bg-paper/85 disabled:hover:bg-paper`
export const btnSecondary = `${btnBase} border-paper/15 bg-panel text-paper hover:bg-panel-2`

/** Inline text button — "Forgot password", "Create one instead". */
export const linkBtn =
  'text-[13px] text-mute underline-offset-2 transition-colors hover:text-paper hover:underline focus-visible:text-paper disabled:opacity-50'

/** Form status line. Rendered only when there is something to say. */
export const msg = 'm-0 text-[13px] leading-relaxed'
export const msgError = 'text-destructive'
export const msgOk = 'text-accent'
