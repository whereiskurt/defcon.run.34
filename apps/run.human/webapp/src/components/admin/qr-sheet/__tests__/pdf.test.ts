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
  const url = "https://q.defcon.run/CTF";
  it("starts at the base URL and grows STRICTLY denser every cell", () => {
    const urls = buildProgressiveUrls(url, 12);
    expect(urls).toHaveLength(12);
    expect(urls[0]).toBe(url);
    for (let i = 1; i < urls.length; i++) {
      // every later cell appends ?p=… filler — strictly longer than the last
      expect(urls[i].length).toBeGreaterThan(urls[i - 1].length);
      expect(urls[i].startsWith(`${url}?p=`)).toBe(true);
    }
  });

  it("keeps growing even for a short base URL (the dc33 '+1 forever' bug)", () => {
    const urls = buildProgressiveUrls("https://q.defcon.run/", 36);
    expect(urls).toHaveLength(36);
    const last = urls[35];
    // ramps toward ~240 appended chars regardless of base length
    expect(last.length - "https://q.defcon.run/".length).toBeGreaterThanOrEqual(200);
    expect(new Set(urls).size).toBe(36); // no duplicate cells
  });

  it("appends with & when the base already has a query", () => {
    const urls = buildProgressiveUrls("https://a.io/x?y=1", 3);
    expect(urls[1].startsWith("https://a.io/x?y=1&p=")).toBe(true);
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

  it("produces 5+ pages with proof pages on, forcing all four EC levels on the redundancy page", async () => {
    const forcedLevels: string[] = [];
    const spyRender = async (
      url: string,
      sizePx: number,
      ecLevel?: "L" | "M" | "Q" | "H"
    ) => {
      if (ecLevel) forcedLevels.push(ecLevel);
      return stubRender(url, sizePx);
    };
    const bytes = await buildSheetPdf({
      url: "https://q.defcon.run/CTF",
      layout: parseTemplate("3x3")!,
      includeProofPages: true,
      renderPng: spyRender,
    });
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes);
    // grid + giant + ≥1 size-comparison + EC-comparison + progressive
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(5);
    // the redundancy page rendered every level explicitly
    for (const lvl of ["L", "M", "Q", "H"]) {
      expect(forcedLevels).toContain(lvl);
    }
  }, 30000);
});
