/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{html,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Grey text runs a step brighter than grey surfaces — see --fg-* in index.css.
      textColor: {
        slate: {
          200: 'rgb(var(--fg-200) / <alpha-value>)',
          300: 'rgb(var(--fg-300) / <alpha-value>)',
          400: 'rgb(var(--fg-400) / <alpha-value>)',
          500: 'rgb(var(--fg-500) / <alpha-value>)',
          600: 'rgb(var(--fg-600) / <alpha-value>)',
        },
        zinc: {
          200: 'rgb(var(--fg-200) / <alpha-value>)',
          300: 'rgb(var(--fg-300) / <alpha-value>)',
          400: 'rgb(var(--fg-400) / <alpha-value>)',
          500: 'rgb(var(--fg-500) / <alpha-value>)',
          600: 'rgb(var(--fg-600) / <alpha-value>)',
        },
        muted: { foreground: 'rgb(var(--fg-400) / <alpha-value>)' },
      },
      colors: {
        border: 'rgb(var(--surface-border) / <alpha-value>)',
        input: 'rgb(var(--surface-border) / <alpha-value>)',
        ring: 'rgb(var(--control-accent) / <alpha-value>)',
        background: 'rgb(var(--surface) / <alpha-value>)',
        foreground: 'rgb(var(--text-primary) / <alpha-value>)',
        primary: {
          DEFAULT: 'rgb(var(--control-accent) / <alpha-value>)',
          // Text on the accent: ink on white (dark theme), paper on ink (light).
          foreground: 'rgb(var(--on-accent) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'rgb(var(--surface-tertiary) / <alpha-value>)',
          foreground: 'rgb(var(--text-primary) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'rgb(var(--surface-secondary) / <alpha-value>)',
          foreground: 'rgb(var(--neutral-400) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--surface-tertiary) / <alpha-value>)',
          foreground: 'rgb(var(--text-primary) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'rgb(var(--surface-elevated) / <alpha-value>)',
          foreground: 'rgb(var(--text-primary) / <alpha-value>)',
        },
        card: {
          DEFAULT: 'rgb(var(--surface-secondary) / <alpha-value>)',
          foreground: 'rgb(var(--text-primary) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: '#ef4444',
          foreground: '#ffffff',
        },
        // Solid accent washes — what a 12% accent over the panel used to look
        // like, but opaque, per theme (see --tint-* in index.css).
        tint: {
          teal: 'rgb(var(--tint-teal) / <alpha-value>)',
          live: 'rgb(var(--tint-live) / <alpha-value>)',
          red: 'rgb(var(--tint-red) / <alpha-value>)',
          amber: 'rgb(var(--tint-amber) / <alpha-value>)',
          yellow: 'rgb(var(--tint-yellow) / <alpha-value>)',
          rose: 'rgb(var(--tint-rose) / <alpha-value>)',
        },
        // Brand palette: ink #11120D (primary), paper #FFFBF4 (white),
        // stone #565449 (muted); CTAs use the white accent, #6C91C2 is `live`. Surfaces and text
        // steps in index.css are blends of these.
        ink: '#11120D',
        paper: '#FFFBF4',
        stone: '#565449',
        white: '#FFFBF4',
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
          rail: 'rgb(var(--surface-rail) / <alpha-value>)',
          header: 'rgb(var(--surface-header) / <alpha-value>)',
          secondary: 'rgb(var(--surface-secondary) / <alpha-value>)',
          tertiary: 'rgb(var(--surface-tertiary) / <alpha-value>)',
          elevated: 'rgb(var(--surface-elevated) / <alpha-value>)',
          border: 'rgb(var(--surface-border) / <alpha-value>)',
        },
        // Legacy class name retained to avoid an app-wide class migration:
        // `teal-*` is the accent — white in dark, ink in light (index.css
        // --accent-*). Text on a solid accent fill is `text-on-accent`.
        teal: Object.fromEntries(
          [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((k) => [k, `rgb(var(--accent-${k}) / <alpha-value>)`]),
        ),
        // The old warm gold is retired: warnings and highlights that used
        // amber / yellow read in the palette's neutral accent instead.
        amber: Object.fromEntries(
          [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((k) => [k, `rgb(var(--accent-${k}) / <alpha-value>)`]),
        ),
        yellow: Object.fromEntries(
          [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((k) => [k, `rgb(var(--accent-${k}) / <alpha-value>)`]),
        ),
        'on-accent': 'rgb(var(--on-accent) / <alpha-value>)',
        // #6C91C2 — reserved for what is live / on screen.
        live: 'rgb(var(--live) / <alpha-value>)',
        // Existing components use slate extensively; neutralize its blue cast.
        slate: {
          50: 'rgb(var(--neutral-50) / <alpha-value>)',
          100: 'rgb(var(--neutral-100) / <alpha-value>)',
          200: 'rgb(var(--neutral-200) / <alpha-value>)',
          300: 'rgb(var(--neutral-300) / <alpha-value>)',
          400: 'rgb(var(--neutral-400) / <alpha-value>)',
          500: 'rgb(var(--neutral-500) / <alpha-value>)',
          600: 'rgb(var(--neutral-600) / <alpha-value>)',
          700: 'rgb(var(--neutral-700) / <alpha-value>)',
          800: 'rgb(var(--neutral-800) / <alpha-value>)',
          900: 'rgb(var(--neutral-900) / <alpha-value>)',
          950: 'rgb(var(--neutral-950) / <alpha-value>)',
        },
        zinc: {
          50: 'rgb(var(--neutral-50) / <alpha-value>)',
          100: 'rgb(var(--neutral-100) / <alpha-value>)',
          200: 'rgb(var(--neutral-200) / <alpha-value>)',
          300: 'rgb(var(--neutral-300) / <alpha-value>)',
          400: 'rgb(var(--neutral-400) / <alpha-value>)',
          500: 'rgb(var(--neutral-500) / <alpha-value>)',
          600: 'rgb(var(--neutral-600) / <alpha-value>)',
          700: 'rgb(var(--neutral-700) / <alpha-value>)',
          800: 'rgb(var(--neutral-800) / <alpha-value>)',
          900: 'rgb(var(--neutral-900) / <alpha-value>)',
          950: 'rgb(var(--neutral-950) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['Source Sans 3', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        narrow: ['Source Sans 3', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        serif: ['Source Sans 3', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['SF Mono', 'Menlo', 'Consolas', 'monospace'],
      },
      // A restrained radius scale for controls, rows and scripture cards.
      // Lyrics slide cards still opt into square corners in their view.
      borderRadius: {
        none: '0',
        sm: '4px',
        DEFAULT: '6px',
        md: '8px',
        lg: '10px',
        xl: '12px',
        '2xl': '16px',
        '3xl': '20px',
        '4xl': '24px',
      },
      fontSize: {
        xs: ['0.75rem', { lineHeight: '1rem' }],
        sm: ['0.8125rem', { lineHeight: '1.125rem' }],
        base: ['0.9375rem', { lineHeight: '1.375rem' }],
        lg: ['1.0625rem', { lineHeight: '1.5rem' }],
        xl: ['1.25rem', { lineHeight: '1.625rem' }],
        '2xl': ['1.5rem', { lineHeight: '1.875rem' }],
        '3xl': ['1.875rem', { lineHeight: '2.125rem' }],
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      // Flat UI: nothing floats. Depth comes from solid surface steps and
      // 1px borders, not drop shadows. (Focus rings are separate utilities.)
      boxShadow: {
        sm: 'none',
        DEFAULT: 'none',
        md: 'none',
        lg: 'none',
        xl: 'none',
        '2xl': 'none',
        inner: 'none',
        'glow-teal': 'none',
        'glow-red': 'none',
        'glow-yellow': 'none',
      },
      animation: {
        'fade-in': 'fadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in': 'slideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        'spring-in': 'springIn 0.2s cubic-bezier(0.2, 0, 0, 1)',
        'caret-blink': 'caretBlink 1.25s ease-out infinite',
      },
      keyframes: {
        // The fake caret in the OTP slots — the real input is off-screen.
        caretBlink: {
          '0%,70%,100%': { opacity: '1' },
          '20%,50%': { opacity: '0' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideIn: {
          '0%': { opacity: '0', transform: 'translateX(-12px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        springIn: {
          '0%': { opacity: '0', transform: 'scale(0.98) translateY(4px)' },
          '100%': { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
