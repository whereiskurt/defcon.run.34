/**
 * Cluster demo scenarios — PURE data. No I/O, no entities, no DynamoDB.
 *
 * Split out of `cluster-demo.ts` (which owns the DynamoDB writes) for two
 * reasons: the scenarios stay unit-testable on their own, and the standalone
 * `scripts/seed-cluster-scenarios.mts` seeder can import them under `tsx`,
 * which cannot load the entity layer's ESM-only auth adapter chain.
 *
 * ── Why the check-ins are future-dated ──────────────────────────────────────
 * Every scoring track is con-day gated (2026-08-05 .. 2026-08-10 PDT), so demo
 * check-ins are stamped onto con days. Before the con that is the future; the
 * detector only asks `isConDay`, so it works, and the LIVE sweep (which looks
 * at `now - window`) never touches them. Only the admin whole-con sweep does.
 */

export const DEMO_USER_PREFIX = "democluster-";

const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = 90_000; // at latitude ~36

/** Con-local (PDT = UTC-7) instant on an August 2026 day. */
function conAt(dayOfMonth: number, hour: number, minute = 0): number {
  return Date.UTC(2026, 7, dayOfMonth, hour + 7, minute);
}

export type DemoScenario = {
  key: string;
  label: string;
  /** 1-based inclusive runner range from the shared demo roster. */
  runners: [number, number];
  startAt: number;
  spanMinutes: number;
  lat: number;
  lng: number;
  spreadMeters: number;
  /** Extra check-ins per runner — used only by the "lone spammer" control. */
  repeats?: number;
  /** What the sweep is expected to do with this group, for the admin UI. */
  expectation: string;
};

/**
 * The seeded scenarios. Runner ranges deliberately OVERLAP so the demo shows
 * multi-day behaviour and the per-day cap, not just isolated crowds.
 */
export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    key: "wed-corral",
    label: "Wed morning run — start corral",
    runners: [1, 31],
    startAt: conAt(5, 6, 12),
    spanMinutes: 40,
    lat: 36.1364, lng: -115.1653, spreadMeters: 100,
    expectation: "31 runners → 200 pts each",
  },
  {
    key: "wed-lunch",
    label: "Wed lunch meetup",
    runners: [1, 8],
    startAt: conAt(5, 12, 30),
    spanMinutes: 15,
    lat: 36.1147, lng: -115.1728, spreadMeters: 60,
    expectation: "8 runners → 50 pts each",
  },
  {
    key: "wed-afternoon",
    label: "Wed afternoon shakeout",
    runners: [1, 5],
    startAt: conAt(5, 16, 0),
    spanMinutes: 10,
    lat: 36.1200, lng: -115.1690, spreadMeters: 50,
    expectation: "5 runners → 25 pts each (4th cluster of the day — capped out)",
  },
  {
    key: "wed-rebar",
    label: "Wed evening social — the Rebar",
    runners: [1, 12],
    startAt: conAt(5, 21, 40),
    spanMinutes: 20,
    lat: 36.1580, lng: -115.1530, spreadMeters: 150,
    expectation: "12 runners → 50 pts each",
  },
  {
    key: "thu-corral",
    label: "Thu morning run — start corral",
    runners: [5, 31],
    startAt: conAt(6, 6, 8),
    spanMinutes: 35,
    lat: 36.1364, lng: -115.1653, spreadMeters: 100,
    expectation: "27 runners → 200 pts each",
  },
  {
    key: "thu-halfway",
    label: "Thu halfway-point group check-in",
    runners: [1, 5],
    startAt: conAt(6, 14, 22),
    spanMinutes: 6,
    lat: 36.1250, lng: -115.1600, spreadMeters: 60,
    expectation: "5 runners → 25 pts each",
  },
  {
    key: "fri-split-west",
    label: "Fri — two groups 250m apart (west)",
    runners: [1, 6],
    startAt: conAt(7, 18, 0),
    spanMinutes: 10,
    lat: 36.1300, lng: -115.1750, spreadMeters: 30,
    expectation: "6 runners → 25 pts each; must NOT merge with the east group",
  },
  {
    key: "fri-split-east",
    label: "Fri — two groups 250m apart (east)",
    runners: [7, 12],
    startAt: conAt(7, 18, 0),
    spanMinutes: 10,
    lat: 36.1300, lng: -115.1750 + 250 / M_PER_DEG_LNG, spreadMeters: 30,
    expectation: "6 runners → 25 pts each; must NOT merge with the west group",
  },
  {
    key: "sat-lone-spammer",
    label: "Sat — one runner checking in eight times",
    runners: [40, 40],
    startAt: conAt(8, 10, 0),
    spanMinutes: 0,
    lat: 36.1100, lng: -115.1800, spreadMeters: 10,
    repeats: 8,
    expectation: "NEGATIVE CONTROL — 1 distinct runner, no award",
  },
  {
    key: "sat-under-threshold",
    label: "Sat — group of three",
    runners: [37, 39],
    // Deliberately far from the lone spammer in BOTH space and time: within one
    // window and one radius of it, 3 runners + the spammer would reach
    // minRunners and manufacture a cluster the control is meant to disprove.
    startAt: conAt(8, 14, 0),
    spanMinutes: 5,
    lat: 36.0900, lng: -115.2100, spreadMeters: 40,
    expectation: "NEGATIVE CONTROL — under minRunners, no award",
  },
];

