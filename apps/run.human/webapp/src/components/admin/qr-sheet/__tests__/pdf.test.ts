import { describe, it, expect } from "vitest";
import * as qrLib from "qrcode";

import { parseTemplate } from "../templates";
import { sheetFilename, buildProgressiveUrls, buildSheetPdf } from "../pdf";

describe("sheetFilename", () => {
  it("uses the q.defcon.run code as slug", () => {
    const l = parseTemplate("4x6")!;
    const name = sheetFilename("https://q.defcon.run/CTF", l);
    expect(name).toMatch(/^qr-sheet-ctf-4x6-\d+(\.\d+)?x\d+(\.\d+)?in\.pdf$/);
  });
  it("falls back to hostname for arbitrary URLs, exact Avery inches", () => {
    const l = parseTemplate("5160")!;
    expect(sheetFilename("https://example.com/x?y=1", l)).toBe(
      "qr-sheet-example.com-avery-5160-2.625x1in.pdf"
    );
  });
  it("survives unparseable URLs", () => {
    const l = parseTemplate("4x6")!;
    expect(sheetFilename("not a url", l)).toContain("qr-sheet-url-");
  });
});

describe("buildProgressiveUrls", () => {
  const url = "https://q.defcon.run/LONGCODE";
  it("starts at the origin, ends at the full URL, exact cell count", () => {
    const urls = buildProgressiveUrls(url, 12);
    expect(urls).toHaveLength(12);
    expect(urls[0]).toBe("https://q.defcon.run");
    expect(urls[urls.length - 1]).toBe(url);
    // monotonically non-shrinking prefixes of the target
    for (let i = 1; i < urls.length; i++) {
      expect(urls[i].length).toBeGreaterThanOrEqual(urls[i - 1].length);
      expect(url.startsWith(urls[i])).toBe(true);
    }
  });
  it("handles more cells than characters by padding with the full URL", () => {
    const urls = buildProgressiveUrls("https://a.io/x", 30);
    expect(urls).toHaveLength(30);
    expect(urls[29]).toBe("https://a.io/x");
  });
});

describe("buildSheetPdf (stub renderer)", () => {
  // Real (tiny) PNGs from the plain qrcode lib — pdf-lib must parse them.
  const stubRender = async (url: string, sizePx: number) => {
    const buf = await qrLib.toBuffer(url, {
      width: Math.max(32, sizePx),
      margin: 0,
    });
    return buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength
    ) as ArrayBuffer;
  };

  it("produces a 1-page PDF without proof pages", async () => {
    const bytes = await buildSheetPdf({
      url: "https://q.defcon.run/CTF",
      layout: parseTemplate("3x3")!,
      includeProofPages: false,
      renderPng: stubRender,
    });
    expect(bytes.length).toBeGreaterThan(1000);
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("produces 4+ pages with proof pages on", async () => {
    const bytes = await buildSheetPdf({
      url: "https://q.defcon.run/CTF",
      layout: parseTemplate("3x3")!,
      includeProofPages: true,
      renderPng: stubRender,
    });
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes);
    // page 1 grid + page 2 giant + ≥1 size-comparison page + progressive page
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(4);
  }, 30000);
});
