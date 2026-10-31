import { loadFont as loadManrope } from '@remotion/google-fonts/Manrope'
import { loadFont as loadSourceSans } from '@remotion/google-fonts/SourceSans3'
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono'

const latin = { subsets: ['latin' as const] }

/** Film headlines. */
export const display = loadManrope('normal', { weights: ['500', '600', '700', '800'], ...latin }).fontFamily
/** The app's own UI face (measured from the running app). */
export const ui = loadSourceSans('normal', { weights: ['400', '500', '600', '700'], ...latin }).fontFamily
/** References and clocks. */
export const mono = loadMono('normal', { weights: ['400', '500'], ...latin }).fontFamily
/** The church theme's slide face (the captured theme renders in Helvetica/Arial bold). */
export const slideFace = 'Helvetica Neue, Helvetica, Arial, sans-serif'
