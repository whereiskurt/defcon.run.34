import type { Config } from "tailwindcss";

/**
 * Minimal Tailwind 4 config for run.bib.
 * Tailwind 4 mostly auto-detects sources, but keeping an explicit content array
 * matches the run.flash pattern for parity.
 */
const config: Config = {
  content: [
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
};

export default config;
