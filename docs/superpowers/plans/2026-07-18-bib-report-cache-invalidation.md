# Bib Report/List Caching with Write-Invalidation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the per-request DynamoDB full-table scan cost on the bib `/admin` dashboard and `/orderform` per-user reads by caching scan results (`unstable_cache`) and invalidating on writes (`revalidateTag`), with a 30s TTL backstop.

**Architecture:** A single new module `lib/report-cache.ts` owns all cache keys, tags, TTL, and the invalidation helpers. Read consumers (admin page, CSV report route, orderform `Promise.all`) swap raw scans for cached wrappers. Every *route-handler* mutation calls `invalidateBib(sub)` after a successful write. Three write paths that can't call `revalidateTag` (render-time `createBib`/`recordPending`, external SES `BibReconcile` Lambda) rely on the 30s TTL.

**Tech Stack:** Next.js 16.1.1 (`unstable_cache` + `revalidateTag` from `next/cache`), TypeScript, Vitest, ElectroDB/DynamoDB.

**Spec:** `docs/superpowers/specs/2026-07-18-bib-report-cache-invalidation-design.md`

## Global Constraints

- App root for all commands: `apps/run.bib/webapp`.
- Import alias: `@/*` → `./src/*` (e.g. `@/entities/general-donation`, `@/lib/admin-reports`).
- Cache primitive: `unstable_cache` (matches existing `lib/copy.ts`) — NOT the `'use cache'` directive.
- TTL for every cached read: `30` seconds.
- Tag names, exact: aggregate = `bib:reports`; per-owner = `bib:owner:${sub}`.
- `revalidateTag` may be called ONLY from route handlers — never during render.
- Next 16 requires a 2nd arg on `revalidateTag`: use `revalidateTag(tag, { expire: 0 })` for immediate hard expiry (read-your-writes across requests). The single-arg form is deprecated; the named SWR profiles (`"max"`) serve stale once more — do NOT use them here.
- Vitest requires Node ≥ 22.12: run `nvm use 22.12.0` before any `npm test`.
- `next build` gates every code task; the repo's ESLint config is broken in this environment (ignore lint).
- Branch: continue on `perf/auth-timeout-orderform-parallel` (this builds on PR #782). All commits co-authored `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## File Structure

- **Create** `src/lib/report-cache.ts` — cache wrappers + invalidation helpers (the only place tag strings live).
- **Create** `src/__tests__/report-cache.test.ts` — locks the tag contract (mocks `next/cache`).
- **Modify** `src/app/admin/page.tsx` — `loadReports()` → `getReportsCached()`.
- **Modify** `src/app/api/admin/bib/report/[type]/route.ts` — `loadReports()` → `getReportsCached()`.
- **Modify** `src/app/orderform/page.tsx` — two per-user scans → cached wrappers.
- **Modify** 8 route handlers — add `invalidateBib(...)` after writes:
  `api/stripe/webhook`, `api/admin/bib/{mark-paid,reconcile,reject,deny-pending,deny-pledge,reverse-payment}`, `api/bib`.

---

### Task 1: `report-cache.ts` module + tag-contract test

**Files:**
- Create: `src/lib/report-cache.ts`
- Test: `src/__tests__/report-cache.test.ts`

**Interfaces:**
- Consumes: `loadReports` from `@/lib/admin-reports`; `listDonationsForOwner` from `@/entities/general-donation`; `listPendingForOwner` from `@/entities/pending-contribution`.
- Produces:
  - `getReportsCached(): Promise<ReportBundle>` — cached `loadReports`.
  - `getDonationsForOwnerCached(sub: string): Promise<GeneralDonationItem[]>` — cached per-user donations.
  - `getPendingForOwnerCached(sub: string): Promise<PendingContributionItem[]>` — cached per-user pending.
  - `invalidateReports(): void`, `invalidateOwner(sub?: string | null): void`, `invalidateBib(sub?: string | null): void`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/report-cache.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock next/cache BEFORE importing the module under test.
// unstable_cache is stubbed to a pass-through factory so importing the module
// (which calls unstable_cache at load time) doesn't touch Next's request scope.
const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidateTag: (...args: unknown[]) => revalidateTag(...args),
}));

