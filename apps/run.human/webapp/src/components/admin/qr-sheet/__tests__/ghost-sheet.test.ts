import { describe, expect, it } from "vitest";
import * as qrLib from "qrcode";

import { parseTemplate } from "../templates";
import { buildGhostOtpSheetPdf, ghostSheetFilename } from "../ghost-sheet";

// Real (tiny) PNGs from the plain qrcode lib — pdf-lib must parse them
// (same stub as pdf.test.ts).
const stubRender = async (url: string, sizePx: number) => {
  const buf = await qrLib.toBuffer(url, { width: Math.max(32, sizePx), margin: 0 });
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
};

function entries(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    url: `otpauth://totp/Ghost%20${i}?secret=SEED${i}AAAA&issuer=Defcon.run&period=120`,
    title: `Ghost ${i}`,
    subtitle: `ghost.g${i}`,
    secret: `SEED${i}AAAA`,
  }));
}

describe("ghostSheetFilename", () => {
  it("names by layout and cell inches", () => {
    expect(ghostSheetFilename(parseTemplate("3x3")!)).toMatch(
      /^ghost-otp-sheet-3x3-\d+(\.\d+)?x\d+(\.\d+)?in\.pdf$/,
    );
  });
});

describe("buildGhostOtpSheetPdf", () => {
  it("renders one DISTINCT QR per ghost on a single 3x3 page", async () => {
    const rendered: string[] = [];
    const bytes = await buildGhostOtpSheetPdf({
      entries: entries(8),
      layout: parseTemplate("3x3")!,
      renderPng: async (u, px) => {
        rendered.push(u);
        return stubRender(u, px);
      },
    });
    // every entry rendered exactly once, all payloads distinct
    expect(rendered).toHaveLength(8);
    expect(new Set(rendered).size).toBe(8);
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("chunks overflow onto additional pages (10 entries on 3x3 → 2 pages)", async () => {
    const bytes = await buildGhostOtpSheetPdf({
      entries: entries(10),
      layout: parseTemplate("3x3")!,
      renderPng: stubRender,
    });
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
  });

  it("handles the 3x5 layout in one page for 8 ghosts", async () => {
    const bytes = await buildGhostOtpSheetPdf({
      entries: entries(8),
      layout: parseTemplate("3x5")!,
      renderPng: stubRender,
    });
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("rejects an empty roster", async () => {
    await expect(
      buildGhostOtpSheetPdf({
        entries: [],
        layout: parseTemplate("3x3")!,
        renderPng: stubRender,
      }),
    ).rejects.toThrow(/No OTP/);
  });
});
