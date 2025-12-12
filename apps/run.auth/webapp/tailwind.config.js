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
        inter: ['var(--font-inter)', 'Inter', 'sans-serif'],
      },
      colors: {
      },
      keyframes: {
        'glitch-1': {
          '0%, 100%': { transform: 'translate(0)' },
          '20%': { transform: 'translate(-2px, 1px)' },
          '40%': { transform: 'translate(-1px, -1px)' },
          '60%': { transform: 'translate(1px, 2px)' },
          '80%': { transform: 'translate(1px, -1px)' },
        },
        'glitch-2': {
          '0%, 100%': { transform: 'translate(0)' },
          '25%': { transform: 'translate(2px, 0)' },
          '50%': { transform: 'translate(-3px, 1px)' },
          '75%': { transform: 'translate(1px, -2px)' },
        },
        'blurPulse': {
          '0%, 100%': { filter: 'blur(2px)' },
          '50%': { filter: 'blur(8px)' },
        },
      },
      animation: {
        'glitch-1': 'glitch-1 0.8s infinite ease-in-out',
        'glitch-2': 'glitch-2 0.8s infinite ease-in-out',
        'blurPulse': 'blurPulse 5s infinite ease-in-out',
      },
    },
  },
  darkMode: 'class',
  plugins: [heroui()],
  safelist: [
    'font-inter',
    'text-red-500',
    'text-orange-500',
    'text-yellow-500',
    'text-green-500',
    'text-blue-500',
    'text-indigo-500',
    'text-purple-500',
    'animate-glitch-1',
    'animate-glitch-2',
    'animate-blurPulse',
    'bg-button-dashboard-bg',
    'hover:bg-button-dashboard-hover',
    'text-button-dashboard-text',
  ],
};
