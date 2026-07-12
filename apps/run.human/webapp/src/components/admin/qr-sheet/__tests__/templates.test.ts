import { describe, it, expect } from "vitest";
import {
  parseTemplate,
  cellOrigin,
  PAGE_WIDTH,
  PAGE_HEIGHT,
} from "../templates";

describe("parseTemplate — grids", () => {
  it("parses 4x6 with dc33 box math (square boxes, centered)", () => {
    const l = parseTemplate("4x6")!;
    expect(l.kind).toBe("grid");
    expect(l.across).toBe(4);
    expect(l.down).toBe(6);
    // dc33: gridW=612-40=572, gridH=792-80=712 → box=min(143, 118.666…)
    expect(l.qrBox).toBeCloseTo(712 / 6, 5);
    expect(l.cellW).toBeCloseTo(l.qrBox, 5);
    expect(l.pitchX).toBeCloseTo(l.qrBox, 5);
    // centered: startX=(612-4*box)/2 ; startY=792-(792-6*box)/2-box
    expect(l.startX).toBeCloseTo((PAGE_WIDTH - 4 * l.qrBox) / 2, 5);
    expect(l.startY).toBeCloseTo(
      PAGE_HEIGHT - (PAGE_HEIGHT - 6 * l.qrBox) / 2 - l.qrBox,
      5
    );
  });

  it("defaults 7x9 for empty input", () => {
    const l = parseTemplate("")!;
    expect(l.across).toBe(7);
    expect(l.down).toBe(9);
  });

  it("rejects out-of-bounds and garbage", () => {
    expect(parseTemplate("0x9")).toBeNull();
    expect(parseTemplate("13x4")).toBeNull();
    expect(parseTemplate("4x13")).toBeNull();
    expect(parseTemplate("hello")).toBeNull();
    expect(parseTemplate("4x")).toBeNull();
  });
});

describe("parseTemplate — Avery", () => {
  it("parses 5160 with exact label geometry (accepts avery- prefix)", () => {
    for (const input of ["5160", "avery-5160"]) {
      const l = parseTemplate(input)!;
      expect(l.kind).toBe("avery");
      expect(l.name).toBe("avery-5160");
      expect(l.across).toBe(3);
      expect(l.down).toBe(10);
      expect(l.cellW).toBeCloseTo(2.625 * 72, 5);
      expect(l.cellH).toBeCloseTo(1 * 72, 5);
      expect(l.qrBox).toBeCloseTo(72, 5); // min(w,h)
      expect(l.startX).toBeCloseTo(0.1875 * 72, 5);
      expect(l.startY).toBeCloseTo(792 - 0.5 * 72 - 72, 5);
      expect(l.pitchX).toBeCloseTo(2.625 * 72 + 0.125 * 72, 5);
      expect(l.pitchY).toBeCloseTo(72 + 0, 5);
      expect(l.widthIn).toBe(2.625);
      expect(l.heightIn).toBe(1);
    }
  });

  it("rejects unknown Avery ids", () => {
    expect(parseTemplate("9999")).toBeNull();
  });
});

describe("cellOrigin", () => {
  it("steps by pitch from start, y downward", () => {
    const l = parseTemplate("5160")!;
    expect(cellOrigin(l, 0, 0)).toEqual({ x: l.startX, y: l.startY });
    expect(cellOrigin(l, 2, 3).x).toBeCloseTo(l.startX + 2 * l.pitchX, 5);
    expect(cellOrigin(l, 2, 3).y).toBeCloseTo(l.startY - 3 * l.pitchY, 5);
  });
});
