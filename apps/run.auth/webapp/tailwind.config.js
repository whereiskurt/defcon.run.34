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
        'gradient-shift': {
          '0%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
          '100%': { backgroundPosition: '0% 50%' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.4s ease-out forwards',
        'fade-in': 'fade-in 0.3s ease-out forwards',
        'slide-up': 'slide-up 0.5s ease-out forwards',
        'glow-pulse': 'glow-pulse 3s ease-in-out infinite',
        'gradient-shift': 'gradient-shift 8s ease infinite',
        shimmer: 'shimmer 2s linear infinite',
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
            default: {
              50: '#111118',
              100: '#1a1a24',
              200: '#222230',
              300: '#2a2a3a',
              400: '#555570',
              500: '#8888a0',
              600: '#9999b0',
              700: '#aaaac0',
              800: '#ccccdd',
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
          },
        },
      },
    }),
  ],
};
