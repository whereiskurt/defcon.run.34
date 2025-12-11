import { Fira_Code as FontMono, Inter as FontSans, MuseoModerno as FontMuseo, Atkinson_Hyperlegible as FontAtkinson,Lato as FontLato } from "next/font/google";

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
  weight: "400",
});

export const fontAtkinson = FontAtkinson({
  subsets: ["latin"],
  weight: "400",
});

export const fontLato = FontLato({
  subsets: ["latin"],
  weight: "400",
});