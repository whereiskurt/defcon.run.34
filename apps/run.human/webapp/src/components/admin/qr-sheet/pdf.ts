/**
 * PDF sheet composition — dc33's /api/qr/sheet layout ported to run client
 * side. The QR renderer is INJECTED (RenderPng) so this module has no canvas
 * dependency and stays node-testable; the designer passes the styled
 * qr-code-styling renderer, tests pass a plain-qrcode stub.
 *
 * Deviation from dc33: QRs render at ~288 DPI (4 px/pt, capped 1200 px) and
 * are drawn scaled to their point size — dc33 rendered at 72 DPI which prints
 * soft. Layout coordinates are unchanged.
 */
import { PDFDocument, rgb, type PDFPage, type PDFImage } from "pdf-lib";

import {
  DPI,
  PAGE_WIDTH,
  PAGE_HEIGHT,
  cellOrigin,
  type SheetLayout,
} from "./templates";

/**
 * Injected renderer. `ecLevel` is only passed on the redundancy-comparison
 * proof page (to force L/M/Q/H); omitted everywhere else so the caller's own
 * auto/override choice applies.
 */
export type RenderPng = (
  url: string,
  sizePx: number,
  ecLevel?: "L" | "M" | "Q" | "H"
) => Promise<ArrayBuffer>;

const GREY = rgb(0.3, 0.3, 0.3);
const LIGHT_GREY = rgb(0.7, 0.7, 0.7);
const FAINT_GREY = rgb(0.6, 0.6, 0.6);
const MID_GREY = rgb(0.4, 0.4, 0.4);
const HEADER_Y = PAGE_HEIGHT - 30;

/** Print-resolution pixel size for a QR drawn at sizePt points. */
function pxFor(sizePt: number): number {
  return Math.min(1200, Math.max(64, Math.round(sizePt * 4)));
}

function drawHeader(page: PDFPage, text: string) {
  page.drawText(text, { x: 40, y: HEADER_Y, size: 10, color: GREY });
}

/** dc33's manual dotted fold lines between grid cells (grids only). */
function drawFoldLines(page: PDFPage, l: SheetLayout) {
  const dash = 3;
  const gap = 3;
  for (let i = 1; i < l.across; i++) {
    const x = l.startX + i * l.qrBox;
    const top = l.startY + l.qrBox;
    const bottom = l.startY - (l.down - 1) * l.qrBox;
    let y = top;
    while (y > bottom) {
      const end = Math.max(y - dash, bottom);
      page.drawLine({
        start: { x, y },
        end: { x, y: end },
        thickness: 0.5,
        color: LIGHT_GREY,
      });
      y = end - gap;
    }
  }
  for (let i = 1; i < l.down; i++) {
    const y = l.startY + l.qrBox - i * l.qrBox;
    const right = l.startX + l.across * l.qrBox;
    let x = l.startX;
    while (x < right) {
      const end = Math.min(x + dash, right);
      page.drawLine({
        start: { x, y },
        end: { x: end, y },
        thickness: 0.5,
        color: LIGHT_GREY,
      });
      x = end + gap;
    }
  }
}

/** Draw one QR image centered in cell (dx, dy) at qrPt points square. */
function drawQrInCell(
  page: PDFPage,
  l: SheetLayout,
  image: PDFImage,
  qrPt: number,
  dx: number,
  dy: number
): { x: number; y: number } {
  const o = cellOrigin(l, dx, dy);
  const x = o.x + (l.cellW - qrPt) / 2;
  const y = o.y + (l.cellH - qrPt) / 2;
  page.drawImage(image, { x, y, width: qrPt, height: qrPt });
  return { x, y };
}

/** dc33 page-3/4 size-comparison grid configs, verbatim. */
const COMPARISON_CONFIGS = [
  { across: 2, down: 2 }, { across: 2, down: 3 }, { across: 2, down: 4 },
  { across: 3, down: 3 }, { across: 3, down: 4 }, { across: 3, down: 5 },
  { across: 4, down: 5 }, { across: 4, down: 6 }, { across: 4, down: 7 },
  { across: 5, down: 6 }, { across: 5, down: 8 }, { across: 6, down: 8 },
  { across: 7, down: 8 }, { across: 8, down: 8 },
];

