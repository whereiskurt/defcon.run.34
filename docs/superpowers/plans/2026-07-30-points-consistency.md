# Points Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three independent score-accrual systems with one derived scoring engine: `score = runStreak + socialStreak + ctfStreak + flagPoints`, recomputed per-user from ledgers on every event, per the approved spec `docs/superpowers/specs/2026-07-30-points-consistency-design.md`.

**Architecture:** Event admission (judge gates, dedup, ordinals, accomplishment reconcile) is unchanged; all award-time score writes are deleted. A pure `computeUserScore(events, config)` values a user's whole ledger against current config; `rescoreUser(userId)` is the ONLY writer of RunUser score fields and fires from every event admit. Flag values live on per-flag `Ctf` rows written by a DC34 seed script.

**Tech Stack:** Next.js 16 (run.human webapp), ElectroDB/DynamoDB, vitest, tsx operator scripts, Go (meshtk, upstream repo).

## Global Constraints

- Work in this worktree (`.claude/worktrees/pointswrite`), branch `design/points-consistency`. Never commit to main. All commands below run from `apps/run.human/webapp` unless a path says otherwise.
- Tests: `nvm use 22.12.0` first — vitest needs Node ≥ 22.12 (`reference_node_version_for_bib_tests`).
- Run tests with `npx vitest run <file>` (non-watch).
- NEVER log a guess, guessHash, codeHash, or OTP secret (judge hygiene contract).
- The player key everywhere in CTF/social is `session.user.id` (adapter uuid) — NOT `authUserId`. `MeshRadio.userId` is the same namespace (verified: `src/entities/mesh-radio.ts:66`).
- Deploy ONLY via GitHub Actions `deploy.yml`. Local tooling only builds+pushes to ECR. Before releasing from this worktree: `cp` the repo-root `env.local.sh` from the main checkout (`/Users/khundeck/working/defcon.run.34/env.local.sh`) into the worktree root — a missing file kills the release at the S3 sync step.
- The user has explicitly authorized autonomous PR merge and deploy for this plan (conversation 2026-07-30). Merge the feature PR and Release PR without further confirmation; still record everything in PR descriptions.
- Con days are SIX Pacific dates 2026-08-05..2026-08-10 (Wed–Mon); the streak table `[0,25,50,100,500]` caps at 4+ active days.
- meshtk code changes go to `~/working/meshtk` (upstream), NEVER edited directly in `apps/run.mqtt/meshtk` (vendor snapshot) — `feedback_meshtk_upstream`.

---

### Task 1: Con-day + streak constants module (run.human)

run.human has no con-day model (it lives in run.gpx). Create a minimal local mirror plus the streak table.

**Files:**
- Create: `apps/run.human/webapp/src/lib/con-days.ts`
- Test: `apps/run.human/webapp/src/lib/__tests__/con-days.test.ts`

**Interfaces:**
- Produces: `CON_DAYS: readonly string[]`, `conLocalDate(epochMs: number): string`, `isConDay(date: string): boolean`, `STREAK_POINTS: readonly number[]`, `streakPoints(days: number): number`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/con-days.test.ts
import { describe, it, expect } from "vitest";
import {
  CON_DAYS,
  conLocalDate,
  isConDay,
  streakPoints,
} from "../con-days";

