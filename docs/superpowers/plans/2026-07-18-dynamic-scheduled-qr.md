# Dynamic Scheduled QR Codes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator schedule where a fixed, shared QR code (and the `r.`/`h.` short domains) redirects, as a timeline of switch-points across any dates, authored in an admin UI.

**Architecture:** A "dynamic scheduled QR code" is an existing `Qr` resolver row. We add a `schedule` attribute (the authoring source of truth) and a **pure compiler** that turns switch-points into the resolver's existing `rules` time-windows — so the resolver Lambda is **not changed**. A new admin timeline editor writes `schedule`; a "Publish now" button inserts a switch-point at the current moment. The `r.`/`h.` short domains are re-pointed through the resolver via a trivial CloudFront path-rewrite Function so they too become schedulable.

**Tech Stack:** Next.js 16 App Router (run.human), ElectroDB on shared `run-human-electro` DynamoDB table, Vitest 4, Terraform/Terragrunt, CloudFront Functions.

## Global Constraints

- **Node ≥ 22.12** for Vitest 4 (`nvm use 22.12.0` — v22.1.0 and 23.6.0 break Vitest 4).
- **Destinations MUST be absolute `https://` URLs** — reuse `validateDestination` from `qr-admin.ts` (blocks `javascript:`/`data:`/`http:`/relative open-redirects).
- **Rule item shape is load-bearing:** `{ kind:"time", from:<UTC ISO>, to:<UTC ISO>, dest:<url> }`. The resolver reads `dest` (NOT `destination`) and windows are half-open `[from, to)` (`apps/run.qr/lambda/resolver/lib/rules.mjs`).
- **Entity key parity is load-bearing:** do NOT change `model.entity`/`version`/`service` or any index `field:`/composite in `src/entities/qr.ts` or `resolver/lib/entities.mjs`. Adding a plain attribute is safe (locked by `qr-key-parity.test.ts`, which asserts only key encoding).
- **Code casing:** admin stores `code` lowercase (`normalizeCode`); resolver uppercases on read. Both resolve the same row.
- **Timezone:** all switch-points are authored/displayed in `America/Los_Angeles` regardless of browser TZ, stored as UTC ISO.
- **Con days (quick-add presets only; confirm actual dates):** Thu 2026-08-06, Fri 2026-08-07, Sat 2026-08-08, Sun 2026-08-09. Switch-points may be on ANY date.
- **Server-only import discipline:** `qr-admin.ts` imports the electro client — never import it from a `"use client"` module.
- **60s propagation:** the resolver warm-caches a code for 60s (`CACHE_TTL_MS`), so a flip goes live within ~60s. Not instant — state this in the UI.

---

## File Structure

**Part A — webapp (shippable PR):**
- Create `apps/run.human/webapp/src/lib/qr-schedule.ts` — pure compiler + con-day config + PT↔UTC helpers + active-entry selector.
- Create `apps/run.human/webapp/src/lib/__tests__/qr-schedule.test.ts` — unit tests for the above.
- Modify `apps/run.human/webapp/src/entities/qr.ts` — add `schedule` attribute to `Qr`.
- Modify `apps/run.qr/lambda/resolver/lib/entities.mjs` — add `schedule` attribute to `Qr` (parity; resolver ignores it).
- Modify `apps/run.human/webapp/src/lib/qr-admin.ts` — `QrScheduleEntryInput`, thread `schedule` through `QrInput`/`qrAttributes`/`upsertQr`.
- Modify `apps/run.human/webapp/src/lib/__tests__/qr-admin.test.ts` — schedule round-trip + compile-on-save tests.
- Create `apps/run.human/webapp/src/components/admin/ScheduleEditor.tsx` — the chronological switch-point editor (client).
- Modify `apps/run.human/webapp/src/components/admin/QrForm.tsx` — mount `ScheduleEditor`; when a schedule exists it owns `rules`.
- Modify `apps/run.human/webapp/src/app/(protected)/admin/qr/page.tsx` — add "LIVE now →" column.
- Modify `apps/run.human/webapp/src/app/(protected)/admin/qr/[code]/page.tsx` — pass existing `schedule` to the form.

**Part B — infra (staged; needs a human-run `terragrunt apply` against live domains):**
- Modify `apps/run.human/webapp/src/data/redirects.json` — remove `r` and `h` entries.
- Modify/create Terraform under `infra/terraform/modules/qr-resolver/` + `infra/terraform/live/site/region/us-east-1/qr-resolver/` — enable transport, add per-host distros with a path-rewrite CloudFront Function for `r.`/`h.`.
- Seed `Qr` rows `R` and `H` with today's destinations (script or admin UI).

---

## Task 1: Pure schedule compiler + PT/con-day helpers

**Files:**
- Create: `apps/run.human/webapp/src/lib/qr-schedule.ts`
- Test: `apps/run.human/webapp/src/lib/__tests__/qr-schedule.test.ts`

