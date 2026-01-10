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
    },
  },
  darkMode: 'class',
  plugins: [heroui()],
  safelist: [
    'font-inter',
    'bg-button-dashboard-bg',
    'hover:bg-button-dashboard-hover',
    'text-button-dashboard-text',
  ],
};