// The wrapped scan functions are irrelevant to the tag-contract test; stub them.
vi.mock("@/lib/admin-reports", () => ({ loadReports: vi.fn() }));
vi.mock("@/entities/general-donation", () => ({ listDonationsForOwner: vi.fn() }));
vi.mock("@/entities/pending-contribution", () => ({ listPendingForOwner: vi.fn() }));

import {
  invalidateBib,
  invalidateOwner,
  invalidateReports,
} from "@/lib/report-cache";

afterEach(() => revalidateTag.mockClear());

describe("report-cache invalidation tag contract", () => {
  it("invalidateReports hits only the aggregate tag", () => {
    invalidateReports();
    expect(revalidateTag).toHaveBeenCalledTimes(1);
    expect(revalidateTag).toHaveBeenCalledWith("bib:reports");
  });

  it("invalidateBib hits both the aggregate and the owner tag", () => {
    invalidateBib("sub-123");
    expect(revalidateTag).toHaveBeenCalledWith("bib:reports");
    expect(revalidateTag).toHaveBeenCalledWith("bib:owner:sub-123");
    expect(revalidateTag).toHaveBeenCalledTimes(2);
  });

  it("invalidateOwner is a no-op for a null/empty sub", () => {
    invalidateOwner(null);
    invalidateOwner(undefined);
    invalidateOwner("");
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("invalidateBib with a null sub still invalidates reports, skips owner", () => {
    invalidateBib(null);
    expect(revalidateTag).toHaveBeenCalledTimes(1);
    expect(revalidateTag).toHaveBeenCalledWith("bib:reports");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `nvm use 22.12.0 && npx vitest run src/__tests__/report-cache.test.ts`
Expected: FAIL — cannot resolve `@/lib/report-cache` (module does not exist yet).

- [ ] **Step 3: Write the module**

Create `src/lib/report-cache.ts`:

```ts
/**
 * SERVER-ONLY. Single source of truth for bib report/list caching.
 *
 * The bib /admin dashboard (loadReports — 4 full-table scans) and the
 * /orderform per-user reads (donations + pending scans) are cached with
 * unstable_cache so they run at most once per TTL per task instead of on
 * every request. Route-handler writes call invalidate* to drop the cache
 * immediately (same task). A 30s TTL is the backstop for the ≤2-task
 * process-local gap and the three writes that cannot revalidateTag
 * (render-time createBib/recordPending + the external SES BibReconcile Lambda).
 *
 * Tag strings live ONLY here — no consumer constructs them.
 */
import { unstable_cache, revalidateTag } from "next/cache";
import { loadReports } from "@/lib/admin-reports";
import { listDonationsForOwner } from "@/entities/general-donation";
import { listPendingForOwner } from "@/entities/pending-contribution";

const TTL_SECONDS = 30;
const REPORTS_TAG = "bib:reports";
const ownerTag = (sub: string) => `bib:owner:${sub}`;
// Next 16 requires a profile arg; { expire: 0 } = immediate hard expiry.
const IMMEDIATE = { expire: 0 } as const;

/** Cached admin report bundle. Tagged REPORTS_TAG only. */
export const getReportsCached = unstable_cache(loadReports, ["bib:admin-reports"], {
  tags: [REPORTS_TAG],
  revalidate: TTL_SECONDS,
});

/** Cached per-user donations. Tagged bib:owner:<sub> only, keyed by sub. */
export function getDonationsForOwnerCached(sub: string) {
  return unstable_cache(() => listDonationsForOwner(sub), ["bib:donations", sub], {
    tags: [ownerTag(sub)],
    revalidate: TTL_SECONDS,
  })();
}

/** Cached per-user pending contributions. Tagged bib:owner:<sub> only. */
export function getPendingForOwnerCached(sub: string) {
  return unstable_cache(() => listPendingForOwner(sub), ["bib:pending", sub], {
    tags: [ownerTag(sub)],
    revalidate: TTL_SECONDS,
  })();
}

/** Drop the admin aggregate cache. Call from route handlers only. */
export function invalidateReports(): void {
  revalidateTag(REPORTS_TAG, IMMEDIATE);
}

/** Drop one runner's per-user cache. No-op for a falsy sub. Route handlers only. */
export function invalidateOwner(sub?: string | null): void {
  if (sub) revalidateTag(ownerTag(sub), IMMEDIATE);
}

/**
 * Drop both the admin aggregate AND the runner's per-user cache — the common
 * case after any mutation to a specific runner's bib/donation/pending.
 * Route handlers only.
 */
export function invalidateBib(sub?: string | null): void {
  invalidateReports();
  invalidateOwner(sub);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `nvm use 22.12.0 && npx vitest run src/__tests__/report-cache.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0 (no errors). If `ReportBundle`/item types are needed for the return signatures, they are inferred from the wrapped functions — no explicit annotation required.

- [ ] **Step 6: Commit**

```bash
git add src/lib/report-cache.ts src/__tests__/report-cache.test.ts
git commit -m "feat(bib): report-cache module — cached scans + tag invalidation

unstable_cache wrappers (30s TTL) for loadReports + per-user donation/pending
lists, plus invalidateBib/invalidateReports/invalidateOwner. Unit test locks
the tag contract (bib:reports + bib:owner:<sub>).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Swap read consumers to the cached wrappers

**Files:**
- Modify: `src/app/admin/page.tsx` (the `await loadReports()` call, ~line 60)
- Modify: `src/app/api/admin/bib/report/[type]/route.ts` (the `await loadReports()` call, ~line 49)
- Modify: `src/app/orderform/page.tsx` (inside the `Promise.all`, the two per-user scans)

**Interfaces:**
- Consumes: `getReportsCached`, `getDonationsForOwnerCached`, `getPendingForOwnerCached` from Task 1.
- Produces: no new exports. Behavior identical to raw reads except served from cache.

- [ ] **Step 1: Admin page → cached reports**

In `src/app/admin/page.tsx`:
- Replace the import of `loadReports` from `@/lib/admin-reports` with `getReportsCached` from `@/lib/report-cache`. If `admin-reports` is imported for other symbols (e.g. `buildDashboard`, types), keep those and only drop `loadReports` from that import.
- Replace the call `const bundle = await loadReports();` (or whatever the local variable is named) with `const bundle = await getReportsCached();`. Keep everything downstream (`buildDashboard`, `Date.now()` age math) unchanged.

- [ ] **Step 2: CSV report route → cached reports**

In `src/app/api/admin/bib/report/[type]/route.ts`:
- Add `import { getReportsCached } from "@/lib/report-cache";`.
- Replace `await loadReports()` with `await getReportsCached()`. Drop the now-unused `loadReports` import if it has no other use in the file. Leave `runtime`/`dynamic`/`Cache-Control: no-store` as-is (the HTTP response stays uncached; only the underlying data read is cached ≤30s).

- [ ] **Step 3: Orderform → cached per-user reads**

In `src/app/orderform/page.tsx`, inside the existing `Promise.all` (from PR #782):
- Add to imports: `import { getDonationsForOwnerCached, getPendingForOwnerCached } from "@/lib/report-cache";`
- Change the two array elements from:
  ```ts
      listDonationsForOwner(ownerSub).catch(() => []),
      listPendingForOwner(ownerSub).catch(() => []),
  ```
  to:
  ```ts
      getDonationsForOwnerCached(ownerSub).catch(() => []),
      getPendingForOwnerCached(ownerSub).catch(() => []),
  ```
- Remove the now-unused `listDonationsForOwner` / `listPendingForOwner` imports (lines ~10–11) IF they have no other use in the file (they do not).
- Keep the `.catch(() => [])` wrappers — a transient scan failure must not be cached (unstable_cache never caches a throw) and must fall back to `[]`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Build**

Run: `npx next build`
Expected: build succeeds; `/admin`, `/orderform`, and `/api/admin/bib/report/[type]` all appear in the route list. No new warnings about the changed files.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/page.tsx "src/app/api/admin/bib/report/[type]/route.ts" src/app/orderform/page.tsx
git commit -m "perf(bib): serve /admin + orderform reads from report-cache

admin page + CSV route -> getReportsCached; orderform Promise.all -> cached
per-user donation/pending wrappers. Scans now run at most once per 30s per task.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Invalidate on every route-handler write

**Files (all Modify):**
- `src/app/api/stripe/webhook/route.ts`
- `src/app/api/admin/bib/mark-paid/route.ts`
- `src/app/api/admin/bib/reconcile/route.ts`
- `src/app/api/admin/bib/reject/route.ts`
- `src/app/api/admin/bib/deny-pending/route.ts`
- `src/app/api/admin/bib/deny-pledge/route.ts`
- `src/app/api/admin/bib/reverse-payment/route.ts`
- `src/app/api/bib/route.ts`

**Interfaces:**
- Consumes: `invalidateBib`, `invalidateReports` from `@/lib/report-cache`.
- Produces: nothing. Each handler calls the helper AFTER its write succeeds, BEFORE returning the response.

**Placement rule for every edit below:** add `import { invalidateBib } from "@/lib/report-cache";` (or `invalidateReports` where noted) to the file's imports, then insert the call on the success path immediately after the entity write returns and before the `NextResponse.json(...)` success return. Do not call it on validation-error / early-return paths.

- [ ] **Step 1: Stripe webhook**

`src/app/api/stripe/webhook/route.ts` — the handler branches on session type:
- After the **bib** branch's `applyPayment(...)` succeeds (ownerSub = `session.metadata.owner_sub`): `invalidateBib(ownerSub);`
- After the **general donation** branch's `recordDonation(...)` succeeds (ownerSub may be null for anon): `invalidateBib(ownerSub ?? null);` (invalidateBib already skips the owner tag when null, still drops `bib:reports`).

- [ ] **Step 2: mark-paid**

`src/app/api/admin/bib/mark-paid/route.ts` — after `applyPayment(...)` succeeds, `ownerSub` from the request body: `invalidateBib(ownerSub);`

- [ ] **Step 3: reconcile**

`src/app/api/admin/bib/reconcile/route.ts` — after the write completes (bib `applyPayment` OR donation `recordDonation`, and the `clearPendingById` delete), `ownerSub` from body: `invalidateBib(ownerSub);`

- [ ] **Step 4: reject**

`src/app/api/admin/bib/reject/route.ts` — after `Bib.delete` + `clearPendingForOwner`, `ownerSub` from body: `invalidateBib(ownerSub);`

- [ ] **Step 5: deny-pending (parse ownerSub from pendingId)**

`src/app/api/admin/bib/deny-pending/route.ts` — the body carries only `pendingId` (format `pending:{ownerSub}:{kind}:{provider}:{amt}`). After `denyPendingById(...)` succeeds:

```ts
// pendingId = "pending:{ownerSub}:{kind}:{provider}:{amt}" — index [1] is ownerSub.
const deniedOwnerSub = typeof pendingId === "string" ? pendingId.split(":")[1] : undefined;
if (deniedOwnerSub) invalidateBib(deniedOwnerSub);
else invalidateReports(); // fallback: at least refresh the admin aggregate
```
Add both `invalidateBib` and `invalidateReports` to the import from `@/lib/report-cache`.

- [ ] **Step 6: deny-pledge**

`src/app/api/admin/bib/deny-pledge/route.ts` — after `updateBibWillPayInPerson(ownerSub, false)` succeeds, `ownerSub` from body: `invalidateBib(ownerSub);`

- [ ] **Step 7: reverse-payment**

`src/app/api/admin/bib/reverse-payment/route.ts` — after `reverseCashPayment(...)` succeeds, `ownerSub` from body: `invalidateBib(ownerSub);`

- [ ] **Step 8: api/bib (POST create + PATCH name/pledge/burn)**

`src/app/api/bib/route.ts` — `session.user.id` is the ownerSub (`:136` POST, `:174` PATCH):
- POST handler, after `createBib(...)` succeeds: `invalidateBib(session.user.id);`
- PATCH handler, after whichever of `updateBibName` / `updateBibWillPayInPerson` / `updateBibBurned` runs and succeeds: `invalidateBib(session.user.id);` (place once on the shared success path before the response — if the branches return separately, add it to each success return).

- [ ] **Step 9: Coverage check**

Run: `grep -rl "applyPayment\|recordDonation\|updateBibName\|updateBibWillPayInPerson\|updateBibBurned\|reverseCashPayment\|clearPending\|Bib.delete\|denyPendingById\|createBib" src/app/api | sort`
Then: `grep -rl "invalidateBib\|invalidateReports" src/app/api | sort`
Expected: every file in the first list that is a *route handler mutation* appears in the second list. The only expected write-path files NOT in the second list are non-route mutations (none under `src/app/api`) — the render-time `createBib`/`recordPending` live under `src/app/orderform` and `src/app/sponsor`, which are intentionally excluded (TTL backstop). Note any discrepancy.

- [ ] **Step 10: Typecheck + build**

Run: `npx tsc --noEmit` → exit 0.
Run: `npx next build` → succeeds, all API routes present.

- [ ] **Step 11: Commit**

```bash
git add src/app/api
git commit -m "perf(bib): invalidate report-cache on every write chokepoint

Each route-handler mutation (stripe webhook, mark-paid, reconcile, reject,
deny-pending, deny-pledge, reverse-payment, api/bib create+patch) drops the
report + owner cache after a successful write. deny-pending parses ownerSub
from pendingId. Render-time createBib/recordPending + external BibReconcile
Lambda rely on the 30s TTL (documented in the spec).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Full verification + PR

- [ ] **Step 1: Full test suite**

Run: `nvm use 22.12.0 && npm test`
Expected: all tests pass (including the new `report-cache.test.ts`). Pre-existing failures unrelated to these files are acceptable — note them.

- [ ] **Step 2: Final build**

Run: `npx next build`
Expected: succeeds.

- [ ] **Step 3: Push + open PR**

```bash
git pull --rebase
git push
```
Open a PR (base `main`) describing: the caching approach, the 30s TTL backstop, the invalidation table, and the three TTL-only paths. Link the spec. Do NOT merge — await review.

---

## Self-Review Notes

- **Spec coverage:** module (Task 1) ✓; admin + CSV + orderform consumers (Task 2) ✓; all 8 write route files with correct ownerSub source per the chokepoint map (Task 3) ✓; deny-pending pendingId parse ✓; anon-donation null ownerSub handled ✓; unit test for tag contract ✓; TTL=30 + tag names verbatim ✓; TTL-only paths documented ✓.
- **Excluded by design (TTL backstop):** render-time `createBib` (orderform), `recordPending` (sponsor venmo/cashapp), external SES `BibReconcile` — not in Task 3 on purpose; called out in Step 9 coverage check.
- **Type consistency:** helper names identical across tasks (`getReportsCached`, `getDonationsForOwnerCached`, `getPendingForOwnerCached`, `invalidateBib`, `invalidateReports`, `invalidateOwner`); tag strings only defined in Task 1.