**Interfaces:**
- Produces:
  - `interface ScheduleEntry { startsAt: string; dest: string; label?: string }`
  - `compileScheduleToRules(schedule: ScheduleEntry[]): Array<{ kind: "time"; from: string; to: string; dest: string }>`
  - `activeScheduleEntry(schedule: ScheduleEntry[], nowMs: number): ScheduleEntry | null`
  - `ptWallClockToUtcIso(y: number, mo1: number, d: number, h: number, mi: number): string` (mo1 = 1-based month)
  - `utcToPtParts(iso: string): { y: number; mo1: number; d: number; h: number; mi: number; dateKey: string; timeLabel: string; dayLabel: string }`
  - `const CON_TZ = "America/Los_Angeles"`
  - `const CON_DAYS: Array<{ label: string; date: string }>`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/run.human/webapp/src/lib/__tests__/qr-schedule.test.ts
import { describe, it, expect } from "vitest";
import {
  compileScheduleToRules,
  activeScheduleEntry,
  ptWallClockToUtcIso,
  utcToPtParts,
  type ScheduleEntry,
} from "@/lib/qr-schedule";

const S = (startsAt: string, dest: string, label?: string): ScheduleEntry => ({
  startsAt,
  dest,
  label,
});

describe("compileScheduleToRules", () => {
  it("returns [] for an empty schedule", () => {
    expect(compileScheduleToRules([])).toEqual([]);
  });

  it("makes one open-ended window for a single switch-point", () => {
    const rules = compileScheduleToRules([S("2026-08-06T15:00:00.000Z", "https://a.example/")]);
    expect(rules).toEqual([
      { kind: "time", from: "2026-08-06T15:00:00.000Z", to: "2999-01-01T00:00:00.000Z", dest: "https://a.example/" },
    ]);
  });

  it("chains consecutive gap-free windows sorted by startsAt", () => {
    const rules = compileScheduleToRules([
      S("2026-08-06T21:00:00.000Z", "https://c.example/"),
      S("2026-08-06T15:00:00.000Z", "https://a.example/"),
      S("2026-08-06T18:00:00.000Z", "https://b.example/"),
    ]);
    expect(rules.map((r) => [r.from, r.to, r.dest])).toEqual([
      ["2026-08-06T15:00:00.000Z", "2026-08-06T18:00:00.000Z", "https://a.example/"],
      ["2026-08-06T18:00:00.000Z", "2026-08-06T21:00:00.000Z", "https://b.example/"],
      ["2026-08-06T21:00:00.000Z", "2999-01-01T00:00:00.000Z", "https://c.example/"],
    ]);
  });

  it("drops entries with a blank dest or unparseable startsAt", () => {
    const rules = compileScheduleToRules([
      S("2026-08-06T15:00:00.000Z", "   "),
      S("not-a-date", "https://a.example/"),
      S("2026-08-06T16:00:00.000Z", "https://ok.example/"),
    ]);
    expect(rules).toEqual([
      { kind: "time", from: "2026-08-06T16:00:00.000Z", to: "2999-01-01T00:00:00.000Z", dest: "https://ok.example/" },
    ]);
  });
});

describe("activeScheduleEntry", () => {
  const sched = [
    S("2026-08-06T15:00:00.000Z", "https://a.example/"),
    S("2026-08-06T18:00:00.000Z", "https://b.example/"),
  ];
  it("returns null before the first switch-point (base destination applies)", () => {
    expect(activeScheduleEntry(sched, Date.parse("2026-08-06T14:59:00.000Z"))).toBeNull();
  });
  it("returns the last switch-point whose start is <= now", () => {
    expect(activeScheduleEntry(sched, Date.parse("2026-08-06T19:00:00.000Z"))?.dest).toBe("https://b.example/");
  });
  it("is inclusive of the exact start instant", () => {
    expect(activeScheduleEntry(sched, Date.parse("2026-08-06T15:00:00.000Z"))?.dest).toBe("https://a.example/");
  });
});

