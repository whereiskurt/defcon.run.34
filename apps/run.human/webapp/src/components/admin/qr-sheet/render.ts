/**
 * Styled QR rendering for the sheet designer. Browser-only at the PNG layer
 * (qr-code-styling draws on canvas; dynamically imported so this module can
 * still be IMPORTED server-side / in tests for pickEcLevel).
 *
 * Error-correction: dc33's adaptive ladder H→Q→M→L, probed with the plain
 * `qrcode` lib (sync, node-safe). A center logo floors the ladder at Q — the
 * logo obscures modules, so we refuse to degrade below 25% recovery.
 */
import * as qrLib from "qrcode";

import { apiBase } from "@/components/admin/qr-ui";
import { LOGO_SIZE_RATIO, type QrStyle } from "./styles";

/**
 * Resolve a logo source for fetching. Bundled logos are stored app-relative
 * ("/qr-logos/x.svg") but prod mounts the app under a region basePath
 * ("/use1") — Next rewrites <img>/link hrefs but NOT runtime fetches like
 * qr-code-styling's image loader, so prefix explicitly. Data URLs pass through.
 */
export function resolveLogoSrc(logo: string): string {
  return logo.startsWith("/") ? `${apiBase()}${logo}` : logo;
}

const EC_LADDER = ["H", "Q", "M", "L"] as const;
export type EcLevel = (typeof EC_LADDER)[number];
export type EcChoice = EcLevel | "auto";

/** Redundancy (damage budget) per level, for UI labels and proof pages. */
export const EC_INFO: { level: EcLevel; pct: number }[] = [
  { level: "L", pct: 7 },
  { level: "M", pct: 15 },
  { level: "Q", pct: 25 },
  { level: "H", pct: 30 },
];

export function pickEcLevel(url: string, hasLogo: boolean): EcLevel {
  const ladder = hasLogo ? EC_LADDER.slice(0, 2) : EC_LADDER;
  for (const level of ladder) {
    try {
      qrLib.create(url, { errorCorrectionLevel: level });
      return level;
    } catch {
      // too much data for this level — try the next one
    }
  }
  throw new Error(
    hasLogo
      ? "URL too long for a QR code with a logo — shorten the URL or remove the logo."
      : "URL too long for a QR code."
  );
}

/**
 * Effective level for a choice: "auto" runs the adaptive ladder; an explicit
 * level is validated for capacity (throws if the URL doesn't fit at it).
 * Explicit levels are taken verbatim — even below the logo's Q floor — so
 * proof pages can demonstrate what a too-low level looks like; the designer
 * UI is responsible for disabling L/M chips while a logo is set.
 */
export function effectiveEcLevel(
  url: string,
  hasLogo: boolean,
  choice: EcChoice = "auto"
): EcLevel {
  if (choice === "auto") return pickEcLevel(url, hasLogo);
  try {
    qrLib.create(url, { errorCorrectionLevel: choice });
  } catch {
    throw new Error(
      `URL too long for a QR code at level ${choice} — pick a lower redundancy level or shorten the URL.`
    );
  }
  return choice;
}

// qr-code-styling's type names for our style vocabulary.
const MODULE_TYPE = {
  square: "square",
  dots: "dots",
  rounded: "rounded",
  classy: "classy",
} as const;
const EYE_FRAME_TYPE = {
  square: "square",
  rounded: "extra-rounded",
  dot: "dot",
} as const;
const EYE_BALL_TYPE = { square: "square", rounded: "dot", dot: "dot" } as const;

/**
 * qr-code-styling HANGS (promise never settles) when its image URL fails to
 * load — the internal loader has no onerror path. Pre-flight the logo
 * ourselves so a broken image REJECTS promptly and callers' drop-the-logo
 * fallbacks actually run instead of freezing the preview.
 */
function preloadLogo(src: string, timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve(false), timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      resolve(true);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
    img.src = src;
  });
}

/**
 * Render one styled QR as a PNG ArrayBuffer at sizePx × sizePx. Browser only.
 * `ec` defaults to the adaptive ladder; pass a level to force it (used by the
 * manual override and the redundancy-comparison proof page).
 */
export async function renderQrPng(
  url: string,
  style: QrStyle,
  sizePx: number,
  ec: EcChoice = "auto"
): Promise<ArrayBuffer> {
  const { default: QRCodeStyling } = await import("qr-code-styling");
  const level = effectiveEcLevel(url, Boolean(style.logo), ec);

  if (style.logo && !(await preloadLogo(resolveLogoSrc(style.logo)))) {
    throw new Error("Logo image failed to load.");
  }

  const qr = new QRCodeStyling({
    width: sizePx,
    height: sizePx,
    type: "canvas",
    data: url,
    margin: 0,
    qrOptions: { errorCorrectionLevel: level },
    dotsOptions: {
      type: MODULE_TYPE[style.moduleShape],
      color: style.moduleColor,
    },
    cornersSquareOptions: {
      type: EYE_FRAME_TYPE[style.eyeShape],
      color: style.eyeColor,
    },
    cornersDotOptions: {
      type: EYE_BALL_TYPE[style.eyeShape],
      color: style.eyeColor,
    },
    backgroundOptions: { color: style.background },
    ...(style.logo
      ? {
          image: resolveLogoSrc(style.logo),
          imageOptions: {
            imageSize: LOGO_SIZE_RATIO,
            margin: Math.max(2, Math.round(sizePx / 100)),
            hideBackgroundDots: true,
            crossOrigin: "anonymous",
          },
        }
      : {}),
  });

  const blob = (await qr.getRawData("png")) as Blob | null;
  if (!blob) throw new Error("QR rendering produced no image data.");
  return blob.arrayBuffer();
}
