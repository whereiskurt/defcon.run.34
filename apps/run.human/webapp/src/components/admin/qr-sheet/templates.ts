/**
 * Pure sheet-layout math for the QR sheet designer — ported from dc33's
 * /api/qr/sheet route (defcon.run.33). No DOM, no deps: unit-tested in node.
 * All linear units are PDF points (72/inch); page is US Letter.
 */

export const DPI = 72;
export const PAGE_WIDTH = 8.5 * DPI; // 612
export const PAGE_HEIGHT = 11 * DPI; // 792

// dc33 grid margins: 40pt total X, 80pt total Y (header/footer room).
const TOTAL_MARGIN_X = 40;
const TOTAL_MARGIN_Y = 80;

const MAX_AXIS = 12; // practical print floor - beyond this cells scan poorly

/** Avery label geometry (inches) — dc33 data, verbatim. */
export const AVERY_TEMPLATES: Record<
  string,
  {
    across: number;
    down: number;
    width: number;
    height: number;
    marginLeft: number;
    marginTop: number;
    spacingX: number;
    spacingY: number;
  }
> = {
  "5160": { across: 3, down: 10, width: 2.625, height: 1, marginLeft: 0.1875, marginTop: 0.5, spacingX: 0.125, spacingY: 0 },
  "5163": { across: 2, down: 5, width: 4, height: 2, marginLeft: 0.25, marginTop: 0.5, spacingX: 0.25, spacingY: 0 },
  "5164": { across: 2, down: 3, width: 4, height: 3.33, marginLeft: 0.25, marginTop: 0.17, spacingX: 0.25, spacingY: 0 },
  "5167": { across: 4, down: 20, width: 1.75, height: 0.5, marginLeft: 0.3125, marginTop: 0.5, spacingX: 0.1875, spacingY: 0 },
  "5261": { across: 2, down: 10, width: 4, height: 1, marginLeft: 0.25, marginTop: 0.5, spacingX: 0.25, spacingY: 0 },
  "5262": { across: 2, down: 7, width: 4, height: 1.33, marginLeft: 0.25, marginTop: 0.17, spacingX: 0.25, spacingY: 0.17 },
  "8160": { across: 3, down: 10, width: 2.625, height: 1, marginLeft: 0.1875, marginTop: 0.5, spacingX: 0.125, spacingY: 0 },
  // dc33 shipped 22816 as 3×6 of 2.5" cells (16.75" of labels on an 11" page).
  // Real Avery 22816 stock (per avery.com/products/labels/22816) is 2"×2",
  // 12 per sheet, 3×4 — margins+gutters below sum exactly to 8.5"×11".
  "22816": { across: 3, down: 4, width: 2, height: 2, marginLeft: 1, marginTop: 0.75, spacingX: 0.25, spacingY: 0.5 },
};

export type SheetLayout = {
  kind: "grid" | "avery";
  /** Canonical name for filenames/UI: "4x6" or "avery-5160". */
  name: string;
  across: number;
  down: number;
  /** Cell size in points (grid: cellW === cellH === qrBox). */
  cellW: number;
  cellH: number;
  /** The square box a QR fits in: min(cellW, cellH). */
  qrBox: number;
  /** Bottom-left of the TOP-LEFT cell, PDF coords (y up). */
  startX: number;
  startY: number;
  /** Step between cell origins (cell + label spacing). */
  pitchX: number;
  pitchY: number;
  /** Physical cell size in inches (for filenames / UI). */
  widthIn: number;
  heightIn: number;
};

/**
 * Parse a template string: "" → default 7x9 grid, "AxB" → custom grid
 * (1–12 per axis), "5160" / "avery-5160" → Avery. Anything else → null.
 */
export function parseTemplate(input: string): SheetLayout | null {
  const trimmed = (input ?? "").trim().toLowerCase();
  if (trimmed === "") return gridLayout(7, 9);

  const averyMatch = trimmed.match(/^(?:avery-)?(\d{4,5})$/);
  if (averyMatch) {
    const t = AVERY_TEMPLATES[averyMatch[1]];
    if (!t) return null;
    return {
      kind: "avery",
      name: `avery-${averyMatch[1]}`,
      across: t.across,
      down: t.down,
      cellW: t.width * DPI,
      cellH: t.height * DPI,
      qrBox: Math.min(t.width, t.height) * DPI,
      startX: t.marginLeft * DPI,
      startY: PAGE_HEIGHT - t.marginTop * DPI - t.height * DPI,
      pitchX: (t.width + t.spacingX) * DPI,
      pitchY: (t.height + t.spacingY) * DPI,
      widthIn: t.width,
      heightIn: t.height,
    };
  }

  const gridMatch = trimmed.match(/^(\d{1,2})x(\d{1,2})$/);
  if (gridMatch) {
    const across = parseInt(gridMatch[1], 10);
    const down = parseInt(gridMatch[2], 10);
    if (across < 1 || down < 1 || across > MAX_AXIS || down > MAX_AXIS)
      return null;
    return gridLayout(across, down);
  }

  return null;
}

function gridLayout(across: number, down: number): SheetLayout {
  // dc33: square boxes sized to the tighter axis, grid centered on the page.
  const box = Math.min(
    (PAGE_WIDTH - TOTAL_MARGIN_X) / across,
    (PAGE_HEIGHT - TOTAL_MARGIN_Y) / down
  );
  return {
    kind: "grid",
    name: `${across}x${down}`,
    across,
    down,
    cellW: box,
    cellH: box,
    qrBox: box,
    startX: (PAGE_WIDTH - box * across) / 2,
    startY: PAGE_HEIGHT - (PAGE_HEIGHT - box * down) / 2 - box,
    pitchX: box,
    pitchY: box,
    widthIn: box / DPI,
    heightIn: box / DPI,
  };
}

/** Bottom-left corner of cell (dx, dy); dy counts DOWN from the top row. */
export function cellOrigin(
  layout: SheetLayout,
  dx: number,
  dy: number
): { x: number; y: number } {
  return {
    x: layout.startX + dx * layout.pitchX,
    y: layout.startY - dy * layout.pitchY,
  };
}

/** dc33's six layout preset buttons. */
export const GRID_PRESETS = [
  { label: "Default (7×9)", value: "7x9" },
  { label: "Large (3×3)", value: "3x3" },
  { label: "Medium (4×6)", value: "4x6" },
  { label: "Small (6×8)", value: "6x8" },
  { label: "Avery 5160", value: "5160" },
  { label: "Avery 22816", value: "22816" },
] as const;

/** Avery reference data for the layout dropdown (replaces dc33's cards). */
export const AVERY_INFO = [
  { id: "5160", desc: "Address labels", dims: '2.625" × 1", 3×10' },
  { id: "5163", desc: "Shipping labels", dims: '4" × 2", 2×5' },
  { id: "5164", desc: "Shipping labels", dims: '4" × 3.33", 2×3' },
  { id: "5167", desc: "Return address", dims: '1.75" × 0.5", 4×20' },
  { id: "5261", desc: "Address labels", dims: '4" × 1", 2×10' },
  { id: "5262", desc: "Address labels", dims: '4" × 1.33", 2×7' },
  { id: "8160", desc: "Address labels", dims: '2.625" × 1", 3×10' },
  { id: "22816", desc: "Square labels", dims: '2" × 2", 3×4' },
] as const;
