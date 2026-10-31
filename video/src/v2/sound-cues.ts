import type { MusicPass, Sfx } from './Soundtrack'

/**
 * Sound cues for each film, in film seconds, taken from the picture's own
 * beats. The music is Mixkit #32 (see CREDITS.md); its lift at 37.66 s is
 * placed on the send in every film.
 */

const LIFT = 37.66

const typing = (at: number, chars: number, perChar: number, gain = 0.16): Sfx[] =>
  Array.from({ length: chars }, (_, k) => ({ at: at + k * perChar, name: 'key' as const, gain: gain * (0.8 + ((k * 7) % 5) * 0.06) }))
const words = (at: number, n: number, over: number, gain = 0.07): Sfx[] => Array.from({ length: n }, (_, k) => ({ at: at + (k * over) / n, name: 'tick' as const, gain }))

/** The one-take's cues relative to its own start (24 s in the hero). */
const oneTake = (o: number, until = 31): Sfx[] =>
  [
    { at: 0, name: 'rise', gain: 0.18 },
    ...words(6.6, 13, 3.0),
    { at: 9.8, name: 'shimmer', gain: 0.2 },
    { at: 10.7, name: 'pop', gain: 0.1 },
    { at: 11.4, name: 'whoosh', gain: 0.2 },
    { at: 13.6, name: 'shimmer', gain: 0.18 },
    { at: 15.6, name: 'whoosh', gain: 0.22 },
    { at: 17.55, name: 'pop', gain: 0.2 },
    { at: 24.3, name: 'click', gain: 0.4 },
    { at: 24.36, name: 'swell', gain: 0.55 },
    { at: 27.0, name: 'rise', gain: 0.28 },
  ]
    .filter((e) => e.at < until)
    .map((e) => ({ ...e, at: e.at + o }) as Sfx)

const SEND_HERO = 24 + 24.3

export const HERO_SOUND: { music: MusicPass[]; sfx: Sfx[] } = {
  music: [{ at: 18, from: LIFT - (SEND_HERO + 0.1 - 18), until: 92, fadeIn: 0.8, fadeOut: 2.5, base: 0.5, ducked: 0.26, dips: [[SEND_HERO - 0.9, SEND_HERO + 0.05, 0.08]] }],
  sfx: [
    { at: 7.95, name: 'whoosh', gain: 0.22 },
    ...typing(9.7, 6, 0.08),
    ...typing(12.0, 9, 0.08),
    ...typing(13.9, 18, 0.08, 0.13),
    ...typing(15.5, 9, 0.08),
    { at: 18.0, name: 'rise', gain: 0.32 },
    { at: 21.95, name: 'impact', gain: 0.45 },
    ...oneTake(24),
    { at: 55.0, name: 'whoosh', gain: 0.18 },
    ...[61.6, 63.8, 67.3, 71.2].map((at) => ({ at, name: 'whoosh' as const, gain: 0.12 })),
    ...[56.1, 56.55, 57.0].map((at) => ({ at, name: 'pop' as const, gain: 0.08 })),
    { at: 71.2 + 2.5, name: 'tick', gain: 0.14 },
    { at: 79.6, name: 'click', gain: 0.38 },
    { at: 79.65, name: 'swell', gain: 0.32 },
    { at: 84.0, name: 'rise', gain: 0.22 },
    { at: 84.5, name: 'impact', gain: 0.45 },
  ],
}

const SEND_WALK = 105 + 49.5 + 1.9

export const WALK_SOUND: { music: MusicPass[]; sfx: Sfx[] } = {
  music: [
    { at: 0, from: 0, until: 98.5, fadeIn: 1.5, fadeOut: 3, base: 0.3, ducked: 0.15 },
    { at: SEND_WALK - LIFT, from: 0, until: 210, fadeIn: 3, fadeOut: 3, base: 0.32, ducked: 0.16, dips: [[SEND_WALK - 0.9, SEND_WALK + 0.05, 0.06]] },
  ],
  sfx: [
    ...[0, 35, 75, 105, 160, 195].map((at) => ({ at, name: 'whoosh' as const, gain: 0.14 })),
    ...oneTake(105, 22.6),
    { at: 105 + 38.8 + 1.2, name: 'pop', gain: 0.12 },
    { at: SEND_WALK, name: 'click', gain: 0.38 },
    { at: SEND_WALK + 0.05, name: 'swell', gain: 0.45 },
    { at: 160 + 1.6 + 0.5, name: 'key', gain: 0.12 },
    ...typing(160 + 1.6 + 0.5, 12, 0.075, 0.12),
    { at: 178 + 2.4, name: 'pop', gain: 0.1 },
    { at: 160 + 26.5 + 1.5, name: 'click', gain: 0.32 },
    { at: 195.5, name: 'impact', gain: 0.4 },
  ],
}

const SEND_SOCIAL = 6.4 + 7.6 + 1.3

export const SOCIAL_SOUND: { music: MusicPass[]; sfx: Sfx[] } = {
  music: [{ at: 0, from: LIFT - SEND_SOCIAL - 0.1, until: 24, fadeIn: 0.4, fadeOut: 1.2, base: 0.45, ducked: 0.26, dips: [[SEND_SOCIAL - 0.7, SEND_SOCIAL + 0.05, 0.08]] }],
  sfx: [
    ...typing(3.9, 6, 0.1),
    { at: 6.4, name: 'whoosh', gain: 0.18 },
    ...words(6.8, 13, 1.8),
    { at: 6.4 + 2.3, name: 'shimmer', gain: 0.2 },
    { at: 6.4 + 3.9, name: 'pop', gain: 0.16 },
    { at: SEND_SOCIAL, name: 'click', gain: 0.4 },
    { at: SEND_SOCIAL + 0.05, name: 'swell', gain: 0.5 },
    { at: 18.5, name: 'rise', gain: 0.28 },
    { at: 18.5 + 1.8, name: 'impact', gain: 0.45 },
  ],
}