/**
 * Progressive data-density ladder. dc33 grew the URL only up to its OWN full
 * length — a short base like "https://q.defcon.run/" topped out at "+1" and
 * padded every remaining cell with the identical code, so nothing got denser.
 * Instead: cell 0 is the base URL, and every later cell APPENDS a growing
 * `?p=…` filler (the resolver's scan-param convention, so the codes stay
 * live), ramping ~TARGET_EXTRA total characters across the page regardless of
 * cell count — each step visibly bumps the QR version/density.
 */
const TARGET_EXTRA = 240;
const FILLER = "abcdefghijklmnopqrstuvwxyz0123456789";

export function buildProgressiveUrls(url: string, totalCells: number): string[] {
  if (totalCells <= 0) return [];
  const urls: string[] = [url];
  if (totalCells === 1) return urls;
  const sep = url.includes("?") ? "&" : "?";
  const step = Math.max(4, Math.ceil(TARGET_EXTRA / (totalCells - 1)));
  for (let i = 1; i < totalCells; i++) {
    const n = i * step;
    let pad = "";
    while (pad.length < n) pad += FILLER;
    urls.push(`${url}${sep}p=${pad.slice(0, n)}`);
  }
  return urls;
}

/** `qr-sheet-<slug>-<layout>-<WxH>in.pdf` — slug from q code or hostname. */
export function sheetFilename(url: string, layout: SheetLayout): string {
  let slug = "url";
  const codeMatch = url.match(/^https:\/\/q\.defcon\.run\/([A-Za-z0-9_-]+)/i);
  if (codeMatch) {
    slug = codeMatch[1].toLowerCase();
  } else {
    try {
      slug =
        new URL(url).hostname.toLowerCase().replace(/[^a-z0-9.-]/g, "") || "url";
    } catch {
      /* keep "url" */
    }
  }
  const dims =
    layout.kind === "avery"
      ? `${layout.widthIn}x${layout.heightIn}in`
      : `${layout.widthIn.toFixed(1)}x${layout.heightIn.toFixed(1)}in`;
  return `qr-sheet-${slug}-${layout.name}-${dims}.pdf`;
}