export type DemoCheckIn = {
  userId: string;
  displayName: string;
  scenario: string;
  checkInId: string;
  timestamp: number;
  lat: number;
  lng: number;
  isPrivate: boolean;
};

export function demoUserId(n: number): string {
  return `${DEMO_USER_PREFIX}${String(n).padStart(4, "0")}`;
}

export function demoDisplayName(n: number): string {
  return `demo_runner_${String(n).padStart(2, "0")}`;
}

/**
 * PURE: expand the scenarios into concrete check-in rows. Deterministic — the
 * same call always yields the same ids, times, and coordinates, so re-seeding
 * overwrites rather than duplicating.
 */
export function buildDemoCheckIns(): DemoCheckIn[] {
  const out: DemoCheckIn[] = [];

  for (const s of DEMO_SCENARIOS) {
    const [from, to] = s.runners;
    const count = to - from + 1;
    const repeats = s.repeats ?? 1;

    for (let i = 0; i < count; i++) {
      const runner = from + i;
      for (let r = 0; r < repeats; r++) {
        const frac = count === 1 ? 0 : i / (count - 1);
        // Golden-angle scatter — spreads inside the radius without clumping.
        const angle = (i * repeats + r) * 2.399963;
        const radius = s.spreadMeters * Math.sqrt(((i + r) % 7) / 7);
        const minuteOffset = frac * s.spanMinutes + r * 5;

        out.push({
          userId: demoUserId(runner),
          displayName: demoDisplayName(runner),
          scenario: s.key,
          checkInId: `demo-${s.key}-${String(runner).padStart(4, "0")}-${r}`,
          timestamp: s.startAt + Math.round(minuteOffset * 60_000),
          lat: s.lat + (radius * Math.cos(angle)) / M_PER_DEG_LAT,
          lng: s.lng + (radius * Math.sin(angle)) / M_PER_DEG_LNG,
          // Half private on purpose: private check-ins MUST still cluster
          // (isPrivate defaults true, so requiring public would never fire).
          isPrivate: runner % 2 === 0,
        });
      }
    }
  }

  return out;
}

/** Distinct runners the demo touches, with their manifest metadata. */
export function demoRoster(): { userId: string; displayName: string; scenario: string }[] {
  const seen = new Map<string, { userId: string; displayName: string; scenario: string }>();
  for (const c of buildDemoCheckIns()) {
    if (!seen.has(c.userId)) {
      seen.set(c.userId, {
        userId: c.userId,
        displayName: c.displayName,
        scenario: c.scenario,
      });
    }
  }
  return [...seen.values()];
}
