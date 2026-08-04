import { describe, it, expect } from "vitest";

/**
 * Tests for the studio's route click/tap hit-testing.
 *
 * The module lives in gpx-studio (where the map uses it) but the studio has no
 * test runner, so it is exercised from the webapp's vitest by relative path —
 * see checkin-cluster.test.ts for why.
 */
import {
  HIT_RADIUS_MOUSE,
  HIT_RADIUS_TOUCH,
  distSqToCandidate,
  distSqToSegment,
  hitRadiusPx,
  nearestCandidate,
  type HitCandidate,
} from "../../../gpx-studio/website/src/lib/components/map/route-hit";

const line = (layerId: string, pts: [number, number][]): HitCandidate => ({
  layerId,
  parts: [pts.map(([x, y]) => ({ x, y }))],
});

describe("hit radius", () => {
  it("gives a coarse pointer half of the 44px HIG touch target", () => {
    expect(hitRadiusPx(true)).toBe(HIT_RADIUS_TOUCH);
    expect(HIT_RADIUS_TOUCH * 2).toBe(44);
  });

  it("still beats the 3-8px core line for a mouse", () => {
    expect(hitRadiusPx(false)).toBe(HIT_RADIUS_MOUSE);
    // The bug was a target narrower than the widest core line (8px at z16).
    expect(HIT_RADIUS_MOUSE).toBeGreaterThan(8);
  });
});

describe("distSqToSegment", () => {
  it("measures perpendicular distance when the foot falls inside the segment", () => {
    const d = distSqToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(d).toBe(9); // 3px away, squared
  });

  it("clamps to the near endpoint when the foot falls beyond the segment", () => {
    // Off the END of the line, not beside it — must not report 0.
    const d = distSqToSegment({ x: 14, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(d).toBe(16);
  });

  it("handles a degenerate zero-length segment", () => {
    const d = distSqToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 });
    expect(d).toBe(25);
  });
});

describe("distSqToCandidate", () => {
  it("takes the nearest segment of a multi-segment polyline", () => {
    const c = line("a", [
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    // Closest to the vertical leg, 2px to its left.
    expect(distSqToCandidate({ x: 8, y: 5 }, c)).toBe(4);
  });

  it("considers every part of a multi-part route", () => {
    const c: HitCandidate = {
      layerId: "a",
      parts: [
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        [
          { x: 0, y: 100 },
          { x: 10, y: 100 },
        ],
      ],
    };
    expect(distSqToCandidate({ x: 5, y: 97 }, c)).toBe(9);
  });
});

describe("nearestCandidate", () => {
  it("returns null when everything is outside the radius", () => {
    const far = line("far", [
      [0, 0],
      [10, 0],
    ]);
    expect(nearestCandidate({ x: 5, y: 50 }, [far], 22)).toBeNull();
  });

  it("picks a route the thin core line would have missed", () => {
    // 9px off the line — outside an 8px core, inside the touch radius. This is
    // the whole bug: this tap used to do nothing.
    const route = line("core-a", [
      [0, 0],
      [100, 0],
    ]);
    expect(nearestCandidate({ x: 50, y: 9 }, [route], HIT_RADIUS_TOUCH)).toBe("core-a");
  });

  it("picks the CLOSEST of two parallel routes, not the first", () => {
    // The Strip case: parallel routes both inside the radius. An invisible
    // hit-layer approach would have let draw order decide; nearest must win.
    const near = line("core-near", [
      [0, 12],
      [100, 12],
    ]);
    const nearer = line("core-nearer", [
      [0, 2],
      [100, 2],
    ]);
    expect(nearestCandidate({ x: 50, y: 0 }, [near, nearer], 22)).toBe("core-nearer");
    // Order must not matter.
    expect(nearestCandidate({ x: 50, y: 0 }, [nearer, near], 22)).toBe("core-nearer");
  });

  it("ignores a nearer route that sits outside the radius", () => {
    const inside = line("core-in", [
      [0, 20],
      [100, 20],
    ]);
    const outside = line("core-out", [
      [0, 60],
      [100, 60],
    ]);
    expect(nearestCandidate({ x: 50, y: 0 }, [outside, inside], 22)).toBe("core-in");
  });

  it("resolves an exact tie to the first candidate (topmost wins)", () => {
    const top = line("core-top", [
      [0, 5],
      [100, 5],
    ]);
    const bottom = line("core-bottom", [
      [0, 5],
      [100, 5],
    ]);
    expect(nearestCandidate({ x: 50, y: 0 }, [top, bottom], 22)).toBe("core-top");
  });

  it("returns null for an empty candidate list", () => {
    expect(nearestCandidate({ x: 0, y: 0 }, [], 22)).toBeNull();
  });

  it("uses ALL parts of a tile-split route, not just the first", () => {
    // queryRenderedFeatures returns one feature per tile a route crosses. If the
    // router kept only the first, this route would measure 40px away and lose to
    // the rival — even though its second part passes 2px from the tap.
    const split: HitCandidate = {
      layerId: "core-split",
      parts: [
        [
          { x: 0, y: 40 },
          { x: 40, y: 40 },
        ],
        [
          { x: 40, y: 2 },
          { x: 100, y: 2 },
        ],
      ],
    };
    const rival = line("core-rival", [
      [0, 15],
      [100, 15],
    ]);
    expect(distSqToCandidate({ x: 60, y: 0 }, split)).toBe(4);
    expect(nearestCandidate({ x: 60, y: 0 }, [split, rival], 22)).toBe("core-split");
  });
});
