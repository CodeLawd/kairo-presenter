/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{html,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'rgb(var(--surface-border) / <alpha-value>)',
        input: 'rgb(var(--surface-border) / <alpha-value>)',
        ring: 'rgb(var(--control-accent) / <alpha-value>)',
        background: 'rgb(var(--surface) / <alpha-value>)',
        foreground: 'rgb(var(--text-primary) / <alpha-value>)',
        primary: {
          DEFAULT: 'rgb(var(--control-accent) / <alpha-value>)',
          foreground: '#ffffff',
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
          red: 'rgb(var(--tint-red) / <alpha-value>)',
          amber: 'rgb(var(--tint-amber) / <alpha-value>)',
          yellow: 'rgb(var(--tint-yellow) / <alpha-value>)',
          rose: 'rgb(var(--tint-rose) / <alpha-value>)',
        },
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
          secondary: 'rgb(var(--surface-secondary) / <alpha-value>)',
          tertiary: 'rgb(var(--surface-tertiary) / <alpha-value>)',
          elevated: 'rgb(var(--surface-elevated) / <alpha-value>)',
          border: 'rgb(var(--surface-border) / <alpha-value>)',
        },
        // Legacy class name retained to avoid a risky app-wide class migration.
        // Product accent is Kairo amber (#F59E0B), not a status color.
        teal: {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
          950: '#451a03',
        },
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
