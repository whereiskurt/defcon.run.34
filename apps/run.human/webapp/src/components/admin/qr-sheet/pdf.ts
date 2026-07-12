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

export type RenderPng = (url: string, sizePx: number) => Promise<ArrayBuffer>;

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

/** dc33's progressive data-density URL ladder: origin → full URL. */
export function buildProgressiveUrls(url: string, totalCells: number): string[] {
  if (totalCells <= 0) return [];
  const parts = url.split("/");
  const origin = parts.slice(0, 3).join("/");
  const fullPath = parts.length > 3 ? "/" + parts.slice(3).join("/") : "";
  const urls: string[] = [origin];
  const cellsNeeded = Math.min(Math.max(totalCells - 1, 0), fullPath.length);
  const charsPerStep = Math.max(
    1,
    Math.ceil(fullPath.length / Math.max(cellsNeeded, 1))
  );
  for (let i = 0; i < cellsNeeded; i++) {
    const end = Math.min((i + 1) * charsPerStep, fullPath.length);
    urls.push(origin + fullPath.substring(0, end));
    if (end >= fullPath.length) break;
  }
  while (urls.length < totalCells) urls.push(url);
  urls.splice(totalCells);
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
        if (overflowed) break; // no room even on page 4 — dc33 also stopped
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

    const urls = buildProgressiveUrls(url, l.across * l.down);
    const origin = url.split("/").slice(0, 3).join("/");
    let i = 0;
    for (let dx = 0; dx < l.across; dx++) {
      for (let dy = 0; dy < l.down; dy++) {
        if (i >= urls.length) break;
        const u = urls[i];
        try {
          const image = await doc.embedPng(await renderPng(u, pxFor(qrPt)));
          const pos = drawQrInCell(prog, l, image, qrPt, dx, dy);
          const extra = u.length - origin.length;
          const label = extra === 0 ? "Base" : `+${extra}`;
          prog.drawText(label, {
            x: pos.x + qrPt / 2 - label.length * 6 * 0.3,
            y: pos.y - 10,
            size: 6,
            color: FAINT_GREY,
          });
        } catch {
          // an individual progressive step failing must not kill the sheet
        }
        i++;
      }
    }
    const ey = 60;
    prog.drawText(
      "This page tests QR code readability as data density increases.",
      { x: 40, y: ey + 30, size: 9, color: MID_GREY }
    );
    prog.drawText("Each QR code adds more characters from the full URL path.", {
      x: 40,
      y: ey + 15,
      size: 9,
      color: MID_GREY,
    });
    prog.drawText(
      `Template: ${l.across}×${l.down}, Cell size: ${(l.qrBox / DPI).toFixed(2)}"`,
      { x: 40, y: ey, size: 9, color: MID_GREY }
    );
  }

  return doc.save();
}
