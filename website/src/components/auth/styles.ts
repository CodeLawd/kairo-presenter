/**
 * Class recipes for the auth forms.
 * Aligned with the MindCloud-inspired design system: crisp 10px radii,
 * electric royal blue (#1655F8) focus rings and primary actions.
 */

export const field = 'block'

export const label = 'mb-2 block text-[13.5px] font-medium text-dim'

export const input =
  'w-full rounded-[10px] border border-line bg-panel px-4 py-3 text-[15px] in-data-[dash-theme=light]:border-[#E2E5EC] in-data-[dash-theme=light]:bg-[#FAFAFC] text-paper transition-[border-color,box-shadow,background-color] placeholder:text-faint hover:bg-panel-2 in-data-[dash-theme=light]:hover:bg-white focus:border-[#1655F8] focus:bg-panel in-data-[dash-theme=light]:focus:bg-white focus:outline-none focus:ring-3 focus:ring-[#1655F8]/20 disabled:opacity-50'

/** The device-pairing code: wide tracking, centred, monospaced. */
export const codeInput = `${input} text-center font-mono text-[20px] uppercase tracking-[0.18em]`

const btnBase =
  'inline-flex min-h-11 w-full items-center justify-center gap-[9px] rounded-[10px] border px-5 py-3 text-[15px] font-medium transition-[background-color,border-color,transform,opacity] duration-180 hover:-translate-y-px active:translate-y-0 motion-reduce:transform-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:h-[15px] [&_svg]:w-[15px] [&_svg]:flex-none'

export const btnPrimary = `${btnBase} border-transparent bg-[#1655F8] text-white hover:bg-[#1148D8] disabled:hover:translate-y-0 disabled:hover:bg-[#1655F8]`
export const btnSecondary = `${btnBase} border-line bg-panel text-paper hover:bg-panel-2 in-data-[dash-theme=light]:border-[#E2E5EC] in-data-[dash-theme=light]:bg-white in-data-[dash-theme=light]:hover:bg-[#F8F9FB]`

/** Inline text button — "Forgot password", "Create one instead". */
export const linkBtn =
  'text-[13.5px] text-mute underline-offset-2 transition-colors hover:text-[#1655F8] hover:underline focus-visible:text-[#1655F8] disabled:opacity-50'

/** Form status line. Rendered only when there is something to say. */
export const msg = 'm-0 text-[13.5px] leading-relaxed'
export const msgError = 'text-destructive'
export const msgOk = 'text-[#1655F8]'
