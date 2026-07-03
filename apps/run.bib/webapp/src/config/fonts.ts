/**
 * Web fonts for run.bib — ported from run.human (v1.6). Exposed as CSS vars
 * and wired into tailwind.config.js fontFamily. MuseoModerno is the brand
 * wordmark font (`defcon.run`); Inter is the body sans; Fira Code the mono.
 */
import {
  Fira_Code as FontMono,
  Inter as FontSans,
  MuseoModerno as FontMuseo,
  Atkinson_Hyperlegible as FontAtkinson,
} from "next/font/google";

export const fontSans = FontSans({
  subsets: ["latin"],
  variable: "--font-sans",
});

export const fontMono = FontMono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const fontMuseo = FontMuseo({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-museo",
});

export const fontAtkinson = FontAtkinson({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-atkinson",
});