describe("PT wall-clock <-> UTC (PDT = UTC-7 in August)", () => {
  it("converts 9:00 AM PT on Sat 8/8/2026 to 16:00Z", () => {
    expect(ptWallClockToUtcIso(2026, 8, 8, 9, 0)).toBe("2026-08-08T16:00:00.000Z");
  });
  it("round-trips back to PT parts", () => {
    const p = utcToPtParts("2026-08-08T16:00:00.000Z");
    expect([p.y, p.mo1, p.d, p.h, p.mi]).toEqual([2026, 8, 8, 9, 0]);
    expect(p.dateKey).toBe("2026-08-08");
    expect(p.dayLabel).toBe("Sat");
    expect(p.timeLabel).toBe("9:00 AM");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/run.human/webapp && nvm use 22.12.0 && npx vitest run src/lib/__tests__/qr-schedule.test.ts`
Expected: FAIL — `Cannot find module '@/lib/qr-schedule'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/run.human/webapp/src/lib/qr-schedule.ts
/**
 * Pure scheduling core for dynamic scheduled QR codes.
 *
 * A "dynamic scheduled QR code" is a Qr row whose `schedule` (an ordered list of
 * switch-points) is the authoring source of truth. On save it is COMPILED into
 * the resolver's existing `rules` time-windows — so the resolver Lambda is never
 * changed. See docs/superpowers/specs/2026-07-18-dynamic-scheduled-qr-design.md.
 *
 * All times are stored UTC ISO. Switch-points are authored/displayed in Vegas
 * time (America/Los_Angeles) regardless of the operator's browser timezone.
 */

export interface ScheduleEntry {
  /** UTC ISO 8601 instant the destination becomes live. */
  startsAt: string;
  /** Absolute https destination (validated at the write boundary). */
  dest: string;
  /** Optional human label shown in the editor. */
  label?: string;
}

/** Sentinel `to` for the last (open-ended) switch-point. */
const FAR_FUTURE = "2999-01-01T00:00:00.000Z";

export const CON_TZ = "America/Los_Angeles";

/** DEF CON 34 days — quick-add presets and default group labels only. Confirm dates. */
export const CON_DAYS: Array<{ label: string; date: string }> = [
  { label: "Thu", date: "2026-08-06" },
  { label: "Fri", date: "2026-08-07" },
  { label: "Sat", date: "2026-08-08" },
  { label: "Sun", date: "2026-08-09" },
];

/** Keep only well-formed entries, sorted ascending by startsAt. */
function sanitize(schedule: ScheduleEntry[]): ScheduleEntry[] {
  return [...(schedule ?? [])]
    .filter(
      (e) =>
        e &&
        typeof e.startsAt === "string" &&
        !Number.isNaN(Date.parse(e.startsAt)) &&
        typeof e.dest === "string" &&
        e.dest.trim() !== ""
    )
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

/**
 * Compile switch-points into resolver time-rules. Window i is
 * [startsAt[i], startsAt[i+1]); the last is open-ended (FAR_FUTURE). The period
 * before the first switch-point matches no window, so the resolver falls back to
 * the base `destination`.
 */
export function compileScheduleToRules(
  schedule: ScheduleEntry[]
): Array<{ kind: "time"; from: string; to: string; dest: string }> {
  const entries = sanitize(schedule);
  return entries.map((e, i) => ({
    kind: "time" as const,
    from: e.startsAt,
    to: i + 1 < entries.length ? entries[i + 1].startsAt : FAR_FUTURE,
    dest: e.dest,
  }));
}

/** The switch-point live at nowMs, or null before the first (→ base destination). */
export function activeScheduleEntry(
  schedule: ScheduleEntry[],
  nowMs: number
): ScheduleEntry | null {
  let active: ScheduleEntry | null = null;
  for (const e of sanitize(schedule)) {
    if (Date.parse(e.startsAt) <= nowMs) active = e;
    else break;
  }
  return active;
}

/** Offset (ms) of `tz` at the given UTC instant: tzLocal - utc. */
function tzOffsetMs(tz: string, atUtcMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(
    dtf.formatToParts(new Date(atUtcMs)).map((x) => [x.type, x.value])
  ) as Record<string, string>;
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second)
  );
  return asUtc - atUtcMs;
}

/** A Vegas wall-clock (mo1 = 1-based month) → UTC ISO. Handles PDT/PST via Intl. */
export function ptWallClockToUtcIso(
  y: number,
  mo1: number,
  d: number,
  h: number,
  mi: number
): string {
  const naiveUtc = Date.UTC(y, mo1 - 1, d, h, mi, 0);
  // Offset at the naive guess is stable away from DST edges (con dates are).
  const offset = tzOffsetMs(CON_TZ, naiveUtc);
  return new Date(naiveUtc - offset).toISOString();
}

/** A UTC ISO → Vegas parts for display/grouping. */
export function utcToPtParts(iso: string): {
  y: number;
  mo1: number;
  d: number;
  h: number;
  mi: number;
  dateKey: string;
  timeLabel: string;
  dayLabel: string;
} {
  const ms = Date.parse(iso);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: CON_TZ,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const p = Object.fromEntries(
    dtf.formatToParts(new Date(ms)).map((x) => [x.type, x.value])
  ) as Record<string, string>;
  const y = Number(p.year);
  const mo1 = Number(p.month);
  const d = Number(p.day);
  return {
    y,
    mo1,
    d,
    h: Number(p.hour) % 12 + (p.dayPeriod?.toUpperCase() === "PM" ? 12 : 0),
    mi: Number(p.minute),
    dateKey: `${p.year}-${p.month}-${p.day}`,
    timeLabel: `${p.hour}:${p.minute} ${p.dayPeriod?.toUpperCase()}`,
    dayLabel: p.weekday,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/run.human/webapp && npx vitest run src/lib/__tests__/qr-schedule.test.ts`
Expected: PASS (all cases). If the `utcToPtParts` hour math is off for AM/PM, fix the `h` computation until `[2026,8,8,9,0]` passes.

- [ ] **Step 5: Commit**

```bash
git add apps/run.human/webapp/src/lib/qr-schedule.ts apps/run.human/webapp/src/lib/__tests__/qr-schedule.test.ts
git commit -m "feat(qr): pure schedule compiler + PT/con-day helpers"
```

---

## Task 2: Add `schedule` attribute to both Qr entities

**Files:**
- Modify: `apps/run.human/webapp/src/entities/qr.ts` (Qr attributes, after `rules`)
- Modify: `apps/run.qr/lambda/resolver/lib/entities.mjs` (Qr attributes, after `rules`)
- Test: `apps/run.human/webapp/src/entities/__tests__/qr-key-parity.test.ts` (extend)

**Interfaces:**
- Produces: `Qr` entity accepts `schedule: Array<{ startsAt, dest, label }>` without moving the key.

- [ ] **Step 1: Write the failing test** (append to `qr-key-parity.test.ts`, inside `describe("Qr mirror key parity")`)

```ts
  it("accepts a schedule attribute without moving the key", () => {
    const params = Qr.put({
      code: "rickroll",
      destination: "https://run.defcon.run/use1/welcome",
      schedule: [
        { startsAt: "2026-08-06T15:00:00.000Z", dest: "https://run.defcon.run/use1/welcome", label: "Welcome" },
      ],
    }).params({ table });
    expect(params.Item.pk).toBe("$run#code_rickroll");
    expect(params.Item.sk).toBe("$qr_1");
    expect(params.Item.schedule).toEqual([
      { startsAt: "2026-08-06T15:00:00.000Z", dest: "https://run.defcon.run/use1/welcome", label: "Welcome" },
    ]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/run.human/webapp && npx vitest run src/entities/__tests__/qr-key-parity.test.ts`
Expected: FAIL — ElectroDB rejects the unknown `schedule` attribute (or drops it, so `.schedule` is undefined).

- [ ] **Step 3: Add the attribute in `src/entities/qr.ts`** (immediately after the `rules` attribute block, before `enrich`)

```ts
      // Authoring source of truth for a dynamic scheduled code (Phase: dynamic
      // scheduled QR). Ordered switch-points; on save qr-admin compiles these into
      // `rules` time-windows (compileScheduleToRules). The resolver reads only
      // `rules`; `schedule` is admin-side, mirrored here for entity parity.
      schedule: {
        type: "list",
        items: {
          type: "map",
          properties: {
            startsAt: { type: "string" },
            dest: { type: "string" },
            label: { type: "string" },
          },
        },
      },
```

- [ ] **Step 4: Add the identical attribute in `apps/run.qr/lambda/resolver/lib/entities.mjs`** (same position, after `rules`)

```js
      // Admin-side authoring source (dynamic scheduled QR). The resolver does NOT
      // read this — it reads compiled `rules`. Declared here only for entity parity
      // with the run.human TS mirror.
      schedule: {
        type: "list",
        items: {
          type: "map",
          properties: {
            startsAt: { type: "string" },
            dest: { type: "string" },
            label: { type: "string" },
          },
        },
      },
```

- [ ] **Step 5: Run parity + resolver entity tests to verify they pass**

Run: `cd apps/run.human/webapp && npx vitest run src/entities/__tests__/qr-key-parity.test.ts`
Then: `cd apps/run.qr/lambda/resolver && node --test tests/entities.test.mjs`
Expected: PASS both (keys unchanged; resolver still ignores `schedule`).

- [ ] **Step 6: Commit**

```bash
git add apps/run.human/webapp/src/entities/qr.ts apps/run.qr/lambda/resolver/lib/entities.mjs apps/run.human/webapp/src/entities/__tests__/qr-key-parity.test.ts
git commit -m "feat(qr): add schedule attribute to Qr entity (both mirrors)"
```

---

## Task 3: Thread `schedule` through the admin data layer (compile-on-save)

**Files:**
- Modify: `apps/run.human/webapp/src/lib/qr-admin.ts` (`QrInput`, `qrAttributes`, `upsertQr`)
- Test: `apps/run.human/webapp/src/lib/__tests__/qr-admin.test.ts` (extend)

**Interfaces:**
- Consumes: `compileScheduleToRules`, `ScheduleEntry` from Task 1.
- Produces:
  - `interface QrScheduleEntryInput { startsAt: string; dest: string; label?: string }`
  - `QrInput` gains `schedule?: QrScheduleEntryInput[]`.
  - When `schedule` is present and non-empty, `upsertQr` stores it AND overwrites `rules` with `compileScheduleToRules(schedule)`; the caller's raw `rules` is ignored for that write.

- [ ] **Step 1: Write the failing tests** (append to `qr-admin.test.ts`)

```ts
import { describe, it, expect, vi } from "vitest";
// (reuse the file's existing Qr mock harness; the assertions below describe intent —
//  adapt to how the file already stubs Qr.create/patch/get.)

describe("upsertQr schedule compilation", () => {
  it("compiles schedule into time rules on the written attributes", async () => {
    const attrs = qrAttributesForTest({
      code: "rickroll",
      destination: "https://run.defcon.run/use1/welcome",
      schedule: [
        { startsAt: "2026-08-06T18:00:00.000Z", dest: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
        { startsAt: "2026-08-06T15:00:00.000Z", dest: "https://run.defcon.run/use1/welcome" },
      ],
    });
    expect(attrs.rules).toEqual([
      { kind: "time", from: "2026-08-06T15:00:00.000Z", to: "2026-08-06T18:00:00.000Z", dest: "https://run.defcon.run/use1/welcome" },
      { kind: "time", from: "2026-08-06T18:00:00.000Z", to: "2999-01-01T00:00:00.000Z", dest: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    ]);
    expect(attrs.schedule).toHaveLength(2);
  });

  it("rejects a schedule entry with a non-https dest", () => {
    expect(() =>
      qrAttributesForTest({
        code: "rickroll",
        schedule: [{ startsAt: "2026-08-06T15:00:00.000Z", dest: "http://insecure.example/" }],
      })
    ).toThrow(/https/i);
  });
});
```

> Note: if `qrAttributes` is not exported, export it (it is a pure builder like `ctfAttributes`, which the existing tests already exercise) and reference it as `qrAttributesForTest`. Otherwise assert via the existing `upsertQr` mock harness.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/run.human/webapp && npx vitest run src/lib/__tests__/qr-admin.test.ts`
Expected: FAIL — `schedule` not on `QrInput`; `attrs.schedule` undefined; rules not compiled.

- [ ] **Step 3: Implement in `qr-admin.ts`**

Add the import at the top:
```ts
import { compileScheduleToRules } from "@/lib/qr-schedule";
```

Add the input type (near `QrRuleInput`):
```ts
export interface QrScheduleEntryInput {
  startsAt: string; // UTC ISO
  dest: string;     // absolute https
  label?: string;
}
```

Extend `QrInput`:
```ts
export interface QrInput {
  code: string;
  type?: string;
  destination?: string;
  rules?: QrRuleInput[];
  /** Dynamic scheduled code: ordered switch-points. When present+non-empty this
   *  is the source of truth and OVERRIDES `rules` (compiled on save). */
  schedule?: QrScheduleEntryInput[];
  enrich?: QrEnrichInput;
  enabled?: boolean;
  owner?: string;
  notes?: string;
}
```

In `qrAttributes(input)`, replace the `rules` derivation so a present schedule wins. At the top of the function, before the existing `const rules = ...`:
```ts
  // A dynamic schedule is the source of truth: compile it into time-rules and
  // ignore any raw `rules` for this write. Each compiled dest is https-validated.
  const hasSchedule = Array.isArray(input.schedule) && input.schedule.length > 0;
  const scheduleEntries = hasSchedule
    ? input.schedule!.map((e, i) => {
        const where = `Switch-point ${i + 1}`;
        if (!e.dest || e.dest.trim() === "") {
          throw new QrValidationError(`${where} needs a destination.`);
        }
        validateDestination(e.dest);
        if (!e.startsAt || Number.isNaN(Date.parse(e.startsAt))) {
          throw new QrValidationError(`${where} has an invalid start time.`);
        }
        return { startsAt: e.startsAt, dest: e.dest, ...(e.label ? { label: e.label } : {}) };
      })
    : [];
```

Then change the returned object so `rules` and `schedule` reflect the schedule when present:
```ts
  const derivedRules = hasSchedule ? compileScheduleToRules(scheduleEntries) : rules;
  return {
    type: input.type || "redirect",
    destination: input.destination ?? "",
    rules: derivedRules,
    schedule: scheduleEntries,
    enrich: input.enrich ?? {},
    enabled: input.enabled ?? true,
    owner: input.owner ?? "",
    notes: input.notes ?? "",
  };
```

(`upsertQr` already spreads `attrs` into create/patch — no change needed there. A create/patch with `schedule: []` writes an empty list, which is fine and clears a prior schedule.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/run.human/webapp && npx vitest run src/lib/__tests__/qr-admin.test.ts src/lib/__tests__/qr-schedule.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/run.human/webapp/src/lib/qr-admin.ts apps/run.human/webapp/src/lib/__tests__/qr-admin.test.ts
git commit -m "feat(qr): compile schedule to time-rules on save"
```

---

## Task 4: `ScheduleEditor` client component (chronological switch-point editor)

**Files:**
- Create: `apps/run.human/webapp/src/components/admin/ScheduleEditor.tsx`
- Test: `apps/run.human/webapp/src/components/admin/__tests__/ScheduleEditor.render.test.ts` (pure-helper test; see Step 1)

**Interfaces:**
- Consumes: `ScheduleEntry`, `utcToPtParts`, `ptWallClockToUtcIso`, `activeScheduleEntry`, `CON_DAYS` from Task 1.
- Produces:
  - Default export `ScheduleEditor({ value, onChange }: { value: ScheduleEntry[]; onChange: (next: ScheduleEntry[]) => void })`.
  - Named pure helper `groupByPtDay(schedule: ScheduleEntry[], nowMs: number): Array<{ dateKey: string; dayLabel: string; rows: Array<{ entry: ScheduleEntry; timeLabel: string; live: boolean }> }>` — unit-tested (the component body is thin around it).

- [ ] **Step 1: Write the failing test for the pure grouping helper**

```ts
// apps/run.human/webapp/src/components/admin/__tests__/ScheduleEditor.render.test.ts
import { describe, it, expect } from "vitest";
import { groupByPtDay } from "@/components/admin/ScheduleEditor";

describe("groupByPtDay", () => {
  const sched = [
    { startsAt: "2026-08-06T18:00:00.000Z", dest: "https://b.example/" }, // Thu 11:00 AM PT
    { startsAt: "2026-08-06T15:00:00.000Z", dest: "https://a.example/" }, // Thu 8:00 AM PT
    { startsAt: "2026-08-08T16:00:00.000Z", dest: "https://c.example/" }, // Sat 9:00 AM PT
  ];
  it("buckets by PT day, ordered, with the live row flagged", () => {
    const groups = groupByPtDay(sched, Date.parse("2026-08-06T19:00:00.000Z")); // Thu 12:00 PM PT
    expect(groups.map((g) => g.dayLabel)).toEqual(["Thu", "Sat"]);
    expect(groups[0].rows.map((r) => r.timeLabel)).toEqual(["8:00 AM", "11:00 AM"]);
    expect(groups[0].rows.map((r) => r.live)).toEqual([false, true]); // 11 AM is active at noon
    expect(groups[1].rows[0].live).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/run.human/webapp && npx vitest run src/components/admin/__tests__/ScheduleEditor.render.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ScheduleEditor.tsx`**

```tsx
"use client";

import { useMemo } from "react";
import {
  activeScheduleEntry,
  utcToPtParts,
  ptWallClockToUtcIso,
  CON_DAYS,
  type ScheduleEntry,
} from "@/lib/qr-schedule";

/** Pure: bucket switch-points by PT day, ordered, flag the currently-live one. */
export function groupByPtDay(schedule: ScheduleEntry[], nowMs: number) {
  const active = activeScheduleEntry(schedule, nowMs);
  const sorted = [...schedule]
    .filter((e) => e?.startsAt && !Number.isNaN(Date.parse(e.startsAt)))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const groups: Array<{
    dateKey: string;
    dayLabel: string;
    rows: Array<{ entry: ScheduleEntry; timeLabel: string; live: boolean }>;
  }> = [];
  for (const entry of sorted) {
    const p = utcToPtParts(entry.startsAt);
    let g = groups.find((x) => x.dateKey === p.dateKey);
    if (!g) {
      g = { dateKey: p.dateKey, dayLabel: p.dayLabel, rows: [] };
      groups.push(g);
    }
    g.rows.push({ entry, timeLabel: p.timeLabel, live: active === entry });
  }
  return groups;
}

/** Split a datetime-local value ("2026-08-08T09:00") into PT→UTC ISO. */
function localInputToUtcIso(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return "";
  return ptWallClockToUtcIso(+m[1], +m[2], +m[3], +m[4], +m[5]);
}

/** UTC ISO → the datetime-local value in PT for the picker. */
function utcIsoToLocalInput(iso: string): string {
  const p = utcToPtParts(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${pad(p.mo1)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

export default function ScheduleEditor({
  value,
  onChange,
}: {
  value: ScheduleEntry[];
  onChange: (next: ScheduleEntry[]) => void;
}) {
  const nowMs = Date.now();
  const groups = useMemo(() => groupByPtDay(value, nowMs), [value, nowMs]);

  const update = (idx: number, patch: Partial<ScheduleEntry>) => {
    const next = value.map((e, i) => (i === idx ? { ...e, ...patch } : e));
    onChange(next);
  };
  const remove = (entry: ScheduleEntry) => onChange(value.filter((e) => e !== entry));
  const addAt = (dateIso: string) =>
    onChange([...value, { startsAt: dateIso, dest: "" }]);

  return (
    <div className="space-y-3">
      <p className="text-xs opacity-70">
        All times Las Vegas (PT). A destination stays live until the next
        switch-point. Before the first, the code uses its base destination.
        Live flips propagate within ~60s.
      </p>

      {groups.map((g) => (
        <div key={g.dateKey} className="rounded border border-white/10">
          <div className="px-3 py-1 text-xs font-semibold opacity-80 border-b border-white/10">
            {g.dayLabel} {g.dateKey}
          </div>
          <ul>
            {g.rows.map(({ entry, timeLabel, live }) => {
              const idx = value.indexOf(entry);
              return (
                <li key={idx} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <input
                    type="datetime-local"
                    className="bg-transparent border border-white/20 rounded px-2 py-1 text-sm"
                    value={utcIsoToLocalInput(entry.startsAt)}
                    onChange={(e) => update(idx, { startsAt: localInputToUtcIso(e.target.value) })}
                    aria-label="Switch-point time (PT)"
                  />
                  <span className="text-xs w-16 opacity-70">{timeLabel}</span>
                  <input
                    type="url"
                    placeholder="https://…"
                    className="flex-1 min-w-[12rem] bg-transparent border border-white/20 rounded px-2 py-1 text-sm"
                    value={entry.dest}
                    onChange={(e) => update(idx, { dest: e.target.value })}
                    aria-label="Destination URL"
                  />
                  {live && <span className="text-xs text-emerald-400">◀ LIVE</span>}
                  <button type="button" className="text-xs opacity-60 hover:opacity-100" onClick={() => remove(entry)}>
                    remove
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs opacity-70">Add switch-point:</span>
        {CON_DAYS.map((d) => (
          <button
            key={d.date}
            type="button"
            className="text-xs border border-white/20 rounded px-2 py-1"
            onClick={() => {
              const [y, mo, day] = d.date.split("-").map(Number);
              addAt(ptWallClockToUtcIso(y, mo, day, 8, 0)); // default 8:00 AM PT
            }}
          >
            + {d.label}
          </button>
        ))}
        <button
          type="button"
          className="text-xs border border-white/20 rounded px-2 py-1"
          onClick={() => {
            const p = utcToPtParts(new Date().toISOString());
            addAt(ptWallClockToUtcIso(p.y, p.mo1, p.d, p.h, p.mi));
          }}
        >
          + any date
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/run.human/webapp && npx vitest run src/components/admin/__tests__/ScheduleEditor.render.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/run.human/webapp/src/components/admin/ScheduleEditor.tsx apps/run.human/webapp/src/components/admin/__tests__/ScheduleEditor.render.test.ts
git commit -m "feat(qr): schedule editor component (con-day timeline)"
```

---

## Task 5: Mount the editor in `QrForm` + "Publish now"

**Files:**
- Modify: `apps/run.human/webapp/src/components/admin/QrForm.tsx`
- Modify: `apps/run.human/webapp/src/app/(protected)/admin/qr/[code]/page.tsx` (pass `schedule` prop)

**Interfaces:**
- Consumes: `ScheduleEditor` (Task 4), `postQrAction` (existing `qr-api.ts`), `ScheduleEntry`, `ptWallClockToUtcIso`, `utcToPtParts`.
- Produces: `QrForm` renders a "Schedule" section; on submit it sends `schedule` in the `QrInput`. A "⚡ Publish now" button appends a switch-point at the current PT minute and saves.

- [ ] **Step 1: Read `QrForm.tsx` and `[code]/page.tsx` fully.** Identify: the form state object, where `rules` is currently edited, the submit handler that builds the `QrInput`, and how the page passes an existing `Qr` row into the form.

- [ ] **Step 2: Add schedule state + editor.** In `QrForm`:
  - Add `const [schedule, setSchedule] = useState<ScheduleEntry[]>(initial.schedule ?? []);`
  - Render a "Schedule (dynamic scheduled code)" `<section>` containing `<ScheduleEditor value={schedule} onChange={setSchedule} />`.
  - When `schedule.length > 0`, render the existing raw rules editor **read-only** with a note: "Rules are generated from the schedule below." (Hide its add/edit controls; keep the display.) This satisfies the "schedule owns rules" constraint.

- [ ] **Step 3: Include `schedule` in the submitted `QrInput`.** In the submit handler where the `QrInput`/`qr` object is assembled, add `schedule,`. (Server `qrAttributes` compiles it and validates each https dest.)

- [ ] **Step 4: Add "⚡ Publish now".** A button that:

```tsx
const publishNow = async () => {
  const p = utcToPtParts(new Date().toISOString());
  const startsAt = ptWallClockToUtcIso(p.y, p.mo1, p.d, p.h, p.mi);
  const dest = window.prompt("Publish now — destination URL (https://…):", "");
  if (!dest) return;
  const next = [...schedule, { startsAt, dest }];
  setSchedule(next);
  await postQrAction({ action: "qr_upsert", qr: { ...currentQrInput(), schedule: next } });
  // reuse the form's existing success/error toast + refresh
};
```

Where `currentQrInput()` returns the same object the normal submit builds (extract it into a helper if the submit handler inlines it). Show the ~60s propagation note near the button.

- [ ] **Step 5: Pass existing schedule from the page.** In `[code]/page.tsx`, where the fetched `Qr` row is passed to `QrForm`, ensure `schedule` (default `[]`) is included in the `initial` prop. (`getQr` already returns the full row including the new attribute.)

- [ ] **Step 6: Verify build + typecheck + the whole qr test set.**

Run: `cd apps/run.human/webapp && npx vitest run src/lib/__tests__/qr-schedule.test.ts src/lib/__tests__/qr-admin.test.ts src/components/admin/__tests__/ScheduleEditor.render.test.ts src/entities/__tests__/qr-key-parity.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/run.human/webapp/src/components/admin/QrForm.tsx "apps/run.human/webapp/src/app/(protected)/admin/qr/[code]/page.tsx"
git commit -m "feat(qr): schedule section + Publish-now in admin QR form"
```

---

## Task 6: "LIVE now →" column on the admin QR list

**Files:**
- Modify: `apps/run.human/webapp/src/app/(protected)/admin/qr/page.tsx`

**Interfaces:**
- Consumes: `listQrCodes` (existing), `activeScheduleEntry` (Task 1).

- [ ] **Step 1: Read `page.tsx`.** Find the table header row and the per-code row rendering (`listQrCodes()` results).

- [ ] **Step 2: Compute the live destination server-side.** For each row with a non-empty `schedule`, compute:

```ts
import { activeScheduleEntry } from "@/lib/qr-schedule";
// inside the server component, per row:
const live = (row.schedule?.length)
  ? (activeScheduleEntry(row.schedule, Date.now())?.dest ?? row.destination /* base */)
  : null;
```

- [ ] **Step 3: Render the column.** Add a `LIVE now →` header cell and, per row, render the `live` URL (truncated, `title` = full URL) or `—` when the code is not scheduled. Keep existing columns intact.

- [ ] **Step 4: Verify build.**

Run: `cd apps/run.human/webapp && npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add "apps/run.human/webapp/src/app/(protected)/admin/qr/page.tsx"
git commit -m "feat(qr): LIVE-now column on admin QR list"
```

---

## Task 7: Manual verification of the webapp slice (before opening the PR)

**Files:** none (verification).

- [ ] **Step 1: Run the full run.human unit suite.**

Run: `cd apps/run.human/webapp && nvm use 22.12.0 && npx vitest run`
Expected: green (or only pre-existing unrelated failures — note any).

- [ ] **Step 2: Drive the flow locally.** `PORT=3001 npm run dev`; sign in as an admin (group `admin`/`runadmin`); open `/use1/admin/qr/new`, create code `sked-test` with a base destination and three switch-points (Thu 8 AM Welcome, Thu 11 AM Rickroll, Thu 9 PM Rebar). Save. Reopen — confirm the switch-points round-trip in PT and the `◀ LIVE` marker matches "now". Use "⚡ Publish now" to append a live entry and confirm the list's "LIVE now →" updates.

- [ ] **Step 3: Confirm compiled rules.** In the edit page (or via a DynamoDB read), confirm the stored `rules` are the compiled consecutive windows and `schedule` holds the switch-points.

- [ ] **Step 4: Note results** (pass/fail with evidence) for the PR description.

---

## Task 8 (Part B — infra): Point `r.` / `h.` at the resolver (redirect-target approach)

> Chosen over the heavier "move the domains onto the resolver distro" option (rejected — see
> spec §5). This touches **live production domains** but is low-risk and reversible: it only
> changes where the existing vanity interstitials redirect TO. Still requires valid AWS creds
> (`aws sso login`) and a `terragrunt apply`; seed the codes BEFORE applying.

**Files:**
- Modify: `apps/run.human/webapp/src/data/redirects.json` — `r`/`h` `target_host` →
  `q.defcon.run`, `target_path` → `/R` / `/H`, `target_query` → `""`, both `HTTP_302`. Keep
  the `og` blocks (unfurl cards preserved).
- Modify: `apps/run.human/webapp/src/lib/vanity-redirects.test.ts` — update the expected `h`
  targetUrl; add an assertion that `r`/`h` route through `q.defcon.run`.
- No module or other infra file changes.

- [ ] **Step 1 (done): edit `redirects.json` + test.** Validated JSON; `vanity-redirects`
  suite green.

- [ ] **Step 2: Seed the codes FIRST (behavior-preserving), needs prod creds.** Create `Qr`
  rows via the admin UI (`/use1/admin/qr/new`, requires Part A deployed) OR a raw-doc seed
  script:
  - `r` → base `destination` = `https://www.youtube.com/watch?v=dQw4w9WgXcQ` (today's rickroll).
  - `h` → base `destination` = `https://run.defcon.run/` (resolver splices `/use1`).
  Confirm `curl -sI https://q.defcon.run/R` and `/H` 302 to the seeded bases BEFORE applying
  redirects.json (else `r.`/`h.` would redirect to a 404).

- [ ] **Step 3: Apply the redirect-rules unit (needs terraform creds).**

```bash
cd infra/terraform/live/site/region/us-east-1/redirect-rules
terragrunt plan   # expect: 2 aws_s3_object.index updates (r,h) + 2 unassociated function updates. NO distro/DNS/ALB/cert change.
terragrunt apply
```

- [ ] **Step 4: Verify end to end.**

```bash
curl -sI https://q.defcon.run/R | grep -i location   # seeded rickroll base
curl -sL -o /dev/null -w '%{url_effective}\n' https://r.defcon.run/   # interstitial → q/R → youtube
```

Then in the admin UI add a near-future switch-point to code `r`, wait ~60s, re-check that
`q.defcon.run/R` flips. Confirm the `r.` unfurl card still renders (paste in a chat / view-source).

- [ ] **Step 5: Commit** (redirects.json + test committed on the PR branch with Part A).

---

## Self-Review

**Spec coverage:**
- Shared campaign code model → Tasks 2–6 (reuse `Qr`, no per-user). ✅
- Timeline of switch-points → Task 1 (`ScheduleEntry`), Task 4 (editor). ✅
- Compile to existing `rules`, no resolver change → Task 1 (`compileScheduleToRules`), Task 3 (compile-on-save); resolver untouched (Task 2 only adds an ignored attribute). ✅
- Fixed PT timezone → Task 1 (`ptWallClockToUtcIso`/`utcToPtParts`, `CON_TZ`). ✅
- Any date allowed; con days as presets → Task 1 (`CON_DAYS`), Task 4 ("+ any date" + con-day buttons). ✅
- Admin UI: list LIVE-now + per-code editor + Publish-now → Tasks 4, 5, 6. ✅
- `r.`/`h.` dynamic → Task 8. ✅
- Testing (compiler, PT, active-window, resolver parity) → Tasks 1–4 tests; resolver parity Task 2; E2E Tasks 7–8. ✅
- 60s propagation surfaced in UI → Tasks 4, 5 copy. ✅

**Placeholder scan:** No TBD/TODO. Task 5 references reading `QrForm.tsx` before editing because its exact state shape must be matched in place — the concrete additions (state, submit field, Publish-now handler) are given in full. Task 8 is explicitly human-gated with concrete commands.

**Type consistency:** `ScheduleEntry` (`{startsAt,dest,label?}`) is used identically across Tasks 1/3/4/5; `QrScheduleEntryInput` mirrors it on the input boundary; compiled rules use `{kind:"time",from,to,dest}` matching `rules.mjs`. `activeScheduleEntry`/`compileScheduleToRules`/`utcToPtParts`/`ptWallClockToUtcIso` names are consistent throughout.

**Scope:** Part A (Tasks 1–7) is a self-contained, unit-tested, shippable PR against `q.defcon.run` codes. Part B (Task 8) touches live infra and is deliberately staged behind a human-run apply.
