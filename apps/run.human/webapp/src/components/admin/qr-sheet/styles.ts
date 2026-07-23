/**
 * QR visual style model + DC34 presets for the sheet designer. Pure data —
 * shape values are OUR vocabulary; render.ts maps them onto qr-code-styling's
 * type names. Preset palette hexes come from the Run Hacker Run interstitial
 * (infra cloudfront-redirect assets): dark teal #12836f, deep magenta #8f1857.
 */

export type ModuleShape = "square" | "dots" | "rounded" | "classy";
export type EyeShape = "square" | "rounded" | "dot";

export type QrStyle = {
  moduleShape: ModuleShape;
  moduleColor: string;
  background: string;
  eyeShape: EyeShape;
  eyeColor: string;
  /** App-relative path (bundled) or data URL (upload). Absent = no logo. */
  logo?: string;
};

/** Center logo caps at 22% of QR width — keeps codes scannable at EC ≥ Q. */
export const LOGO_SIZE_RATIO = 0.22;

/**
 * DC34 brand swatches for the module/eye color pickers (the native color
 * input stays for anything custom). Teal/mint/magentas from the Run Hacker
 * Run interstitial; ink from the runner QR card. Light colors (mint, neon
 * magenta) are offered deliberately — the contrast warning flags them when
 * they'd hurt scanning.
 */
export const DC34_PALETTE = [
  { name: "Black", hex: "#000000" },
  { name: "Ink", hex: "#111118" },
  { name: "Teal", hex: "#12836f" },
  { name: "Mint", hex: "#2fe3c6" },
  { name: "Magenta", hex: "#8f1857" },
  { name: "Neon Magenta", hex: "#ff2e97" },
] as const;

export const BUNDLED_LOGOS = [
  { id: "dcjack", label: "DC Jack", path: "/qr-logos/dcjack.svg" },
  { id: "mesh", label: "Meshtastic", path: "/qr-logos/meshtastic.svg" },
  { id: "dc34", label: "DC34", path: "/qr-logos/dc34.png" },
] as const;

export const DC34_PRESETS: { id: string; label: string; style: QrStyle }[] = [
  {
    id: "classic",
    label: "Classic",
    style: {
      moduleShape: "square",
      moduleColor: "#000000",
      background: "#ffffff",
      eyeShape: "square",
      eyeColor: "#000000",
    },
  },
  {
    id: "run-hacker-run",
    label: "Run Hacker Run",
    style: {
      moduleShape: "rounded",
      moduleColor: "#12836f",
      background: "#ffffff",
      eyeShape: "rounded",
      eyeColor: "#8f1857",
      logo: "/qr-logos/dc34.png",
    },
  },
  {
    id: "mesh",
    label: "Mesh",
    style: {
      moduleShape: "dots",
      moduleColor: "#000000",
      background: "#ffffff",
      eyeShape: "rounded",
      eyeColor: "#12836f",
      logo: "/qr-logos/meshtastic.svg",
    },
  },
  {
    id: "stealth",
    label: "Stealth",
    style: {
      moduleShape: "classy",
      moduleColor: "#111827",
      background: "#ffffff",
      eyeShape: "square",
      eyeColor: "#111827",
      logo: "/qr-logos/dcjack.svg",
    },
  },
];

/** WCAG relative luminance of a #rrggbb (or #rgb) hex, 0 (black) – 1 (white). */
export function relativeLuminance(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Non-blocking scannability heuristic: scanners want DARK marks on a LIGHT
 * background. Warn when the background isn't clearly lighter than both the
 * modules and the eyes (luminance gap < 0.45) — covers light-on-light AND
 * inverted schemes. 0.45 catches bright accents like mint teal #2fe3c6
 * (gap ≈ 0.40) while every dark-on-white preset sits at ≥ 0.8.
 */
export function contrastWarning(style: QrStyle): string | null {
  const bg = relativeLuminance(style.background);
  const gapModules = bg - relativeLuminance(style.moduleColor);
  const gapEyes = bg - relativeLuminance(style.eyeColor);
  if (gapModules < 0.45 || gapEyes < 0.45) {
    return "Low contrast: scanners want dark modules and eyes on a light background - this combination may not scan reliably.";
  }
  return null;
}
