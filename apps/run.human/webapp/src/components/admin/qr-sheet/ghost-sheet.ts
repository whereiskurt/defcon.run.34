/**
 * Ghost OTP sheet composition (Phase 67) — the roster's printable companion.
 * Reuses the QR-sheet layout math (templates.ts) and the injected-renderer
 * seam (RenderPng from pdf.ts) but differs from buildSheetPdf in kind: that
 * sheet repeats ONE url across every cell; this one draws a DIFFERENT QR per
 * cell (one per ghost, the derived `otpauth://` seed) with a label band under
 * each QR. Entries overflowing the grid chunk onto additional pages.
 *
 * SENSITIVE OUTPUT: every QR on the sheet IS a live authenticator seed — the
 * header says so. Callers must only feed this from the admin-gated
 * ghost_otp_reveal path.
 */
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

import { cellOrigin, DPI, PAGE_HEIGHT, PAGE_WIDTH, type SheetLayout } from "./templates";
import type { RenderPng } from "./pdf";

const GREY = rgb(0.3, 0.3, 0.3);
const LIGHT_GREY = rgb(0.7, 0.7, 0.7);
const MID_GREY = rgb(0.4, 0.4, 0.4);
const RED = rgb(0.75, 0.1, 0.1);
const HEADER_Y = PAGE_HEIGHT - 30;

export interface GhostSheetEntry {
  /** The derived `otpauth://` URL — the QR payload. */
  url: string;
  /** Big label under the QR (dossier name, e.g. "Emmanuel Goldstein"). */
  title: string;
  /** Small mono second line (fleet id, e.g. "ghost.goldstein"). */
  subtitle?: string;
  /** Optional base32 seed printed tiny for manual authenticator entry. */
  secret?: string;
}

/** Vertical room reserved under each QR for the label lines. */
const LABEL_BAND = 30;

/** Print-resolution pixel size for a QR drawn at sizePt points (pdf.ts twin). */
function pxFor(sizePt: number): number {
  return Math.min(1200, Math.max(64, Math.round(sizePt * 4)));
}

/** Exact centered-text x via the embedded font's metrics. */
function centerX(
  cellX: number,
  cellW: number,
  text: string,
  size: number,
  font: PDFFont,
): number {
  return cellX + cellW / 2 - font.widthOfTextAtSize(text, size) / 2;
}

/** Dotted cut lines between cells (grid layouts only) — pdf.ts pattern. */
function drawFoldLines(page: PDFPage, l: SheetLayout) {
  const dash = 3;
  const gap = 3;
  for (let i = 1; i < l.across; i++) {
    const x = l.startX + i * l.pitchX;
    const top = l.startY + l.cellH;
    const bottom = l.startY - (l.down - 1) * l.pitchY;
    let y = top;
    while (y > bottom) {
      const end = Math.max(y - dash, bottom);
      page.drawLine({ start: { x, y }, end: { x, y: end }, thickness: 0.5, color: LIGHT_GREY });
      y = end - gap;
    }
  }
  for (let i = 1; i < l.down; i++) {
    const y = l.startY + l.cellH - i * l.pitchY;
    const right = l.startX + l.across * l.pitchX;
    let x = l.startX;
    while (x < right) {
      const end = Math.min(x + dash, right);
      page.drawLine({ start: { x, y }, end: { x: end, y }, thickness: 0.5, color: LIGHT_GREY });
      x = end + gap;
    }
  }
}

export function ghostSheetFilename(layout: SheetLayout): string {
  return `ghost-otp-sheet-${layout.name}-${layout.widthIn.toFixed(1)}x${layout.heightIn.toFixed(1)}in.pdf`;
}

export async function buildGhostOtpSheetPdf(opts: {
  entries: GhostSheetEntry[];
  layout: SheetLayout;
  renderPng: RenderPng;
}): Promise<Uint8Array> {
  const { entries, layout: l, renderPng } = opts;
  if (entries.length === 0) throw new Error("No OTP-bearing ghosts to print.");

  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const perPage = l.across * l.down;

  // QR square: fit beside the label band, keep the pdf.ts 0.9 breathing margin.
  const qrPt = Math.floor(Math.min(l.qrBox, l.cellH - LABEL_BAND) * 0.9);

  for (let start = 0; start < entries.length; start += perPage) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    if (l.kind === "grid") drawFoldLines(page, l);
    page.drawText("meshtk ghost OTP seeds (derived — what the deployed bots validate)", {
      x: 40,
      y: HEADER_Y,
      size: 10,
      color: GREY,
    });
    page.drawText("SENSITIVE: every QR is a live authenticator seed. Do not post or reprint.", {
      x: 40,
      y: HEADER_Y - 12,
      size: 8,
      color: RED,
    });

    const pageEntries = entries.slice(start, start + perPage);
    for (let i = 0; i < pageEntries.length; i++) {
      const e = pageEntries[i];
      const dx = i % l.across;
      const dy = Math.floor(i / l.across);
      const o = cellOrigin(l, dx, dy);

      const image = await doc.embedPng(await renderPng(e.url, pxFor(qrPt)));
      const qx = o.x + (l.cellW - qrPt) / 2;
      const qy = o.y + LABEL_BAND + (l.cellH - LABEL_BAND - qrPt) / 2;
      page.drawImage(image, { x: qx, y: qy, width: qrPt, height: qrPt });

      page.drawText(e.title, {
        x: centerX(o.x, l.cellW, e.title, 11, bold),
        y: o.y + 19,
        size: 11,
        font: bold,
        color: rgb(0.1, 0.1, 0.1),
      });
      if (e.subtitle) {
        page.drawText(e.subtitle, {
          x: centerX(o.x, l.cellW, e.subtitle, 6, helv),
          y: o.y + 11,
          size: 6,
          font: helv,
          color: MID_GREY,
        });
      }
      if (e.secret) {
        page.drawText(e.secret, {
          x: centerX(o.x, l.cellW, e.secret, 5, helv),
          y: o.y + 4,
          size: 5,
          font: helv,
          color: MID_GREY,
        });
      }
    }

    page.drawText(
      `${Math.min(start + perPage, entries.length)}/${entries.length} ghosts · ${l.name} grid · cell ${(l.cellW / DPI).toFixed(1)}"`,
      { x: 40, y: 16, size: 7, color: MID_GREY },
    );
  }

  return doc.save();
}
