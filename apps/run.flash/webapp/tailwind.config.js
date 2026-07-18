import { heroui } from '@heroui/theme';

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
        museo: ['var(--font-museo)'],
        atkinson: ['var(--font-atkinson)'],
      },
      colors: {
        surface: {
          DEFAULT: '#111118',
          raised: '#1a1a24',
        },
        border: {
          subtle: '#2a2a3a',
        },
        'glow-primary': '#00d4aa20',
        'matrix-green': '#00ff41',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(24px)', filter: 'blur(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)', filter: 'blur(0)' },
        },
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 20px #00d4aa15' },
          '50%': { boxShadow: '0 0 40px #00d4aa25' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.4s ease-out forwards',
        'fade-in': 'fade-in 0.3s ease-out forwards',
        'slide-up': 'slide-up 0.5s ease-out forwards',
        'glow-pulse': 'glow-pulse 3s ease-in-out infinite',
      },
    },
  },
  darkMode: 'class',
  plugins: [
    heroui({
      themes: {
        dark: {
          colors: {
            background: '#0a0a0f',
            foreground: '#e4e4ef',
            primary: {
              50: '#e6fff8',
              100: '#b3ffe9',
              200: '#80ffda',
              300: '#4dffcb',
              400: '#1affbc',
              500: '#00d4aa',
              600: '#00a888',
              700: '#007d66',
              800: '#005244',
              900: '#002922',
              DEFAULT: '#00d4aa',
              foreground: '#0a0a0f',
            },
            secondary: {
              DEFAULT: '#f59e0b',
              foreground: '#0a0a0f',
            },
            success: {
              DEFAULT: '#22c55e',
              foreground: '#0a0a0f',
            },
            danger: {
              DEFAULT: '#ef4444',
              foreground: '#ffffff',
            },
            warning: {
              DEFAULT: '#f59e0b',
              foreground: '#0a0a0f',
            },
            content1: '#111118',
            content2: '#1a1a24',
            content3: '#222230',
            content4: '#2a2a3a',
            divider: '#2a2a3a',
            // Inverted ramp (low = dark surface, high = light text). 400–700
            // lifted so muted body text clears WCAG AA (4.5:1) on the near-black
            // background — the old 400 (#555570) was ~2.7:1 and unreadable.
            default: {
              50: '#111118',
              100: '#1a1a24',
              200: '#222230',
              300: '#2a2a3a',
              400: '#7e7e98',
              500: '#9090a8',
              600: '#a6a6bc',
              700: '#bcbcce',
              800: '#d0d0de',
              900: '#e4e4ef',
              DEFAULT: '#2a2a3a',
              foreground: '#e4e4ef',
            },
          },
        },
        light: {
          colors: {
            background: '#fafafa',
            foreground: '#18181b',
            primary: {
              DEFAULT: '#00a888',
              foreground: '#ffffff',
            },
            secondary: {
              DEFAULT: '#d97706',
              foreground: '#ffffff',
            },
            content1: '#ffffff',
            content2: '#f5f5f5',
            content3: '#eeeeee',
            content4: '#e0e0e0',
            divider: '#e0e0e0',
            // Normal ramp (low = light surface, high = dark text). 400/500 are
            // darkened from HeroUI's stock light scale so the same muted-text
            // classes used in dark mode also clear AA on the white background.
            default: {
              50: '#fafafa',
              100: '#f4f4f5',
              200: '#e4e4e7',
              300: '#d4d4d8',
              400: '#6b6b76',
              500: '#52525b',
              600: '#3f3f46',
              700: '#2e2e33',
              800: '#1f1f24',
              900: '#111114',
              DEFAULT: '#d4d4d8',
              foreground: '#18181b',
            },
          },
        },
      },
    }),
  ],
};
