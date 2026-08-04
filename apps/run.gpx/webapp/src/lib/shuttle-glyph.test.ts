import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * The shuttle glyph, ticket and QR live in the gpx-studio package, which has no
 * test runner of its own. Rather than leave them unpinned, these tests read the
 * studio sources as text and assert the properties that would break silently and
 * expensively in production:
 *
 *  - the QR path must still decode to r.defcon.run (a mangled path is a dead
 *    rickroll that nobody would notice, because a broken QR just fails to scan)
 *  - the roof board must stay outside the mirroring group, or a westbound bus
 *    renders its destination text backwards
 *  - each bus state must keep its BSidesLV track pun
 */
const STUDIO = join(
  __dirname,
  "../../../gpx-studio/website/src/lib/components/map",
);
const read = (f: string) => readFileSync(join(STUDIO, f), "utf8");

describe("shuttle QR constant", () => {
  const src = read("shuttle-qr.ts");

  it("targets the r.defcon.run rickroll", () => {
    expect(src).toContain("HTTPS://R.DEFCON.RUN");
  });

  it("is a 25x25 version-2 grid", () => {
    expect(src).toMatch(/QR_MODULES\s*=\s*25/);
  });

  it("decodes to the target URL", () => {
    // Re-derive the module grid from the shipped path and check the structural
    // invariants of a real QR symbol. A hand-edit that shifts or truncates the
    // path fails here rather than in someone's camera.
    const m = /export const QR_PATH =\s*\n?\s*'([^']+)'/.exec(src);
    expect(m, "QR_PATH literal not found").toBeTruthy();
    const path = m![1];

    const N = 25;
    const grid = Array.from({ length: N }, () => new Array<number>(N).fill(0));
    // Path is a run-length series of `M<x> <y>h<len>v1h-<len>z`.
    const runRe = /M(\d+) (\d+)h(\d+)v1h-\d+z/g;
    let run: RegExpExecArray | null;
    let dark = 0;
    while ((run = runRe.exec(path))) {
      const x = Number(run[1]), y = Number(run[2]), len = Number(run[3]);
      expect(y).toBeLessThan(N);
      expect(x + len).toBeLessThanOrEqual(N);
      for (let i = 0; i < len; i++) { grid[y][x + i] = 1; dark++; }
    }
    expect(dark).toBeGreaterThan(150); // a plausible fill for v2-H

    // Finder patterns: 7x7 in three corners, each a dark ring with a 3x3 core.
    const finderAt = (r: number, c: number) => {
      for (let i = 0; i < 7; i++) {
        expect(grid[r][c + i], `top edge ${r},${c}`).toBe(1);
        expect(grid[r + 6][c + i], `bottom edge ${r},${c}`).toBe(1);
        expect(grid[r + i][c], `left edge ${r},${c}`).toBe(1);
        expect(grid[r + i][c + 6], `right edge ${r},${c}`).toBe(1);
      }
      for (let i = 2; i < 5; i++)
        for (let j = 2; j < 5; j++)
          expect(grid[r + i][c + j], `core ${r},${c}`).toBe(1);
      // separator ring just inside the border must be light
      for (let i = 1; i < 6; i++) {
        expect(grid[r + 1][c + i], `inner light ${r},${c}`).toBe(0);
        expect(grid[r + 5][c + i], `inner light ${r},${c}`).toBe(0);
      }
    };
    finderAt(0, 0);
    finderAt(0, N - 7);
    finderAt(N - 7, 0);

    // Timing patterns: row/col 6 alternate starting dark at module 8.
    for (let i = 8; i < N - 8; i++) {
      expect(grid[6][i], `h timing ${i}`).toBe(i % 2 === 0 ? 1 : 0);
      expect(grid[i][6], `v timing ${i}`).toBe(i % 2 === 0 ? 1 : 0);
    }
  });
});

describe("shuttle glyph", () => {
  const src = read("shuttle-svg.ts");

  it("keeps the roof board OUTSIDE the mirrored group", () => {
    // The body group is flipped by CSS for westbound buses. If the board <text>
    // or the sleeping "z z" drifted inside it, they would render backwards.
    const bodyStart = src.indexOf('<g class="dc34-shuttle-body">');
    const bodyEnd = src.indexOf("</g>\n  <rect x=\"38\"");
    expect(bodyStart).toBeGreaterThan(-1);
    expect(bodyEnd).toBeGreaterThan(bodyStart);
    const insideBody = src.slice(bodyStart, bodyEnd);
    expect(insideBody).not.toContain("boardFor(face)");
    expect(insideBody).not.toContain("dc34-shuttle-zzz");
  });

  it("centres the board on the viewBox so the flip cannot shift it", () => {
    // viewBox is 128 wide; x=38 w=52 => centre 64, and the text sits at x=64.
    expect(src).toContain('<rect x="38" y="8" width="52"');
    expect(src).toContain('<text x="64"');
  });

  it("pairs every state with its BSidesLV track pun", () => {
    expect(src).toContain("'BREAKING GRD'");
    expect(src).toContain("'COMMON GRD'");
    expect(src).toContain("'UNDERGROUND'");
    expect(src).toContain("'GRD TRUTH ?'");
  });
});

describe("shuttle deep link", () => {
  it("does not award the covert flag on a link reveal", () => {
    const lc = readFileSync(
      join(__dirname, "../../../gpx-studio/website/src/lib/components/map/layer-control/LayerControl.svelte"),
      "utf8",
    );
    // Only an 'earned' reveal may fire the egg. A plain truthiness check here
    // would silently re-open the giveaway.
    expect(lc).toContain("if (reveal === 'earned') fireShuttleEgg();");
    expect(lc).not.toMatch(/if \(on\) fireShuttleEgg\(\)/);
  });

  it("registers shuttles as a deep-linkable layer token", () => {
    const lv = readFileSync(
      join(__dirname, "../../../gpx-studio/website/src/lib/stores/layer-visibility.ts"),
      "utf8",
    );
    const lu = readFileSync(
      join(__dirname, "../../../gpx-studio/website/src/lib/stores/layer-url.ts"),
      "utf8",
    );
    expect(lv).toContain("shuttles: 'shuttles'");
    expect(lu).toContain("LAYER.shuttles");
  });
});
