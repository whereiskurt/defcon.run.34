/**
 * Cluster demo data — seed and clear a realistic set of group check-ins so the
 * feature can be exercised end-to-end before the con.
 *
 * `buildDemoCheckIns` is PURE and deterministic (fixed ids, fixed timestamps,
 * fixed coordinates), so the scenarios are unit-testable and re-seeding is
 * idempotent. The load/clear helpers below own the DynamoDB writes.
 *
 * ── Why the check-ins are future-dated ──────────────────────────────────────
 * Every scoring track is con-day gated (2026-08-05 .. 2026-08-10 PDT), so demo
 * check-ins are stamped onto con days. Before the con that is the future; the
 * detector only asks `isConDay`, so it works, and the LIVE sweep (which looks
 * at `now - window`) never touches them. Only the admin whole-con sweep does.
 *
 * ── Why there is a manifest ─────────────────────────────────────────────────
 * Clearing walks the ClusterDemoUser manifest and deletes exactly the runners
 * it lists. It does NOT prefix-match userIds: prefix deletes have burned this
 * repo before, when a legitimate row's key merely started with the same
 * characters. What the seeder created is what the cleaner removes.
 */
import { CheckIn } from "@/entities/checkin";
import { RunUser } from "@/entities/run-user";
import {
  Accomplishment,
  createAccomplishment,
  accomplishmentIdFor,
} from "@/entities/accomplishment";
import { ClusterAward, ClusterDemoUser } from "@/entities/cluster";
import { buildCheckinAccomplishmentInput } from "@/entities/checkin";

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

async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

/**
 * Seed the demo runners and their check-ins (idempotent — deterministic keys
 * mean a re-run overwrites in place). Also raises the matching check-in
 * accomplishments so demo runners light run-streak con days like real ones.
 *
 * Does NOT sweep; the caller runs the whole-con sweep afterwards so the two
 * steps stay independently reportable.
 */
export async function loadDemoData(): Promise<{
  runners: number;
  checkIns: number;
}> {
  const roster = demoRoster();
  const checkIns = buildDemoCheckIns();

  await inBatches(roster, 10, async (r) => {
    await RunUser.put({
      userId: r.userId,
      displayName: r.displayName,
      checkInCount: 0,
    }).go();
    await ClusterDemoUser.put({
      userId: r.userId,
      displayName: r.displayName,
      scenario: r.scenario,
    }).go();
  });

  await inBatches(checkIns, 10, async (c) => {
    await CheckIn.put({
      userId: c.userId,
      checkInId: c.checkInId,
      timestamp: c.timestamp,
      source: "Demo",
      samples: [
        {
          latitude: c.lat,
          longitude: c.lng,
          accuracy: 12,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
          timestamp: c.timestamp,
        },
      ],
      averageCoordinates: { latitude: c.lat, longitude: c.lng },
      bestAccuracy: 12,
      isPrivate: c.isPrivate,
      checkInType: "Manual",
      pointsCount: 1,
      duration: 0,
    }).go();

    await createAccomplishment(
      buildCheckinAccomplishmentInput({
        userId: c.userId,
        source: "Demo",
        timestamp: c.timestamp,
        isPrivate: c.isPrivate,
        checkInId: c.checkInId,
      }),
    );
  });

  return { runners: roster.length, checkIns: checkIns.length };
}

/**
 * Remove every trace of the demo: cluster awards, accomplishments, check-ins,
 * RunUser rows, and finally the manifest itself.
 *
 * Walks the MANIFEST, never a userId prefix — the manifest is the authority on
 * what the seeder created, so a real runner can never be caught by this even if
 * their id happened to share the prefix.
 */
export async function clearDemoData(): Promise<{
  runners: number;
  checkIns: number;
  awards: number;
  accomplishments: number;
}> {
  const manifest = await ClusterDemoUser.query.primary({}).go({ pages: "all" });
  const counts = { runners: 0, checkIns: 0, awards: 0, accomplishments: 0 };

  await inBatches(manifest.data, 5, async (row) => {
    const userId = row.userId;

    const awards = await ClusterAward.query.primary({ userId }).go({ pages: "all" });
    for (const a of awards.data) {
      await ClusterAward.delete({ userId, anchorCheckInId: a.anchorCheckInId }).go();
    }
    counts.awards += awards.data.length;

    const accs = await Accomplishment.query.primary({ userId }).go({ pages: "all" });
    for (const a of accs.data) {
      await Accomplishment.delete({ userId, accomplishmentId: a.accomplishmentId }).go();
    }
    counts.accomplishments += accs.data.length;

    const checkIns = await CheckIn.query.byUserRecent({ userId }).go({ pages: "all" });
    for (const c of checkIns.data) {
      await CheckIn.delete({ userId, timestamp: c.timestamp, checkInId: c.checkInId }).go();
    }
    counts.checkIns += checkIns.data.length;

    await RunUser.delete({ userId }).go();
    counts.runners += 1;

    await ClusterDemoUser.delete({ userId }).go();
  });

  return counts;
}

/** Is the demo currently loaded? Drives the admin button state. */
export async function demoStatus(): Promise<{ loaded: number }> {
  const manifest = await ClusterDemoUser.query.primary({}).go({ pages: "all" });
  return { loaded: manifest.data.length };
}

// `accomplishmentIdFor` is re-exported for the clear path's callers/tests that
// need to reason about which accomplishment a demo check-in produced.
export { accomplishmentIdFor };