describe("con-days", () => {
  it("has the six DC34 run days", () => {
    expect(CON_DAYS).toEqual([
      "2026-08-05", "2026-08-06", "2026-08-07",
      "2026-08-08", "2026-08-09", "2026-08-10",
    ]);
  });

  it("resolves con-local (PDT, UTC-7) dates across midnight", () => {
    // 2026-08-08T02:00Z is still Aug 7 in PDT.
    expect(conLocalDate(Date.parse("2026-08-08T02:00:00Z"))).toBe("2026-08-07");
    expect(conLocalDate(Date.parse("2026-08-08T12:00:00Z"))).toBe("2026-08-08");
  });

  it("isConDay accepts only the six dates", () => {
    expect(isConDay("2026-08-05")).toBe(true);
    expect(isConDay("2026-08-11")).toBe(false);
    expect(isConDay("")).toBe(false);
  });

  it("streakPoints is total-by-streak, capped at 4+ days", () => {
    expect(streakPoints(0)).toBe(0);
    expect(streakPoints(1)).toBe(25);
    expect(streakPoints(2)).toBe(50);
    expect(streakPoints(3)).toBe(100);
    expect(streakPoints(4)).toBe(500);
    expect(streakPoints(6)).toBe(500); // six possible con days, cap at 4
    expect(streakPoints(-1)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/con-days.test.ts`
Expected: FAIL — cannot resolve `../con-days`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/con-days.ts
/**
 * Con-day model for scoring (mirrors apps/run.gpx/webapp/src/lib/con-days.ts —
 * kept as a local copy because run.human cannot import across apps; if the con
 * dates ever change, change BOTH files). August 2026 is entirely PDT (UTC-7),
 * so a fixed offset is exact — same convention as lib/social-day.ts.
 */
export const CON_TZ_OFFSET_HOURS = -7;

/** DEF CON 34 run days — Wed Aug 5 through Mon Aug 10, 2026. */
export const CON_DAYS: readonly string[] = [
  "2026-08-05", "2026-08-06", "2026-08-07",
  "2026-08-08", "2026-08-09", "2026-08-10",
];

/** Epoch-ms instant → YYYY-MM-DD in con-local (PDT) time. */
export function conLocalDate(epochMs: number): string {
  return new Date(epochMs + CON_TZ_OFFSET_HOURS * 3_600_000)
    .toISOString()
    .slice(0, 10);
}

export function isConDay(date: string): boolean {
  return CON_DAYS.includes(date);
}

/**
 * Total-by-streak table (spec §streak tracks): a track's TOTAL is this value
 * indexed by distinct active con days. Six con days exist but the table caps
 * at 4+ — running 4, 5, or 6 days all land on 500.
 */
export const STREAK_POINTS: readonly number[] = [0, 25, 50, 100, 500];

export function streakPoints(days: number): number {
  const d = Math.max(0, Math.min(days, STREAK_POINTS.length - 1));
  return STREAK_POINTS[d];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/con-days.test.ts`
Expected: PASS (7 assertions across 4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/con-days.ts src/lib/__tests__/con-days.test.ts
git commit -m "feat(points): con-day constants + total-by-streak table for run.human"
```

---

### Task 2: `floorAfterMax` decay extension in `computePoints`

The phones need decay 200→100 over the first N solvers then FLAT floor forever; today `n > maxSolves` returns 0. Add an opt-in `floorAfterMax` knob.

**Files:**
- Modify: `apps/run.human/webapp/src/lib/ctf-scoring.ts` (ScoringConfig + computePoints)
- Modify: `apps/run.human/webapp/src/entities/qr.ts` (add `floorAfterMax` boolean attribute to the `Ctf` entity — a non-key attribute; run the key-parity test after)
- Modify: `apps/run.human/webapp/src/lib/ctf-judge.ts` (`narrowCtf` carries it through)
- Test: extend `apps/run.human/webapp/src/lib/__tests__/ctf-scoring.test.ts` (or the existing scoring test file — find it with `ls src/lib/__tests__ | grep scoring`; if none exists for ctf-scoring, create this path)

**Interfaces:**
- Produces: `ScoringConfig.floorAfterMax?: boolean`; `computePoints(n, cfg, now)` returns `cfg.pointFloor` (not 0) for `n > maxSolves` when set.

- [ ] **Step 1: Write the failing test** (append to the scoring test file)

```ts
it("floorAfterMax: over-cap solvers get the floor, not zero", () => {
  const cfg = { pointMax: 200, pointFloor: 100, maxSolves: 25, firstBloodBonus: 0, floorAfterMax: true };
  expect(computePoints(1, cfg)).toBe(200);
  expect(computePoints(25, cfg)).toBe(100);
  expect(computePoints(26, cfg)).toBe(100);   // floor forever
  expect(computePoints(500, cfg)).toBe(100);
  // default behavior unchanged:
  expect(computePoints(26, { ...cfg, floorAfterMax: undefined })).toBe(0);
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run <scoring test file>`. Expected: FAIL (26 → 0).

- [ ] **Step 3: Implement**

In `ctf-scoring.ts`, add to `ScoringConfig`:

```ts
  /**
   * When true, solvers beyond maxSolves get pointFloor instead of 0 — decay
   * runs over the first maxSolves solvers, then the value is flat forever.
   * Used by the DC34 payphone flags (200→100 over 25 solvers).
   */
  floorAfterMax?: boolean;
```

Change the first line of `computePoints`:

```ts
  if (n > ctf.maxSolves) return ctf.floorAfterMax ? ctf.pointFloor : 0;
```

In `entities/qr.ts`, add to the `Ctf` entity's attributes (next to `maxSolves`):

```ts
      floorAfterMax: { type: "boolean" },
```

In `ctf-judge.ts` `narrowCtf`: add `floorAfterMax?: boolean;` to the input row type and `floorAfterMax: row.floorAfterMax,` to the returned object.

- [ ] **Step 4: Run tests** — the scoring test file, plus `npx vitest run src/entities/__tests__/ctf-key-parity.test.ts` (non-key attribute must not change key shapes). Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(points): floorAfterMax decay knob (phones 200→100 then flat)"`

---

### Task 3: `ordinal` on CtfScoreEvent + judge writes it (incl. capped rows)

The engine re-values repeatable solves from their frozen ordinal; the event row must store it. Also: the capped paths currently `return` BEFORE `recordScoreEvent`, leaving ordinal-less rows the engine would mis-value — fix them to record fully.

**Files:**
- Modify: `apps/run.human/webapp/src/entities/ctf.ts` (CtfScoreEvent attributes + `CtfScoreEventItem`)
- Modify: `apps/run.human/webapp/src/lib/ctf-judge.ts` (`recordScoreEvent` signature + all 3 call sites + capped paths)
- Test: `apps/run.human/webapp/src/lib/__tests__/ctf-judge.test.ts` (extend the in-memory fake)

**Interfaces:**
- Produces: `CtfStore.recordScoreEvent` gains required `ordinal: number`; every repeatable/wordlist/single-use-OTP path (including capped) records `{ordinal, points}`.

- [ ] **Step 1: Write the failing test** (append to ctf-judge.test.ts, using its existing in-memory store fake — extend the fake's `recordScoreEvent` to capture its args)

```ts
it("records ordinal on repeatable score events, including capped ones", async () => {
  // Use the test file's existing makeStore/fake helpers; flag: repeatable
  // (perPlayerIntervalHours 24), globalMax 1 so the SECOND solver is capped.
  // Solve once with user A (ordinal 1, points > 0), once with user B
  // (ordinal 2, capped -> points 0). Assert BOTH recorded events carry
  // {ordinal: 1|2} and the capped one has points 0.
});
```

Write it concretely against the fake in that file (read the file's existing helpers first; the fake store is a Map-based object near the top). The assertion shape:

```ts
expect(recorded[0]).toMatchObject({ ordinal: 1 });
expect(recorded[1]).toMatchObject({ ordinal: 2, points: 0 });
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/__tests__/ctf-judge.test.ts`

- [ ] **Step 3: Implement**

`entities/ctf.ts` — CtfScoreEvent attributes, next to `points`:

```ts
      // The global solve ordinal allocated for this event (frozen history; the
      // derived scoring engine re-values from it). Absent on pre-DC34 rows.
      ordinal: { type: "number" },
```

Add `ordinal?: number;` to `CtfScoreEventItem`.

`ctf-judge.ts`:
1. `CtfStore.recordScoreEvent` args gain `ordinal: number`.
2. `defaultStore.recordScoreEvent` sets it: `.set({ points, ordinal, tierCeiling, channel })`.
3. Wordlist finalize (~line 458-474), single-use OTP finalize (~489-518), repeatable finalize (~527-572): pass `ordinal: n`, and change each capped early-return so it FIRST records the event. Pattern for each of the three (shown for the repeatable one; apply identically to all three):

```ts
      const n = await store.allocateOrdinal(challenge);
      if ((ctf.globalMax ?? 0) > 0 && n > (ctf.globalMax as number)) {
        if (store.recordScoreEvent) {
          await store.recordScoreEvent({ challenge, user, bucket, ordinal: n, points: 0, tierCeiling: activeTierCeiling(now, ctf.timeTiers) ?? ctf.pointMax, channel });
        }
        log(ctfJudgeLog({ challenge, result: "capped" }));
        return { solved: true, points: 0, ordinal: n, firstBlood: false, capped: true };
      }
```

(For the wordlist/single-use paths the bucket is `codeHash`/`otpHash` respectively — but NOTE: on those two paths no row was pre-created, and `recordScoreEvent` is an upsert, so recording the capped event is safe there too.)

- [ ] **Step 4: Run tests** — `npx vitest run src/lib/__tests__/ctf-judge.test.ts`. Expected: PASS (update the fake's recordScoreEvent signature; other existing tests must still pass).

- [ ] **Step 5: Commit** — `git commit -m "feat(points): store solve ordinal on CtfScoreEvent, record capped events"`

---

### Task 4: The pure scoring engine

**Files:**
- Create: `apps/run.human/webapp/src/lib/scoring-engine.ts`
- Test: `apps/run.human/webapp/src/lib/__tests__/scoring-engine.test.ts`

**Interfaces:**
- Consumes: `computePoints`, `activeTierCeiling` from `./ctf-scoring`; `conLocalDate`, `isConDay`, `streakPoints` from `./con-days`.
- Produces:

```ts
export type EngineAccomplishment = { source: "checkin" | "gpx" | "strava"; completedAt: number };
export type EngineSolve = { challenge: string; ordinal?: number; solvedAt?: string };
export type EngineScoreEvent = { challenge: string; bucket: string; ordinal?: number; scoredAt?: string };
export type EngineCtfConfig = {
  challenge: string; pointMax?: number; pointFloor?: number; maxSolves?: number;
  firstBloodBonus?: number; floorAfterMax?: boolean; globalMax?: number;
  timeTiers?: { from: string; to: string; ceiling: number }[];
};
export interface UserScore {
  score: number;
  breakdown: { runStreak: number; socialStreak: number; ctfStreak: number; flagPoints: number };
  days: { run: number; social: number; ctf: number };
  counts: { checkin: number; gpx: number; strava: number; solves: number };
  latestActivityAt?: number;
}
export function computeUserScore(input: {
  accomplishments: EngineAccomplishment[];
  solves: EngineSolve[];
  events: EngineScoreEvent[];
  configs: Map<string, EngineCtfConfig>;
}): UserScore;
```

**Valuation rules (LOCKED — from the approved design conversation):**
- Run days: distinct con-local dates of accomplishments (all three sources — a check-in lights the day) that are con days.
- Social days: events with `challenge === "social-scan"`, day = `bucket.split("#")[0]`, must be a con day. Social-scan and jack-egg-legacy events are NEVER flag-valued here (`jack-egg` IS valued — it has a real Ctf row after the seed; only `social-scan` is excluded from flagPoints).
- Flag rows = all `solves` plus all `events` with `challenge !== "social-scan"`.
- Flag value: config missing → 0 (deleted flag = deleted points). With config `cfg`:
  - row has `ordinal`: `(cfg.globalMax > 0 && ordinal > cfg.globalMax) ? 0 : computePoints(ordinal, cfgWithDefaults, Date.parse(at) || 0)` where `cfgWithDefaults` fills `pointMax/pointFloor/maxSolves/firstBloodBonus` with 0 and passes `floorAfterMax`/`timeTiers` through.
  - row lacks `ordinal` (pre-DC34 legacy): `cfg.pointFloor ?? 0`.
- CTF days: distinct con-local dates of flag rows (whether valued 0 or not — a capped solve still lights the day), from `solvedAt`/`scoredAt`; non-con days light nothing.
- `score = streakPoints(runDays) + streakPoints(socialDays) + streakPoints(ctfDays) + sum(flagValues)`.
- `counts`: accomplishments by source; `solves` = flag-row count (solves + non-social events).
- `latestActivityAt` = max `completedAt` over accomplishments; `undefined` when there are none.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/__tests__/scoring-engine.test.ts
import { describe, it, expect } from "vitest";
import { computeUserScore } from "../scoring-engine";

const cfg = (over = {}) => ({
  challenge: "x", pointMax: 100, pointFloor: 100, maxSolves: 100000,
  firstBloodBonus: 0, ...over,
});
const noon = (d: string) => Date.parse(`${d}T19:00:00Z`); // noon PDT

describe("computeUserScore", () => {
  it("empty ledger scores 0", () => {
    const r = computeUserScore({ accomplishments: [], solves: [], events: [], configs: new Map() });
    expect(r.score).toBe(0);
    expect(r.days).toEqual({ run: 0, social: 0, ctf: 0 });
    expect(r.latestActivityAt).toBeUndefined();
  });

  it("run streak is total-by-streak over distinct con days; check-ins light days", () => {
    const r = computeUserScore({
      accomplishments: [
        { source: "gpx", completedAt: noon("2026-08-06") },
        { source: "gpx", completedAt: noon("2026-08-06") },      // same day, no extra
        { source: "checkin", completedAt: noon("2026-08-07") },   // check-in lights
        { source: "strava", completedAt: noon("2026-07-01") },    // not a con day
      ],
      solves: [], events: [], configs: new Map(),
    });
    expect(r.days.run).toBe(2);
    expect(r.breakdown.runStreak).toBe(50);
    expect(r.score).toBe(50);
    expect(r.counts).toMatchObject({ checkin: 1, gpx: 2, strava: 1 });
  });

  it("social days come from social-scan buckets and are worth 0 per scan", () => {
    const r = computeUserScore({
      accomplishments: [], solves: [],
      events: [
        { challenge: "social-scan", bucket: "2026-08-05#a#b", scoredAt: "2026-08-05T20:00:00Z" },
        { challenge: "social-scan", bucket: "2026-08-05#a#c", scoredAt: "2026-08-05T21:00:00Z" }, // same day
        { challenge: "social-scan", bucket: "2026-08-08#a#d", scoredAt: "2026-08-08T20:00:00Z" },
      ],
      configs: new Map(),
    });
    expect(r.days.social).toBe(2);
    expect(r.breakdown.socialStreak).toBe(50);
    expect(r.breakdown.flagPoints).toBe(0);
    expect(r.counts.solves).toBe(0); // social-scan rows are not flag solves
  });

  it("flag points re-value from ordinal against CURRENT config; missing config = 0", () => {
    const configs = new Map([
      ["phone", cfg({ challenge: "phone", pointMax: 200, pointFloor: 100, maxSolves: 25, floorAfterMax: true })],
    ]);
    const r = computeUserScore({
      accomplishments: [],
      solves: [
        { challenge: "phone", ordinal: 1, solvedAt: "2026-08-06T19:00:00Z" },
        { challenge: "deleted-flag", ordinal: 1, solvedAt: "2026-08-06T20:00:00Z" },
      ],
      events: [], configs,
    });
    expect(r.breakdown.flagPoints).toBe(200);
    expect(r.days.ctf).toBe(1);           // both solves same con day
    expect(r.breakdown.ctfStreak).toBe(25);
    expect(r.score).toBe(225);
  });

  it("legacy event rows without ordinal value at current pointFloor", () => {
    const configs = new Map([["goldstein-otp", cfg({ challenge: "goldstein-otp", pointMax: 25, pointFloor: 25 })]]);
    const r = computeUserScore({
      accomplishments: [], solves: [],
      events: [{ challenge: "goldstein-otp", bucket: "12345", scoredAt: "2026-08-05T19:00:00Z" }],
      configs,
    });
    expect(r.breakdown.flagPoints).toBe(25); // retuned from historical 100
  });

  it("over-globalMax ordinals value 0 but still light the ctf day", () => {
    const configs = new Map([["w", cfg({ challenge: "w", globalMax: 1 })]]);
    const r = computeUserScore({
      accomplishments: [], solves: [],
      events: [{ challenge: "w", bucket: "h1", ordinal: 2, scoredAt: "2026-08-05T19:00:00Z" }],
      configs,
    });
    expect(r.breakdown.flagPoints).toBe(0);
    expect(r.days.ctf).toBe(1);
  });

  it("latestActivityAt is the max accomplishment time", () => {
    const a = noon("2026-08-05"), b = noon("2026-08-07");
    const r = computeUserScore({
      accomplishments: [
        { source: "gpx", completedAt: a },
        { source: "checkin", completedAt: b },
      ],
      solves: [], events: [], configs: new Map(),
    });
    expect(r.latestActivityAt).toBe(b);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/__tests__/scoring-engine.test.ts`

- [ ] **Step 3: Implement**

```ts
// src/lib/scoring-engine.ts
/**
 * Derived scoring engine (points-consistency design, 2026-07-30). PURE — no
 * I/O, no entities. Values a user's ENTIRE ledger against CURRENT config:
 *   score = runStreak + socialStreak + ctfStreak + flagPoints
 * Solve ORDINALS are frozen history; solve VALUES are recomputed here, so a
 * config retune re-values everyone on their next rescore. The ONLY writer of
 * the result is lib/rescore.ts (enforced by scoring-write-invariant.test.ts).
 */
import { computePoints } from "./ctf-scoring";
import { conLocalDate, isConDay, streakPoints } from "./con-days";

export type EngineAccomplishment = {
  source: "checkin" | "gpx" | "strava";
  completedAt: number;
};
export type EngineSolve = { challenge: string; ordinal?: number; solvedAt?: string };
export type EngineScoreEvent = {
  challenge: string;
  bucket: string;
  ordinal?: number;
  scoredAt?: string;
};
export type EngineCtfConfig = {
  challenge: string;
  pointMax?: number;
  pointFloor?: number;
  maxSolves?: number;
  firstBloodBonus?: number;
  floorAfterMax?: boolean;
  globalMax?: number;
  timeTiers?: { from: string; to: string; ceiling: number }[];
};

export interface UserScore {
  score: number;
  breakdown: { runStreak: number; socialStreak: number; ctfStreak: number; flagPoints: number };
  days: { run: number; social: number; ctf: number };
  counts: { checkin: number; gpx: number; strava: number; solves: number };
  latestActivityAt?: number;
}

/** The one non-flag ledger challenge: scan events light social days, worth 0. */
const SOCIAL_CHALLENGE = "social-scan";

function flagValue(
  row: { challenge: string; ordinal?: number; at?: string },
  configs: Map<string, EngineCtfConfig>,
): number {
  const cfg = configs.get(row.challenge);
  if (!cfg) return 0; // deleted flag = deleted points (reactive by design)
  if (row.ordinal !== undefined && row.ordinal !== null) {
    if ((cfg.globalMax ?? 0) > 0 && row.ordinal > (cfg.globalMax as number)) return 0;
    return computePoints(
      row.ordinal,
      {
        pointMax: cfg.pointMax ?? 0,
        pointFloor: cfg.pointFloor ?? 0,
        maxSolves: cfg.maxSolves ?? 0,
        firstBloodBonus: cfg.firstBloodBonus ?? 0,
        floorAfterMax: cfg.floorAfterMax,
        timeTiers: cfg.timeTiers,
      },
      row.at ? Date.parse(row.at) || 0 : 0,
    );
  }
  // Pre-DC34 legacy row (no ordinal recorded): value at the current floor.
  return cfg.pointFloor ?? 0;
}

export function computeUserScore(input: {
  accomplishments: EngineAccomplishment[];
  solves: EngineSolve[];
  events: EngineScoreEvent[];
  configs: Map<string, EngineCtfConfig>;
}): UserScore {
  const { accomplishments, solves, events, configs } = input;

  // ── Run track: any accomplishment (run OR check-in) lights its con day. ──
  const runDays = new Set<string>();
  const counts = { checkin: 0, gpx: 0, strava: 0, solves: 0 };
  let latestActivityAt: number | undefined;
  for (const a of accomplishments) {
    counts[a.source] += 1;
    if (latestActivityAt === undefined || a.completedAt > latestActivityAt) {
      latestActivityAt = a.completedAt;
    }
    const day = conLocalDate(a.completedAt);
    if (isConDay(day)) runDays.add(day);
  }

  // ── Social track: scan-day events light days; individual scans worth 0. ──
  const socialDays = new Set<string>();
  const flagRows: { challenge: string; ordinal?: number; at?: string }[] = [];
  for (const e of events) {
    if (e.challenge === SOCIAL_CHALLENGE) {
      const day = e.bucket.split("#")[0];
      if (isConDay(day)) socialDays.add(day);
      continue;
    }
    flagRows.push({ challenge: e.challenge, ordinal: e.ordinal, at: e.scoredAt });
  }
  for (const s of solves) {
    flagRows.push({ challenge: s.challenge, ordinal: s.ordinal, at: s.solvedAt });
  }

  // ── CTF track: every admitted flag row (even valued 0) lights its day. ──
  const ctfDays = new Set<string>();
  let flagPoints = 0;
  for (const row of flagRows) {
    counts.solves += 1;
    flagPoints += flagValue(row, configs);
    if (row.at) {
      const t = Date.parse(row.at);
      if (!Number.isNaN(t)) {
        const day = conLocalDate(t);
        if (isConDay(day)) ctfDays.add(day);
      }
    }
  }

  const breakdown = {
    runStreak: streakPoints(runDays.size),
    socialStreak: streakPoints(socialDays.size),
    ctfStreak: streakPoints(ctfDays.size),
    flagPoints,
  };
  return {
    score: breakdown.runStreak + breakdown.socialStreak + breakdown.ctfStreak + breakdown.flagPoints,
    breakdown,
    days: { run: runDays.size, social: socialDays.size, ctf: ctfDays.size },
    counts,
    latestActivityAt,
  };
}
```

- [ ] **Step 4: Run tests** — Expected: PASS all 7.

- [ ] **Step 5: Commit** — `git commit -m "feat(points): pure derived scoring engine (streaks + flag revaluation)"`

---

### Task 5: RunUser score fields + `rescoreUser`

**Files:**
- Modify: `apps/run.human/webapp/src/entities/run-user.ts` (new attributes, next to `activityScore` ~line 129)
- Create: `apps/run.human/webapp/src/lib/rescore.ts`
- Test: `apps/run.human/webapp/src/lib/__tests__/rescore.test.ts`

**Interfaces:**
- Consumes: `computeUserScore` (Task 4); `getAccomplishmentsByUser` (`@/entities/accomplishment`); `CtfSolve.query.byUser` / `CtfScoreEvent.query.byUser` (`@/entities/ctf`); `listCtf` (`@/lib/qr-admin`).
- Produces: `rescoreUser(userId: string): Promise<UserScore>`; `rescoreBestEffort(userId: string): Promise<void>` (never throws); RunUser attributes `score`, `scoreBreakdown`, `streakDays`, `rescoredAt`.

- [ ] **Step 1: Add the RunUser attributes** (schema change first — no test possible without it)

In `entities/run-user.ts`, after the `latestActivityAt` attribute (~line 144):

```ts
      // ── Derived score (points-consistency, 2026-07-30). Written ONLY by
      // lib/rescore.ts:rescoreUser — the single mutation point for ALL score
      // fields. score = runStreak + socialStreak + ctfStreak + flagPoints,
      // recomputed from ledgers (Accomplishment, CtfSolve, CtfScoreEvent)
      // against current Ctf config. activityScore/ctfScore/socialScore above
      // are LEGACY (frozen; socialScore still ticks as a cosmetic scan meter).
      score: {
        type: "number",
        default: () => 0,
      },
      scoreBreakdown: {
        type: "map",
        properties: {
          runStreak: { type: "number", default: () => 0 },
          socialStreak: { type: "number", default: () => 0 },
          ctfStreak: { type: "number", default: () => 0 },
          flagPoints: { type: "number", default: () => 0 },
        },
      },
      streakDays: {
        type: "map",
        properties: {
          run: { type: "number", default: () => 0 },
          social: { type: "number", default: () => 0 },
          ctf: { type: "number", default: () => 0 },
        },
      },
      rescoredAt: {
        type: "number",
      },
```

Also add `score?: number; scoreBreakdown?: {...}; streakDays?: {...}; rescoredAt?: number;` to the `RunUserItem` type at the bottom of the file (mirror the existing optional-field style).

- [ ] **Step 2: Write the rescore module**

```ts
// src/lib/rescore.ts
/**
 * rescoreUser — the ONLY code path that writes RunUser score fields
 * (enforced by scoring-write-invariant.test.ts). Loads the user's full
 * ledger, values it with the pure engine, writes the result in one patch.
 * Idempotent; last-write-wins (a concurrent rescore computes the same or
 * newer truth). SERVER-ONLY.
 */
import { RunUser } from "@/entities/run-user";
import { getAccomplishmentsByUser } from "@/entities/accomplishment";
import { CtfSolve, CtfScoreEvent } from "@/entities/ctf";
import { listCtf } from "@/lib/qr-admin";
import {
  computeUserScore,
  type EngineCtfConfig,
  type UserScore,
} from "./scoring-engine";

export async function rescoreUser(userId: string): Promise<UserScore> {
  const [accomplishments, solvesResult, eventsResult, ctfRows] =
    await Promise.all([
      getAccomplishmentsByUser(userId),
      CtfSolve.query.byUser({ user: userId }).go({ pages: "all" }),
      CtfScoreEvent.query.byUser({ user: userId }).go({ pages: "all" }),
      listCtf(),
    ]);

  const configs = new Map<string, EngineCtfConfig>(
    ctfRows.map((r) => [r.challenge, r as EngineCtfConfig]),
  );

  const result = computeUserScore({
    accomplishments: accomplishments.map((a) => ({
      source: a.source,
      completedAt: a.completedAt,
    })),
    solves: solvesResult.data.map((s) => ({
      challenge: s.challenge,
      ordinal: s.ordinal,
      solvedAt: s.solvedAt,
    })),
    events: eventsResult.data.map((e) => ({
      challenge: e.challenge,
      bucket: e.bucket,
      ordinal: (e as { ordinal?: number }).ordinal,
      scoredAt: e.scoredAt,
    })),
    configs,
  });

  await RunUser.patch({ userId })
    .set({
      score: result.score,
      scoreBreakdown: result.breakdown,
      streakDays: result.days,
      activityCounts: {
        checkin: result.counts.checkin,
        gpx: result.counts.gpx,
        strava: result.counts.strava,
      },
      ctfSolves: result.counts.solves,
      ...(result.latestActivityAt !== undefined
        ? { latestActivityAt: result.latestActivityAt }
        : {}),
      rescoredAt: Date.now(),
    })
    .go();

  return result;
}

/** Fire-and-forget wrapper: a scoring hiccup must never fail the user action. */
export async function rescoreBestEffort(userId: string): Promise<void> {
  try {
    await rescoreUser(userId);
  } catch (err) {
    console.error(`[rescore] failed for ${userId}`, err);
  }
}
```

- [ ] **Step 3: Write the test** — `rescore.ts` is thin I/O glue; test the one piece of logic (latestActivityAt omission) indirectly via a typecheck + the engine tests. Concretely: run `npx tsc --noEmit` (the webapp's typecheck) and `npx vitest run src/lib/__tests__/scoring-engine.test.ts`. Both must pass. (No new unit test file for rescore.ts — its correctness is the engine's, and the wiring is exercised by the invariant test in Task 11 and prod backfill in Task 15.) Delete the planned `__tests__/rescore.test.ts` from this task's file list if writing it adds no value beyond the typecheck.

- [ ] **Step 4: Commit** — `git commit -m "feat(points): RunUser derived-score fields + rescoreUser single writer"`

---

### Task 6: De-score the judge (remove accrue/reaccrue + admin re-score; add `grant`)

**Files:**
- Modify: `apps/run.human/webapp/src/lib/ctf-judge.ts`
- Test: `apps/run.human/webapp/src/lib/__tests__/ctf-judge.test.ts`

**Interfaces:**
- Produces: `CtfStore` WITHOUT `accrue`/`reaccrue`; `judgeSolve` input gains `grant?: boolean` (server-callers only — skips answer validation, all other gates still run); `JudgeResult` unchanged (points still computed for display).
- Consumers (Tasks 7-10) call `rescoreBestEffort` after a `solved: true` result — the judge itself never touches RunUser.

- [ ] **Step 1: Update tests first**

In `ctf-judge.test.ts`:
- Remove `accrue`/`reaccrue` from the in-memory fake and every assertion that counts accrued points.
- Delete the admin re-score test(s) (search `re-score` / `reaccrue` / `admin` in the file).
- Add a grant test:

```ts
it("grant skips answer validation but still claims once-ever", async () => {
  // static flag, wrong/absent guess, grant: true → solved with ordinal 1
  const r1 = await judgeSolve({ user: "u1", challenge: "c", channel: "qr", grant: true }, { store, now });
  expect(r1.solved).toBe(true);
  expect(r1.ordinal).toBe(1);
  // replay: same user grants again → prior award echoed, no new ordinal
  const r2 = await judgeSolve({ user: "u1", challenge: "c", channel: "qr", grant: true }, { store, now });
  expect(r2.ordinal).toBe(1);
});
it("grant does NOT bypass the enabled gate", async () => {
  // disabled flag + grant → NON_SOLVE
});
```

- [ ] **Step 2: Run to verify failures** — `npx vitest run src/lib/__tests__/ctf-judge.test.ts`

- [ ] **Step 3: Implement in `ctf-judge.ts`**

1. Delete `accrue` and `reaccrue` from the `CtfStore` interface AND from `defaultStore` (lines ~187-195, ~802-806, ~922-928).
2. Delete every `await store.accrue({ user, points });` call (5 sites: wordlist ~471, single-use ~515, repeatable ~567, static ~640 — grep `store.accrue`).
3. Delete the ADMIN OVERRIDE block in the failed-claim branch (~lines 582-607, the `if (admin && prior && prior.ordinal >= 1)` block) — an already-solved static flag now ALWAYS returns the frozen prior shape (values are re-derived at rescore time, so re-scoring-in-place is obsolete). Keep the `admin` input solely for the attempt-cap bypass; update the doc comment on the `admin` field accordingly.
4. Add to the input type: `grant?: boolean;` with doc:

```ts
    /**
     * SERVER-CALLER grant (points-consistency): skip step-4 answer validation
     * and admit the solve directly. Used ONLY by server-side routes that have
     * already proven entitlement out-of-band (ghost unlock, jack-egg gesture,
     * admin exceptional-run). All OTHER gates (enabled, unlockAfter,
     * scoreWindow, claims/ordinals) still apply. NEVER derivable from user
     * input.
     */
    grant?: boolean;
```

5. In step 4, wrap validation:

```ts
    let ok: boolean;
    if (input.grant) {
      ok = true; // server-granted; claims below still dedupe
    } else if (ctf.answerType === "otp") {
      ...
```

(Grant is only used with static flags; the wordlist `codeHash` computation above it is unreachable for grant callers because grant flags are `answerType: "static"` — leave the codeHash line as-is.)
6. Also skip the attempt-cap for grant callers: change `if (!admin) {` to `if (!admin && !input.grant) {`.

- [ ] **Step 4: Run the full judge suite + typecheck**

Run: `npx vitest run src/lib/__tests__/ctf-judge.test.ts && npx tsc --noEmit`
Expected: judge tests PASS. `tsc` will FAIL in downstream callers if any reference `accrue` — grep `accrue` across `src/`; the ONLY remaining hits must be in comments. Fix stragglers.

- [ ] **Step 5: Commit** — `git commit -m "feat(points): judge admits events only — accrue/reaccrue/admin-rescore removed, grant added"`

---

### Task 7: Wire rescore into CTF front doors + activity paths

**Files:**
- Modify: `apps/run.human/webapp/src/app/(ctf)/ctf/claim/page.tsx` (after each `judgeSolve`/`claimPending` call that can return solved — ~lines 105-144)
- Modify: `apps/run.human/webapp/src/app/(ctf)/assets/theme/route.ts` (~line 100)
- Modify: `apps/run.human/webapp/src/entities/accomplishment.ts` (`createAccomplishment` ~line 339, `deleteAccomplishment` ~line 383)
- Modify: `apps/run.human/webapp/src/entities/run-user.ts` (delete `activityDelta` + `updateRunUserActivityCounts`, ~lines 349-437, and their test file `run-user-activity.test.ts` if present)
- Modify: `apps/run.human/webapp/src/app/api/admin/users/[userId]/recalculate/route.ts` (add rescore after the gpx proxy)

**Interfaces:**
- Consumes: `rescoreBestEffort` from `@/lib/rescore` (Task 5).

- [ ] **Step 1: Accomplishment paths.** In `entities/accomplishment.ts`: replace both `updateRunUserActivityCounts(...)` calls with `await rescoreBestEffort(userId);` (import `{ rescoreBestEffort } from "@/lib/rescore"`; remove the `updateRunUserActivityCounts` import). The create-path call replaces the block at ~339-344; the delete-path call replaces ~383-388. `metadata.points` keeps being written (harmless audit trail; the engine ignores it — add a one-line comment saying so on `CreateAccomplishmentInput.points`).

- [ ] **Step 2: Delete the old rollup writers.** In `entities/run-user.ts` delete `activityDelta` and `updateRunUserActivityCounts` (~lines 349-437). Delete their unit test file (`find src -name "run-user-activity*"`). Grep `updateRunUserActivityCounts` — zero remaining references.

- [ ] **Step 3: CTF front doors.** In `claim/page.tsx`: after every await of `judgeSolve(...)` or `claimPending(...)` whose result is used (there are 3-4 sites, ~lines 105-144), when `result.solved === true` fire `await rescoreBestEffort(playerId)` where `playerId` is the same `session.user.id` value passed as `user`. In `assets/theme/route.ts` (~line 100-105): same pattern after its `judgeSolve` call (the route already has the session/user in scope; skip rescore entirely for the anon/decoy path).

- [ ] **Step 4: Recalculate route.** In `app/api/admin/users/[userId]/recalculate/route.ts`, after the successful gpx-reconcile proxy call and before the response: `await rescoreBestEffort(userId);` (the reconcile's own accomplishment writes each fire rescore too, but the explicit call covers the zero-change case where config was retuned).

- [ ] **Step 5: Verify + commit**

Run: `npx tsc --noEmit && npx vitest run` (full webapp suite — accomplishment/checkin tests must still pass; update any test asserting `updateRunUserActivityCounts` calls to assert `rescoreBestEffort` was invoked instead, by mocking `@/lib/rescore`).

```bash
git commit -m "feat(points): rescore fires from accomplishment writes and CTF front doors"
```

---

### Task 8: De-score the social path (scan = day-light only; jack-egg via judge)

**Files:**
- Modify: `apps/run.human/webapp/src/lib/social-scan.ts`
- Modify: `apps/run.human/webapp/src/app/api/social-scan/route.ts`
- Modify: `apps/run.human/webapp/src/app/api/social-egg/route.ts`
- Test: `apps/run.human/webapp/src/lib/__tests__/social-scan.test.ts` (find exact name with `ls src/lib/__tests__ | grep social`)

**Interfaces:**
- Produces: `ScanResult` ok-variant gains `ownerId: string`; `ScanStore.award(userId, social)` loses the ctf param (cosmetic socialScore meter only); ledger rows written with `points: 0`; `claimEgg` deleted from social-scan.ts (route uses judge).

- [ ] **Step 1: Update social-scan tests** — award assertions drop the ctf argument; ledger assertions expect `points: 0`; ok-results assert `ownerId`. Delete `claimEgg` tests.

- [ ] **Step 2: Run to verify failures.**

- [ ] **Step 3: Implement `social-scan.ts`**

- Delete constants `SCAN_SOCIAL_POINTS/SCAN_CTF_POINTS/EGG_SOCIAL_POINTS/EGG_CTF_POINTS`; keep `DAILY_SCAN_CAP` (now pure abuse throttling — update the module doc comment: scans award 0 points; scan-day ledger rows light social streak days, valued by lib/scoring-engine).
- `ScanStore.award` becomes `award(userId: string, social: number): Promise<void>` — implementation `RunUser.patch({ userId }).add({ socialScore: social }).go();` (the cosmetic meter that drives the whoami QR rank bands; NOT part of `score`).
- In `judgeScan`, the award block becomes:

```ts
  const bucket = `${day}#${pk}`;
  try {
    const scanner = await store.getUser(scannerId);
    await Promise.all([
      store.award(scannerId, 1),
      store.award(owner.userId, 1),
      store.ledger("social-scan", scannerId, bucket, 0),
      store.ledger("social-scan", owner.userId, bucket, 0),
    ]);
    const scannerOld = scanner?.socialScore ?? 0;
    const ownerOld = owner.socialScore ?? 0;
    await Promise.all([
      store.scoreDelta(scannerOld, scannerOld + 1),
      store.scoreDelta(ownerOld, ownerOld + 1),
    ]);
  } catch (err) {
    console.error("[social-scan] partial award failure (pair claimed)", err);
  }

  return {
    ok: true,
    ownerId: owner.userId,
    ownerName: owner.displayName || "a runner",
    remainingToday: Math.max(0, DAILY_SCAN_CAP - count),
  };
```

- Add `ownerId: string;` to the ok variant of `ScanResult`.
- Delete `claimEgg`, `EggResult`, and `claimEggOnce` from the store type + defaultScanStore (the SocialEgg entity itself stays; unused rows are harmless history).

- [ ] **Step 4: Routes**

`app/api/social-scan/route.ts` — after a `result.ok` response from `judgeScan`, before returning:

```ts
  if (result.ok) {
    await Promise.all([
      rescoreBestEffort(scannerId),
      rescoreBestEffort(result.ownerId),
    ]);
  }
```

(import `rescoreBestEffort`; `scannerId` is the route's existing session-derived id).

`app/api/social-egg/route.ts` — replace the `claimEgg` call with the judge:

```ts
  const result = await judgeSolve(
    { user: userId, challenge: "jack-egg", channel: "qr", grant: true },
    {},
  );
  if (!result.solved || result.ordinal === null) {
    return NextResponse.json({ ok: false, code: "already" }, { status: 409 });
  }
  await rescoreBestEffort(userId);
  return NextResponse.json({ ok: true, points: result.points });
```

Preserve the route's existing auth + `assertNotLockedLive` gating and its response Content-Type conventions (read the file first; keep its existing "already" semantics: the judge replay returns `solved: true` with the PRIOR ordinal — to distinguish first-claim from replay, check the judge result's `ordinal` against a fresh claim by reading the route's previous behavior; simplest correct rule: first call per user returns ok, replays return ok too with the same points — idempotent-ok is acceptable, drop the 409 branch and always return `{ ok: true, points: result.points }` when solved, `{ ok: false }` when NON_SOLVE (flag missing/disabled)).

- [ ] **Step 5: Run tests + typecheck, commit**

`npx vitest run && npx tsc --noEmit`

```bash
git commit -m "feat(points): social scans light streak days only; jack-egg through the judge"
```

---

### Task 9: Ghost unlock-award internal endpoint

**Files:**
- Create: `apps/run.human/webapp/src/app/api/internal/ctf/unlock-award/route.ts`
- Test: `apps/run.human/webapp/src/app/api/internal/ctf/__tests__/unlock-award.test.ts` (only if sibling internal routes have tests — check `find src/app/api/internal -name "*.test.*"`; if none, skip the test file and rely on the gate test below being exercised in Task 14's full verification)

**Interfaces:**
- Consumes: `judgeSolve` grant (Task 6), `rescoreBestEffort` (Task 5), `MeshRadio` entity (`@/entities/mesh-radio` — keyed `{ nodeId }`, owner field `userId`), `config.auth.internalSecret` gate (pattern: `api/internal/ctf/mint/route.ts:31-35`).
- Produces: `POST /api/internal/ctf/unlock-award` body `{ghost: "ghost.goldstein", node: "!aabbccdd"}` → 200 `{solved, points}`; 403 bad secret; 404 unknown radio/unowned; 422 non-awardable ghost. Challenge naming: `unlock-<last dot segment of ghost id>` (`ghost.goldstein` → `unlock-goldstein`).

- [ ] **Step 1: Implement the route**

```ts
// src/app/api/internal/ctf/unlock-award/route.ts
import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config";
import { MeshRadio } from "@/entities/mesh-radio";
import { judgeSolve } from "@/lib/ctf-judge";
import { rescoreBestEffort } from "@/lib/rescore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Internal API: admit a bot-unlock solve (points-consistency, 2026-07-30).
 *
 * Called by the meshtk fleet (x-internal-secret, same contract as ../mint)
 * when a radio passes a ghost's TOTP unlock. Maps the radio's nodeId to its
 * owning RunUser and grants the ghost's `unlock-<name>` flag through the
 * judge (grant: static once-ever claim → repeat unlocks replay, never
 * double-award). A missing/disabled unlock flag or unowned radio awards
 * nothing — the mesh flow is unaffected either way.
 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-internal-secret");
  if (!secret || secret !== config.auth.internalSecret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let ghost = "";
  let node = "";
  try {
    const body = await req.json();
    ghost = typeof body?.ghost === "string" ? body.ghost : "";
    node = typeof body?.node === "string" ? body.node : "";
  } catch {
    /* fall through to 400 */
  }
  if (!ghost || !node) {
    return NextResponse.json({ error: "Missing ghost/node" }, { status: 400 });
  }

  const name = ghost.split(".").pop() ?? "";
  if (!name) {
    return NextResponse.json({ error: "Unawardable" }, { status: 422 });
  }

  const radio = await MeshRadio.get({ nodeId: node.toLowerCase() }).go();
  const userId = radio.data?.userId;
  if (!userId) {
    return NextResponse.json({ error: "Unknown radio" }, { status: 404 });
  }

  const result = await judgeSolve(
    { user: userId, challenge: `unlock-${name}`, channel: "qr", grant: true },
    {},
  );
  if (result.solved) {
    await rescoreBestEffort(userId);
  }
  return NextResponse.json(
    { solved: result.solved, points: result.points },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
```

Before committing, verify the MeshRadio export name and get-key shape by reading `src/entities/mesh-radio.ts` (the entity is keyed by `nodeId`, ElectroDB lowercases composites — hence `.toLowerCase()`).

- [ ] **Step 2: Typecheck + commit**

`npx tsc --noEmit`

```bash
git commit -m "feat(points): internal unlock-award endpoint (mesh ghost unlock = 250)"
```

---

### Task 10: Admin exceptional-run award (endpoint + console button)

**Files:**
- Create: `apps/run.human/webapp/src/app/api/admin/ctf-award/route.ts`
- Modify: `apps/run.human/webapp/src/app/(protected)/admin/AdminConsole.tsx` (next to the existing "Recalculate score" button, ~line 313-329)

**Interfaces:**
- Consumes: admin gate pattern from `app/api/admin/ctf-leaderboard/route.ts` (requireAdmin + revalidateAdmin, bare-404 denials); `judgeSolve` grant; `rescoreBestEffort`.
- Produces: `POST /api/admin/ctf-award` body `{userId}` → grants `exceptional-run` (repeatable daily — the seeded row has `perPlayerIntervalHours: 24`, so a same-day double-click replays as NON_SOLVE, a next-day award works).

- [ ] **Step 1: Implement the route** (read `app/api/admin/ctf-leaderboard/route.ts` first and mirror its exact gate imports/sequence):

```ts
// src/app/api/admin/ctf-award/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin } from "@/lib/admin-gate";
import { judgeSolve } from "@/lib/ctf-judge";
import { rescoreBestEffort } from "@/lib/rescore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response(null, { status: 404 });

/** The ONLY grantable challenge from this route — never caller-chosen. */
const AWARDABLE = "exceptional-run";

export async function POST(req: NextRequest) {
  const session = await auth();
  const gate = requireAdmin(session);
  if (!gate.ok) return NOT_FOUND();
  const authUserId = session?.user?.authUserId;
  if (!authUserId || !(await revalidateAdmin(authUserId))) return NOT_FOUND();

  let userId = "";
  try {
    const body = await req.json();
    userId = typeof body?.userId === "string" ? body.userId : "";
  } catch {
    /* 400 below */
  }
  if (!userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  }

  const result = await judgeSolve(
    { user: userId, challenge: AWARDABLE, channel: "qr", grant: true },
    {},
  );
  if (result.solved && result.points > 0) {
    await rescoreBestEffort(userId);
    return NextResponse.json({ ok: true, points: result.points });
  }
  // Repeat same-day award (repeatable window collision) or disabled flag.
  return NextResponse.json({ ok: false, reason: "not-awarded" }, { status: 409 });
}
```

(If `requireAdmin`'s actual export name differs — some admin routes use `requireGroups(session, ADMIN_GROUPS)` — mirror whatever `ctf-leaderboard/route.ts` uses verbatim.)

- [ ] **Step 2: Console button.** Read `AdminConsole.tsx` around the Recalculate button (~313-329) and add a sibling button in the same per-user action group, matching its exact styling/handler pattern:

```tsx
<Button
  size="sm"
  color="warning"
  variant="flat"
  onPress={() => awardExceptional(user.userId)}
>
  🏅 Exceptional run +1000
</Button>
```

with the handler beside the existing recalculate handler:

```tsx
const awardExceptional = async (userId: string) => {
  const res = await fetch("/use1/api/admin/ctf-award", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  // Reuse the console's existing toast/notify mechanism for success/failure —
  // mirror exactly what the recalculate handler does with its response.
};
```

IMPORTANT: mirror the recalculate handler's fetch base path exactly (it may use a relative path or a basePath helper — copy it, don't hardcode `/use1`).

- [ ] **Step 3: Typecheck, lint, commit**

`npx tsc --noEmit`

```bash
git commit -m "feat(points): admin exceptional-run award (+1000) endpoint and console button"
```

---

### Task 11: Read side + invariant test + unsolve simplification + rescore-all

**Files:**
- Modify: `apps/run.human/webapp/src/lib/leaderboard-scoring.ts`
- Modify: `apps/run.human/webapp/src/lib/ctf-unsolve-store.ts` (+ its pure sibling `src/lib/ctf-unsolve.ts` and callers in `app/api/admin/ctf-leaderboard/route.ts`)
- Create: `apps/run.human/webapp/src/app/api/admin/rescore-all/route.ts`
- Create: `apps/run.human/webapp/src/lib/__tests__/scoring-write-invariant.test.ts`
- Test: existing `leaderboard-scoring` test file (extend)

- [ ] **Step 1: leaderboard-scoring.** Add `score?: number;` to `ScorableUser` and change `globalScore`:

```ts
/**
 * Read-time global score. The derived `score` field (points-consistency,
 * written only by rescoreUser) wins; rows not yet rescored (created before
 * the one-time backfill ran) fall back to the legacy activity+ctf sum.
 */
export function globalScore(u: ScorableUser): number {
  return u.score ?? (u.activityScore ?? 0) + (u.ctfScore ?? 0);
}
```

Extend the module's test: `expect(globalScore({ score: 725, activityScore: 3, ctfScore: 9 })).toBe(725);` and `expect(globalScore({ activityScore: 3, ctfScore: 9 })).toBe(12);`.

- [ ] **Step 2: Unsolve simplification.** In `ctf-unsolve-store.ts`: after the row deletions (CtfSolve/CtfScoreEvent/CtfAttempt), replace the manual `RunUser.patch().set({ ctfScore: ..., ctfSolves: ... })` recomputation with `await rescoreUser(userId)` for each affected user. Delete the now-dead arithmetic helpers in `ctf-unsolve.ts` (`sumPoints` and the score-subtraction path) IF nothing else imports them (grep first); keep the row-selection logic and the sole-solver `Ctf.solveCount` reset. Update the unsolve tests accordingly (they assert score math today; they should now assert rescore was called per user — mock `@/lib/rescore`).

- [ ] **Step 3: rescore-all route.**

```ts
// src/app/api/admin/rescore-all/route.ts
import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin } from "@/lib/admin-gate";
import { scanAllRunUsers } from "@/entities/run-user";
import { rescoreUser } from "@/lib/rescore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NOT_FOUND = () => new Response(null, { status: 404 });

/**
 * POST /api/admin/rescore-all — bulk rescore every RunUser against current
 * config. Run after a seed/config retune (values are derived, so a retune is
 * invisible until each user rescores). Concurrency-limited; failures are
 * counted, not fatal. Event-scale table (hundreds of rows) — same full-scan
 * rationale as scanAllRunUsers.
 */
export async function POST() {
  const session = await auth();
  const gate = requireAdmin(session);
  if (!gate.ok) return NOT_FOUND();
  const authUserId = session?.user?.authUserId;
  if (!authUserId || !(await revalidateAdmin(authUserId))) return NOT_FOUND();

  const users = await scanAllRunUsers();
  let ok = 0;
  let failed = 0;
  const CONCURRENCY = 5;
  for (let i = 0; i < users.length; i += CONCURRENCY) {
    const batch = users.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((u) => rescoreUser(u.userId)),
    );
    for (const r of results) r.status === "fulfilled" ? ok++ : failed++;
  }
  return Response.json({ total: users.length, ok, failed });
}
```

(Same gate-import caveat as Task 10 — mirror `ctf-leaderboard/route.ts` verbatim.)

- [ ] **Step 4: Invariant test** — source-scan style (same approach as the existing `ctf-reward-covert-invariant.test.ts`):

```ts
// src/lib/__tests__/scoring-write-invariant.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Points-consistency invariant: lib/rescore.ts is the ONLY module that writes
 * RunUser score fields. Award-time accrual must never come back.
 */
const SRC = join(__dirname, "..", "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });
}

describe("scoring write invariant", () => {
  const files = walk(SRC);

  it("only rescore.ts sets the derived score field", () => {
    const offenders = files.filter((p) => {
      if (p.endsWith("lib/rescore.ts")) return false;
      if (p.includes("entities/run-user.ts")) return false; // schema definition
      const src = readFileSync(p, "utf8");
      // any RunUser patch/update that mentions score:/scoreBreakdown/streakDays
      return /RunUser\s*\.\s*(patch|update|upsert)/.test(src) &&
        /(scoreBreakdown|streakDays|[^a-zA-Z]score\s*:)/.test(src);
    });
    expect(offenders).toEqual([]);
  });

  it("nothing accrues ctfScore anywhere anymore", () => {
    const offenders = files.filter((p) => {
      const src = readFileSync(p, "utf8");
      return /\.add\(\s*\{[^}]*ctfScore/.test(src);
    });
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 5: Run everything, commit**

`npx vitest run && npx tsc --noEmit`

```bash
git commit -m "feat(points): derived score on the board, uniform unsolve via rescore, rescore-all, write invariant"
```

---

### Task 12: DC34 seed builder + operator script

**Files:**
- Create: `apps/run.human/webapp/src/lib/ctf-seed-rows-dc34.ts`
- Create: `apps/run.human/webapp/scripts/seed-ctf-dc34.mts`
- Test: `apps/run.human/webapp/src/lib/__tests__/ctf-seed-rows-dc34.test.ts`

**Interfaces:**
- Produces: `buildDc34SeedRows(): Dc34SeedRow[]` where `Dc34SeedRow = CtfSeedRow & { knobsOnly?: boolean }` — `knobsOnly` rows update ONLY scoring knobs on an existing row and are SKIPPED (warn) if the row doesn't exist; full rows insert (preserving live `solveCount`/`createdAt`/`enabled` on re-seed, same WR-01 semantics as seed-ctf.mts).
- IMPORT-PURE like `ctf-seed-rows.ts` (no entity imports). Grant-only rows carry `answerHash: ZERO_HASH` (`"0".repeat(64)`) — no salted preimage exists, so they are claimable ONLY via `grant: true`, and the seed needs NO `CTF_ANSWER_SALT`.

**The DC34 value table (LOCKED — from the approved spec):**

| Rows | Kind | Knobs |
|---|---|---|
| `rainbow-egg` `coffee-egg` `deuce-egg` `sao-egg` `dc34-egg` | knobsOnly | flat 5 (`pointMax:5, pointFloor:5, maxSolves:100000, firstBloodBonus:0`) |
| `goldstein` `mudge` `condor` `grace-hopper` `turing` `ricky` | knobsOnly | flat 100 |
| `goldstein-otp` `mudge-otp` `condor-otp` `grace-hopper-otp` `turing-otp` | knobsOnly | flat 25 + `perPlayerIntervalHours: 24` |
| `didhtp1` `didhtp3234` `didhtp3283` `didhtp8283` | knobsOnly | `pointMax:200, pointFloor:100, maxSolves:25, firstBloodBonus:0, floorAfterMax:true` |
| `unlock-goldstein` `unlock-mudge` `unlock-condor` `unlock-grace-hopper` `unlock-turing` | full insert | flat 250, `answerType:"static"`, `answerHash: ZERO_HASH`, `enabled: true` |
| `jack-egg` | full insert | flat 10, `answerType:"static"`, `answerHash: ZERO_HASH`, `enabled: true` |
| `exceptional-run` | full insert | flat 1000, `perPlayerIntervalHours: 24`, `answerType:"static"`, `answerHash: ZERO_HASH`, `enabled: true` |

All rows get `maxAttempts: 5, rateLimitWindow: 60`. Grant-only inserts are `enabled: true` deliberately (unguessable answer, and the grant paths need them live without an admin round-trip). `ricky` knobsOnly: if no row named `ricky` exists at seed time, the script warns and skips — find ricky's real challenge slug with the admin CTF list before the prod run and adjust the constant if needed.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/ctf-seed-rows-dc34.test.ts
import { describe, it, expect } from "vitest";
import { buildDc34SeedRows, ZERO_HASH } from "../ctf-seed-rows-dc34";

describe("buildDc34SeedRows", () => {
  const rows = buildDc34SeedRows();
  const byName = new Map(rows.map((r) => [r.challenge, r]));

  it("emits the full DC34 set", () => {
    expect(rows).toHaveLength(23);
    expect(new Set(rows.map((r) => r.challenge)).size).toBe(23);
  });

  it("eggs are knobsOnly flat 5", () => {
    for (const c of ["rainbow-egg", "coffee-egg", "deuce-egg", "sao-egg", "dc34-egg"]) {
      expect(byName.get(c)).toMatchObject({ knobsOnly: true, pointMax: 5, pointFloor: 5 });
    }
  });

  it("phones decay 200→100 over 25 then floor forever", () => {
    expect(byName.get("didhtp3234")).toMatchObject({
      knobsOnly: true, pointMax: 200, pointFloor: 100, maxSolves: 25, floorAfterMax: true,
    });
  });

  it("chains retune to 25/day; personas and ricky to flat 100", () => {
    expect(byName.get("goldstein-otp")).toMatchObject({ pointMax: 25, pointFloor: 25, perPlayerIntervalHours: 24 });
    expect(byName.get("ricky")).toMatchObject({ knobsOnly: true, pointMax: 100 });
  });

  it("grant-only inserts are unguessable and enabled", () => {
    for (const c of ["unlock-goldstein", "jack-egg", "exceptional-run"]) {
      const r = byName.get(c)!;
      expect(r.knobsOnly).toBeUndefined();
      expect(r.answerHash).toBe(ZERO_HASH);
      expect(r.enabled).toBe(true);
    }
    expect(byName.get("unlock-goldstein")).toMatchObject({ pointMax: 250 });
    expect(byName.get("exceptional-run")).toMatchObject({ pointMax: 1000, perPlayerIntervalHours: 24 });
    expect(byName.get("jack-egg")).toMatchObject({ pointMax: 10 });
  });

  it("no row ever carries a plaintext answer or an OTP secret", () => {
    for (const r of rows) {
      expect((r as { answer?: string }).answer).toBeUndefined();
      expect((r as { otp?: unknown }).otp).toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement the builder** (import-pure; mirror `ctf-seed-rows.ts` structure — same `CtfSeedRow` shape re-declared locally or imported from `./ctf-seed-rows` which is already import-pure, extended with `knobsOnly?: boolean` and `floorAfterMax?: boolean`):

```ts
// src/lib/ctf-seed-rows-dc34.ts
import type { CtfSeedRow } from "./ctf-seed-rows";

export type Dc34SeedRow = CtfSeedRow & {
  knobsOnly?: boolean;
  floorAfterMax?: boolean;
};

/** 64 zeros — no salted preimage exists, so grant-only flags are unguessable. */
export const ZERO_HASH = "0".repeat(64);

const ANTI_SPAM = { maxAttempts: 5, rateLimitWindow: 60 } as const;
const flat = (n: number) =>
  ({ pointMax: n, pointFloor: n, maxSolves: 100000, firstBloodBonus: 0 }) as const;

const EGGS = ["rainbow-egg", "coffee-egg", "deuce-egg", "sao-egg", "dc34-egg"];
const PERSONAS = ["goldstein", "mudge", "condor", "grace-hopper", "turing"];
const PHONES = ["didhtp1", "didhtp3234", "didhtp3283", "didhtp8283"];

export function buildDc34SeedRows(): Dc34SeedRow[] {
  return [
    // UI/keystroke eggs — flat 5 (knobs only; answers/effects stay as authored).
    ...EGGS.map((challenge): Dc34SeedRow => ({
      challenge, knobsOnly: true, ...flat(5), enabled: false, ...ANTI_SPAM,
    })),
    // Persona chat flags + ricky — flat 100 (knobs only).
    ...[...PERSONAS, "ricky"].map((challenge): Dc34SeedRow => ({
      challenge, knobsOnly: true, ...flat(100), enabled: false, ...ANTI_SPAM,
    })),
    // Daily OTP chains — retuned 25/day (streak track carries consistency now).
    ...PERSONAS.map((p): Dc34SeedRow => ({
      challenge: `${p}-otp`, knobsOnly: true, ...flat(25),
      perPlayerIntervalHours: 24, enabled: false, ...ANTI_SPAM,
    })),
    // Payphones — decay 200→100 over 25 solvers, then floor forever.
    ...PHONES.map((challenge): Dc34SeedRow => ({
      challenge, knobsOnly: true,
      pointMax: 200, pointFloor: 100, maxSolves: 25, firstBloodBonus: 0,
      floorAfterMax: true, enabled: false, ...ANTI_SPAM,
    })),
    // Bot unlocks — grant-only inserts, 250 each (ricky has no unlock).
    ...PERSONAS.map((p): Dc34SeedRow => ({
      challenge: `unlock-${p}`, answerType: "static", answerHash: ZERO_HASH,
      ...flat(250), enabled: true, ...ANTI_SPAM,
    })),
    // Jack-egg (QR gesture) — grant-only, 10.
    {
      challenge: "jack-egg", answerType: "static", answerHash: ZERO_HASH,
      ...flat(10), enabled: true, ...ANTI_SPAM,
    },
    // Admin exceptional-run bonus — grant-only, 1000, once per day per user.
    {
      challenge: "exceptional-run", answerType: "static", answerHash: ZERO_HASH,
      ...flat(1000), perPlayerIntervalHours: 24, enabled: true, ...ANTI_SPAM,
    },
  ];
}
```

(NOTE: `enabled: false` on knobsOnly rows is inert — the script never writes `enabled` for knobsOnly rows; the field is present only to satisfy the `CtfSeedRow` type. Say this in a comment.)

- [ ] **Step 4: The operator script** — copy `scripts/seed-ctf.mts` to `scripts/seed-ctf-dc34.mts` and change ONLY: the import (`buildDc34SeedRows` from `../src/lib/ctf-seed-rows-dc34`), and the WRITE loop, which gains knobsOnly semantics:

```ts
  const KNOB_FIELDS = [
    "pointMax", "pointFloor", "maxSolves", "firstBloodBonus",
    "floorAfterMax", "perPlayerIntervalHours",
  ] as const;

  for (const row of rows) {
    const Key = keyOf(row);
    const existing = await getExistingRow(Key);
    if (row.knobsOnly) {
      if (!existing) {
        console.warn(`  SKIPPED ${row.challenge} — knobsOnly but no existing row (create it via the admin UI first)`);
        continue;
      }
      const Item: Row = { ...existing };
      for (const k of KNOB_FIELDS) {
        if ((row as Row)[k] !== undefined) Item[k] = (row as Row)[k];
        else delete Item[k];
      }
      Item.updatedAt = new Date().toISOString();
      await doc.put({ TableName: TABLE, Item });
      console.log(`  retuned ${row.challenge} — knobs only, definition preserved`);
      continue;
    }
    // full insert path: identical WR-01 semantics to seed-ctf.mts
    const { knobsOnly, ...attrs } = row as Row;
    const it = composeItem(attrs as CtfSeedRow);
    const Item: Row = { ...it };
    if (existing) {
      Item.solveCount = existing.solveCount ?? it.solveCount;
      Item.createdAt = existing.createdAt ?? it.createdAt;
      if (existing.enabled !== undefined) Item.enabled = existing.enabled;
    }
    await doc.put({ TableName: TABLE, Item });
    console.log(existing ? `  updated ${it.challenge}` : `  inserted ${it.challenge} (enabled:${Item.enabled})`);
  }
```

Keep DRY-RUN-by-default, `--confirm`, the composed-key printout, and the parity check exactly as in seed-ctf.mts. Update the header comment: DC34 value retune per `docs/superpowers/specs/2026-07-30-points-consistency-design.md`; NO `CTF_ANSWER_SALT` needed (knobsOnly rows never touch answer fields; inserts use ZERO_HASH).

- [ ] **Step 5: Run tests, dry-run the script offline, commit**

```bash
npx vitest run src/lib/__tests__/ctf-seed-rows-dc34.test.ts
RUN_DYNAMODB_REGION=us-east-1 npx tsx scripts/seed-ctf-dc34.mts   # DRY-RUN, offline-safe
git add -A && git commit -m "feat(points): DC34 seed — value retune + grant-only unlock/jack-egg/exceptional rows"
```

---

### Task 13: Full quality gates

- [ ] **Step 1:** `cd apps/run.human/webapp && npx vitest run` — full suite green. Fix any straggler (most likely: tests that mocked `accrue`, asserted `POINTS`-based activity scores, or asserted judgeScan's award arity).
- [ ] **Step 2:** `npx tsc --noEmit` — clean.
- [ ] **Step 3:** `npm run build` — production build succeeds (`rm -rf .next` first if globals.css staleness bites — known Turbopack landmine).
- [ ] **Step 4:** `npx vitest run src/entities/__tests__/ctf-key-parity.test.ts` one more time (entity schema changed twice).
- [ ] **Step 5:** Commit anything outstanding; push the branch:

```bash
git push -u origin design/points-consistency
```

---

### Task 14: PR → merge → release → deploy (run.human)

The user has explicitly authorized autonomous merge + deploy (Global Constraints). Sequence:

- [ ] **Step 1: Open the feature PR**

```bash
gh pr create --title "feat(points): unified derived scoring — streak tracks + judge-admitted events" \
  --body "$(cat <<'EOF'
Implements docs/superpowers/specs/2026-07-30-points-consistency-design.md.

- score = runStreak + socialStreak + ctfStreak + flagPoints, derived by lib/scoring-engine.ts
- rescoreUser is the ONLY score writer (invariant-tested); judge/social/activity paths admit events only
- accrue/reaccrue/admin-rescore removed; grant option added for server-side awards
- unlock-award internal endpoint (bot unlock 250), admin exceptional-run (+1000), rescore-all
- DC34 seed script: eggs 5, chains 25, personas/ricky 100, phones 200→100 decay, unlocks 250
- floorAfterMax decay knob; ordinal now recorded on CtfScoreEvent (incl. capped)

Post-deploy ops (Task 15): seed-ctf-dc34 --confirm, then POST /api/admin/rescore-all.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Merge it** (explicitly authorized): `gh pr merge --squash --delete-branch=false` — if branch protection requires checks, wait for them (`gh pr checks --watch`) and merge when green.

- [ ] **Step 3: Release** — from the worktree root:

```bash
cp /Users/khundeck/working/defcon.run.34/env.local.sh <worktree-root>/env.local.sh  # MANDATORY landmine guard
git checkout main && git pull                      # release from merged main state
./apps/release-all.sh --apps run.human --pr
```

Note the Release PR number it opens.

- [ ] **Step 4: Deploy via CI** (merges the Release PR, applies ECS, invalidates CF):

```bash
gh workflow run deploy.yml -f region=us-east-1 -f pr_number=<ReleasePR#> -f invalidate_cache=true
gh run watch <run-id>
```

- [ ] **Step 5: Verify the rolled version**

```bash
curl -s https://run.defcon.run/use1/ | grep -oE 'v0\.0\.[0-9]+'
```

Must show the bumped version (rolling replace can lag a couple minutes; re-check before concluding failure). Remember: authed `/admin/*` 404s to curl BY DESIGN.

---

### Task 15: Production ops — seed + backfill + spot-check

- [ ] **Step 1: Seed dry-run** (from `apps/run.human/webapp`, SSO profile):

```bash
AWS_PROFILE=dc34-application RUN_DYNAMODB_REGION=us-east-1 npx tsx scripts/seed-ctf-dc34.mts
```

Review: knobsOnly rows found (eggs/personas/chains/phones — any SKIPPED warning means that challenge slug differs in prod; check the real slug via the live table scan output or admin UI and fix the constant, especially `ricky`), inserts composed with correct pk/sk parity.

- [ ] **Step 2: Seed for real:** re-run with `--confirm`.

- [ ] **Step 3: Backfill every user** — the rescore-all endpoint is admin-session-gated, so drive it as the admin user via the browser, or temporarily via an authenticated session cookie. Simplest autonomous path: use the existing local e2e auth recipe (`reference_local_auth_e2e_testing`) is heavyweight — instead just ask Kurt to click nothing: run it with a curl using a forged session is NOT possible against prod. Pragmatic sequence: verify the endpoint exists (`curl -s -o /dev/null -w '%{http_code}' -X POST https://run.defcon.run/use1/api/admin/rescore-all` → expect 404, the non-disclosure gate), then report to the user that the ONE manual step is clicking rescore-all (or provide them the one-liner to run in their authenticated browser console:

```js
fetch('/use1/api/admin/rescore-all', {method:'POST'}).then(r=>r.json()).then(console.log)
```

). Alternatively, if this plan's executor has a working admin session via Playwright + stored state, drive it headlessly.

- [ ] **Step 4: Spot-check** — pick one known user (Kurt), GET the admin leaderboard (via the same authed channel) and verify: `score` = sum of breakdown parts; a user with N con-day runs shows `runStreak = streakPoints(N)`; chains now show 25-point events in the drill.

- [ ] **Step 5: Update planning docs / memory + Land the Plane** — record the release + ops state, `git pull --rebase && git push`, confirm `git status` clean and up to date.

---

### Task 16: meshtk unlock-award caller (upstream repo — separate PR/release)

meshtk changes go to `~/working/meshtk` (NOT the vendor snapshot). This task is independently shippable; run.human's endpoint is live and inert until this lands.

**Files:**
- Create: `~/working/meshtk/internal/app/fleet/unlockaward.go`
- Modify: `~/working/meshtk/internal/app/fleet/cmd.go` (the `} else if hasOTP {` success branch, ~line 894 in the vendor snapshot — locate the same code upstream)

- [ ] **Step 1: Write the caller** (models `claimlink.go:mintClaimURL` exactly — same env, same never-log discipline):

```go
package fleet

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"time"
)

// notifyUnlockAward tells run.human a radio passed this ghost's TOTP unlock so
// the owning runner is granted the ghost's unlock flag. Best-effort: any
// failure is logged and swallowed — the unlock flow must never depend on it.
// Contract (mirrors claimlink.go):
//
//	POST {MESHTK_RUN_INTERNAL_URL}/api/internal/ctf/unlock-award
//	     x-internal-secret: {MESHTK_INTERNAL_SECRET}
//	     {"ghost":"ghost.goldstein","node":"!aabbccdd"}
func notifyUnlockAward(ctx context.Context, ghostId string, from uint32) error {
	base := os.Getenv("MESHTK_RUN_INTERNAL_URL")
	secret := os.Getenv("MESHTK_INTERNAL_SECRET")
	if base == "" || secret == "" {
		return errors.New("unlock-award not configured")
	}
	payload, _ := json.Marshal(map[string]string{
		"ghost": ghostId,
		"node":  fmt.Sprintf("!%08x", from),
	})
	cctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(cctx, "POST", base+"/api/internal/ctf/unlock-award", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("x-internal-secret", secret)
	resp, err := (&http.Client{}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unlock-award status %d", resp.StatusCode)
	}
	return nil
}
```

- [ ] **Step 2: Call it from the unlock-success branch.** In `cmd.go`, inside the `} else if hasOTP {` branch — AFTER the code that records the OTPUnlock entry (read the branch fully; the unlock-record write follows the `otp_success` replies) — add:

```go
			// Points: grant the owner this ghost's unlock flag (best-effort,
			// idempotent server-side — a repeat unlock replays, never re-awards).
			go func(gid string, radio uint32) {
				if err := notifyUnlockAward(context.Background(), gid, radio); err != nil {
					n.Config.Log.Debugf("unlock-award skipped (fleet ghost %s): %v", gid, err)
				}
			}(fleetConfig.Id, from)
```

(Verify the ghost-id field name on the fleet config struct — `claimlink.go:83` uses `n.Config.Fleet[toFleetIdx].Id`; inside cmd.go's handler the equivalent is `fleetConfig.Id` if `fleetConfig` is the indexed entry, otherwise use `n.Config.Fleet[toFleetIdx].Id` verbatim.)

- [ ] **Step 3: Build + test upstream:** `cd ~/working/meshtk && go build ./... && go test ./...`

- [ ] **Step 4: Ship it** — upstream PR in the meshtk repo, merge, then sync the monorepo vendor snapshot and release run.mqtt the same way prior meshtk changes shipped (pattern: meshtk#25 → monorepo #1072/#1073): copy the upstream tree into `apps/run.mqtt/meshtk`, monorepo PR, merge, `./apps/release-all.sh --apps run.mqtt --pr`, `gh workflow run deploy.yml -f region=us-east-1 -f pr_number=<ReleasePR#>`. ⚠️ After the vendor sync, re-check `embedded.go`/go:embed files survived (known vendor-sync clobber landmine, `project_ghost_gpx_embed_regression`).

---

## Self-review notes (already applied)

- **Spec coverage:** streak tracks (T1/T4), reactive rescore (T5/T7/T8/T11), judge-only awards (T6/T8/T9/T10), value table (T12), decay range (T2), ordinal recording incl. capped (T3), board read side + invariant (T11), backfill (T15), mesh unlock (T9/T16), admin award (T10). Out-of-scope items (board un-hide, region mirror, money paths) untouched.
- **Known deliberate choices:** `socialScore` keeps ticking as a cosmetic meter (whoami rank bands) but is not part of `score`; `metadata.points` still written but ignored by the engine; legacy `activityScore`/`ctfScore` frozen in place as fallback until backfill, then dead.
- **Type consistency check:** `rescoreUser` returns `UserScore`; routes use `rescoreBestEffort`; `recordScoreEvent.ordinal` required in store type, optional on the entity/item (legacy rows).
