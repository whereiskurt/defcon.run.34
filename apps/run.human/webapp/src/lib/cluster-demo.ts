/**
 * Cluster demo data — seed and clear the demo group check-ins so the feature
 * can be exercised end-to-end before the con. SERVER-ONLY (DynamoDB).
 *
 * The scenarios themselves are PURE and live in `cluster-demo-data.ts`; this
 * module only writes and removes them.
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
import { buildDemoCheckIns, demoRoster } from "./cluster-demo-data";

export * from "./cluster-demo-data";

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
