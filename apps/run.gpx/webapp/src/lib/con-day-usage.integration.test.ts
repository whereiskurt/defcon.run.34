/**
 * Integration check for the per-con-day count against a REAL DynamoDB (Phase 59).
 *
 * Unit tests cover the pure cap math; this exercises the actual ElectroDB query
 * + filter (countConDayRuns / getConDayUsage) against local DynamoDB. It
 * self-skips unless DYNAMODB_ENDPOINT is set, so it never runs (or fails) in the
 * normal CI suite. Run locally with the run-gpx-electro table up:
 *
 *   DYNAMODB_ENDPOINT=http://localhost:8888 DYNAMODB_TABLE=run-gpx-electro \
 *   DYNAMODB_ACCESS_KEY=local DYNAMODB_SECRET_KEY=local DYNAMODB_REGION=us-east-1 \
 *   npx vitest run src/lib/con-day-usage.integration.test.ts
 */
import { describe, it, expect, afterAll } from "vitest";
import { GpxFile } from "@/entities/gpx-file";
import { countConDayRuns, getConDayUsage } from "./con-day-usage";

const LIVE = !!process.env.DYNAMODB_ENDPOINT;
const USER = `test-conday-${Date.now()}`;
const nowSat = Date.parse("2026-08-08T20:00:00Z"); // "today" = Saturday

const created: string[] = [];
async function mk(conDay: string | undefined, status: "active" | "failed") {
  const fileId = `${USER}-${created.length}`;
  await GpxFile.create({
    userId: USER,
    fileId,
    fileName: "t.gpx",
    bucket: "b",
    key: `k/${fileId}`,
    fileSize: 1,
    status,
    ...(conDay ? { conDay } : {}),
  }).go();
  created.push(fileId);
}

describe.skipIf(!LIVE)("con-day usage vs local DynamoDB", () => {
  afterAll(async () => {
    for (const fileId of created) {
      await GpxFile.delete({ userId: USER, fileId }).go().catch(() => {});
    }
  });

  it("counts non-failed files per con-day and computes remaining", async () => {
    await mk("2026-08-08", "active");
    await mk("2026-08-08", "active");
    await mk("2026-08-08", "active");
    await mk("2026-08-08", "failed"); // must NOT count
    await mk("2026-08-07", "active");
    await mk("2026-08-07", "active");
    await mk(undefined, "active"); // untagged, must NOT count

    expect(await countConDayRuns(USER, "2026-08-08")).toBe(3);
    expect(await countConDayRuns(USER, "2026-08-07")).toBe(2);
    expect(await countConDayRuns(USER, "2026-08-06")).toBe(0);

    const usage = await getConDayUsage(USER, "upload", nowSat);
    const sat = usage.find((u) => u.date === "2026-08-08")!;
    const fri = usage.find((u) => u.date === "2026-08-07")!;
    const sun = usage.find((u) => u.date === "2026-08-09")!;

    expect(sat).toMatchObject({ count: 3, remaining: 7, selectable: true });
    expect(fri).toMatchObject({ count: 2, remaining: 8, selectable: true });
    // Sunday is a future con-day relative to "today" = Saturday.
    expect(sun).toMatchObject({ count: 0, remaining: 10, selectable: false });
  });
});