export async function buildSheetPdf(opts: {
  url: string;
  layout: SheetLayout;
  includeProofPages: boolean;
  renderPng: RenderPng;
}): Promise<Uint8Array> {
  const { url, layout: l, includeProofPages, renderPng } = opts;
  const doc = await PDFDocument.create();

  // ── Page 1: the sheet grid ─────────────────────────────────────────────
  const page1 = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  if (l.kind === "grid") drawFoldLines(page1, l);

  const qrPt = Math.floor(l.qrBox * 0.9);
  const cellPng = await renderPng(url, pxFor(qrPt));
  const cellImage = await doc.embedPng(cellPng);
  for (let dx = 0; dx < l.across; dx++) {
    for (let dy = 0; dy < l.down; dy++) {
      drawQrInCell(page1, l, cellImage, qrPt, dx, dy);
    }
  }
  drawHeader(page1, url);

  if (includeProofPages) {
    // ── Page 2: one giant QR ─────────────────────────────────────────────
    const page2 = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const giantPt = Math.min(PAGE_WIDTH, PAGE_HEIGHT) * 0.7;
    const giantImage = await doc.embedPng(await renderPng(url, pxFor(giantPt)));
    page2.drawImage(giantImage, {
      x: (PAGE_WIDTH - giantPt) / 2,
      y: (PAGE_HEIGHT - giantPt) / 2,
      width: giantPt,
      height: giantPt,
    });
    drawHeader(page2, url);

    // ── Pages 3(–4): size comparison, one QR per template config ─────────
    const margin = 40;
    const spacing = 15;
    const labelH = 12;
    let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawHeader(page, url);
    let cx = margin;
    let cy = PAGE_HEIGHT - margin;
    let rowMax = 0;
    let overflowed = false;

    for (const cfg of COMPARISON_CONFIGS) {
      const boxPt = Math.min(
        (PAGE_WIDTH - 40) / cfg.across,
        (PAGE_HEIGHT - 80) / cfg.down
      );
      const sizePt = Math.floor(boxPt * 0.9);
      const image = await doc.embedPng(await renderPng(url, pxFor(sizePt)));

      if (cx + sizePt > PAGE_WIDTH - margin) {
        cx = margin;
        cy = cy - rowMax - labelH - spacing;
        rowMax = 0;
      }
      if (cy - sizePt - labelH < margin) {
        if (overflowed) break; // no room even on page 4 - dc33 also stopped
        page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        drawHeader(page, url);
        cx = margin;
        cy = PAGE_HEIGHT - margin;
        rowMax = 0;
        overflowed = true;
      }
      page.drawImage(image, {
        x: cx,
        y: cy - sizePt,
        width: sizePt,
        height: sizePt,
      });
      const label = `${cfg.across}x${cfg.down}`;
      page.drawText(label, {
        x: cx + sizePt / 2 - (label.length * 7 * 0.4) / 2,
        y: cy - sizePt - 10,
        size: 7,
        color: GREY,
      });
      cx += sizePt + spacing;
      rowMax = Math.max(rowMax, sizePt);
    }

    // ── Redundancy (error-correction) comparison page ────────────────────
    // The same QR at all four EC levels, each at THIS sheet's cell size —
    // print it, damage/scan-test it, and pick the level that survives.
    const ecPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    ecPage.drawText("Error-Correction (Redundancy) Comparison", {
      x: 40,
      y: HEADER_Y,
      size: 12,
      color: GREY,
    });
    ecPage.drawText(`Base URL: ${url}`, {
      x: 40,
      y: HEADER_Y - 15,
      size: 8,
      color: rgb(0.5, 0.5, 0.5),
    });

    const EC_PAGE_LEVELS: { level: "L" | "M" | "Q" | "H"; pct: number }[] = [
      { level: "L", pct: 7 },
      { level: "M", pct: 15 },
      { level: "Q", pct: 25 },
      { level: "H", pct: 30 },
    ];
    // 2×2 of large samples (fixed quadrants; label INSIDE each quadrant so
    // nothing bleeds into the next row), then a separate bottom strip of
    // cell-size samples — one row, own vertical band, no overlap possible.
    const bigPt = 190;
    const bigCols = [75, 347];
    const bigRows = [PAGE_HEIGHT - 140 - bigPt, PAGE_HEIGHT - 140 - bigPt - (bigPt + 46)];
    const levelsThatFit = new Set<string>();
    for (let i = 0; i < EC_PAGE_LEVELS.length; i++) {
      const { level, pct } = EC_PAGE_LEVELS[i];
      const bx = bigCols[i % 2];
      const by = bigRows[Math.floor(i / 2)];
      try {
        const png = await renderPng(url, pxFor(bigPt), level);
        levelsThatFit.add(level);
        const big = await doc.embedPng(png);
        ecPage.drawImage(big, { x: bx, y: by, width: bigPt, height: bigPt });
        ecPage.drawText(`${level} - ${pct}% redundancy`, {
          x: bx,
          y: by - 13,
          size: 9,
          color: GREY,
        });
      } catch {
        ecPage.drawText(`${level} - ${pct}%: URL does not fit at this level`, {
          x: bx,
          y: by + bigPt / 2,
          size: 9,
          color: MID_GREY,
        });
      }
    }

    // Bottom strip: the four levels at (or near) this sheet's cell size.
    // Skipped when cells are big enough that the large samples already show it.
    if (qrPt <= 140) {
      const stripMax = (PAGE_WIDTH - 80 - 3 * 12) / 4; // 4-up with 12pt gaps
      const s = Math.min(qrPt, Math.floor(stripMax));
      const reduced = s < qrPt;
      const gap = (PAGE_WIDTH - 80 - 4 * s) / 3;
      const stripTitleY = 198;
      const stripTopY = 186;
      ecPage.drawText(
        reduced
          ? `At ${(s / DPI).toFixed(2)}" (near this sheet's ${(qrPt / DPI).toFixed(2)}" printed QR size, reduced to fit):`
          : `At this sheet's printed QR size (${(qrPt / DPI).toFixed(2)}"):`,
        { x: 40, y: stripTitleY, size: 9, color: GREY }
      );
      for (let i = 0; i < EC_PAGE_LEVELS.length; i++) {
        const { level } = EC_PAGE_LEVELS[i];
        if (!levelsThatFit.has(level)) continue; // big slot already says why
        const x = 40 + i * (s + gap);
        const y = stripTopY - s;
        // re-render at the strip size for crisp modules (no upscale blur)
        try {
          const small = await doc.embedPng(await renderPng(url, pxFor(s), level));
          ecPage.drawImage(small, { x, y, width: s, height: s });
          ecPage.drawText(level, {
            x: x + s / 2 - 3,
            y: y - 11,
            size: 8,
            color: GREY,
          });
        } catch {
          /* skip strip sample on failure */
        }
      }
    }
    ecPage.drawText(
      "Higher redundancy survives more damage/logo coverage but packs modules denser.",
      { x: 40, y: 28, size: 9, color: MID_GREY }
    );

    // ── Progressive data-density page ────────────────────────────────────
    const prog = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    prog.drawText("Progressive QR Data Density Test", {
      x: 40,
      y: HEADER_Y,
      size: 12,
      color: GREY,
    });
    prog.drawText(`Base URL: ${url}`, {
      x: 40,
      y: HEADER_Y - 15,
      size: 8,
      color: rgb(0.5, 0.5, 0.5),
    });

    // Own grid, NOT the sheet's edge-to-edge layout: dc33 reused the sheet
    // grid here, which ran under the header and the explanation text and left
    // no room for the +N labels. Cells stay at the sheet's QR size, but with
    // a label gutter per row and a reserved footer band.
    const progGapX = 16;
    const progGapY = 18; // label gutter under each QR
    const progLeft = 40;
    const progTop = 712; // below the header block
    const progBottom = 110; // above the explanation footer
    const progCols = Math.max(
      1,
      Math.floor((PAGE_WIDTH - 2 * progLeft + progGapX) / (qrPt + progGapX))
    );
    const progRows = Math.max(
      1,
      Math.floor((progTop - progBottom + progGapY) / (qrPt + progGapY))
    );

    const urls = buildProgressiveUrls(url, progCols * progRows);
    for (let i = 0; i < urls.length; i++) {
      const col = i % progCols;
      const row = Math.floor(i / progCols);
      const x = progLeft + col * (qrPt + progGapX);
      const y = progTop - row * (qrPt + progGapY) - qrPt;
      const u = urls[i];
      try {
        const image = await doc.embedPng(await renderPng(u, pxFor(qrPt)));
        prog.drawImage(image, { x, y, width: qrPt, height: qrPt });
        const extra = u.length - url.length;
        const label = extra === 0 ? "Base" : `+${extra}`;
        prog.drawText(label, {
          x: x + qrPt / 2 - label.length * 6 * 0.3,
          y: y - 11,
          size: 6,
          color: FAINT_GREY,
        });
      } catch {
        // an individual progressive step failing must not kill the sheet
      }
    }
    const ey = 46;
    prog.drawText(
      "This page tests QR code readability as data density increases.",
      { x: 40, y: ey + 30, size: 9, color: MID_GREY }
    );
    prog.drawText(
      "Each QR appends more ?p=… characters to the base URL - find where density stops scanning.",
      { x: 40, y: ey + 15, size: 9, color: MID_GREY }
    );
    prog.drawText(
      `QRs match the sheet's printed QR size: ${(qrPt / DPI).toFixed(2)}"`,
      { x: 40, y: ey, size: 9, color: MID_GREY }
    );
  }

  return doc.save();
}
