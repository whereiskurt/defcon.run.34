# Design: bib report/list caching with write-invalidation

**Date:** 2026-07-18
**App:** `apps/run.bib/webapp`
**Depends on:** PR #782 (`perf/auth-timeout-orderform-parallel`) — the orderform `Promise.all` and auth timeout land first; this builds on that branch.
**Goal:** Remove the per-request DynamoDB full-table **scan** cost from the bib `/admin` dashboard and the `/orderform` per-user reads by caching the scan results and invalidating on writes. Loads become O(1) cache hits; scans run at most once per TTL per task.

## Problem

At DEF CON 34 scale (single-thousands of bibs) the scans are a **latency/RCU** problem, not a correctness one:

- **`/admin`** (`lib/admin-reports.ts` `loadReports()`, line ~467) runs **4 unbounded `scan.go({ pages: "all" })`** (Bib, GeneralDonation, BibReconcile, PendingContribution) over the *shared* `run-human-electro` table on a `force-dynamic` route — every load re-scans, and each scan reads the whole shared table (incl. run.human rows) then filters by entity.
- **`/orderform`** reads `listDonationsForOwner` + `listPendingForOwner` — both **full-table scans** filtered by `ownerSub` (no GSI). Now parallelized (PR #782) but still one scan of floor latency.

The codebase authors already deferred the GSI option (`admin-reports.ts`: "a GSI is a v1.7+ option if it bites"; `general-donation.ts`: ownerSub-GSI deliberately not added). Caching is the app-only, no-infra, no-backfill path aligned with that posture.

## Constraints (discovered)

1. **`revalidateTag` is process-local.** Next 16.1.1, **no custom `cacheHandler`** configured. bib ECS `desired_count=1` but `max_capacity=2` — so a write on task A does not clear task B's cache. → A **TTL backstop is mandatory**, not optional.
2. **Three writes cannot call `revalidateTag`:**
   - `createBib` on first `/orderform` visit — runs during **render** (empty, money-less bib).
   - `recordPending` on `app/sponsor/venmo/page.tsx` + `app/sponsor/cashapp/page.tsx` — runs during **render** (user's pending intent).
   - `BibReconcile` rows — written by an **external SES Lambda** (Phase 22), not in `webapp/src`.
   These rely on the TTL backstop for eventual consistency.
3. **`deny-pending` route lacks `ownerSub` in scope** — body carries only `pendingId` (format `pending:{ownerSub}:{kind}:{provider}:{amt}`); parse `ownerSub` from it.
4. **`/api/checkout/*` do not write tracked entities** — only Stripe session creation; the entity write happens later in `/api/stripe/webhook`. No invalidation needed there.
5. **`unstable_cache` is the established primitive** (`lib/copy.ts`) — reuse it, not the newer `'use cache'` directive.

## Decisions

- **TTL:** **30s** for all cached reads. Bounds staleness for the render-time writes, the external reconcile Lambda, and the ≤2-task process-local gap.
- **Sponsor-page pending gap:** **accept the TTL backstop** — do not restructure the sponsor render-time writes. Worst case a Venmo/CashApp pending row appears on `/orderform` within 30s.
- **Transient-failure safety:** cached wrappers call the raw scan (which may throw); `unstable_cache` does **not** cache a thrown error, and the orderform call sites keep their `.catch(() => [])`. So a transient scan failure yields the empty fallback for that one request and is never persisted as the cached value. `loadReports` keeps its current no-catch behavior (admin 500s on scan failure — unchanged).

## Architecture

### New module: `lib/report-cache.ts`
Single source of truth for cache keys, tags, TTL, and invalidation. No consumer constructs a tag string directly.

```ts
import { unstable_cache, revalidateTag } from "next/cache";
import { loadReports } from "./admin-reports";
import { listDonationsForOwner } from "@/entities/general-donation";
import { listPendingForOwner } from "@/entities/pending-contribution";

const TTL = 30;
const REPORTS_TAG = "bib:reports";
const ownerTag = (sub: string) => `bib:owner:${sub}`;

// Admin aggregate — tagged only REPORTS_TAG.
export const getReportsCached = unstable_cache(
  loadReports,
  ["bib:admin-reports"],
  { tags: [REPORTS_TAG], revalidate: TTL },
);

// Per-user — tagged only ownerTag(sub). Keyed by sub so users don't collide.
export function getDonationsForOwnerCached(sub: string) {
  return unstable_cache(
    () => listDonationsForOwner(sub),
    ["bib:donations", sub],
    { tags: [ownerTag(sub)], revalidate: TTL },
  )();
}
export function getPendingForOwnerCached(sub: string) {
  return unstable_cache(
    () => listPendingForOwner(sub),
    ["bib:pending", sub],
    { tags: [ownerTag(sub)], revalidate: TTL },
  )();
}

// Invalidation — call ONLY from route handlers (never during render).
export function invalidateReports() { revalidateTag(REPORTS_TAG); }
export function invalidateOwner(sub?: string | null) { if (sub) revalidateTag(ownerTag(sub)); }
export function invalidateBib(sub?: string | null) { invalidateReports(); invalidateOwner(sub); }
```

Tag separation is deliberate: a mutation on owner X invalidates `bib:reports` (admin sees it) **and** `bib:owner:X` (X sees it) via `invalidateBib(X)`, leaving owner Y's cache intact.

### Consumers (swap raw → cached)
- `app/admin/page.tsx`: `loadReports()` → `getReportsCached()`.
- `app/api/admin/bib/report/[type]/route.ts` (CSV): `loadReports()` → `getReportsCached()` (≤30s stale CSV is fine).
- `app/orderform/page.tsx` (inside the existing `Promise.all`): `listDonationsForOwner(ownerSub)` → `getDonationsForOwnerCached(ownerSub)`; `listPendingForOwner(ownerSub)` → `getPendingForOwnerCached(ownerSub)`. Keep the `.catch(() => [])` wrappers.

### Invalidation call sites (route handlers only)
| Route | Entity write | Call |
|---|---|---|
| `api/stripe/webhook` (bib branch) | Bib (`applyPayment`) | `invalidateBib(ownerSub)` |
| `api/stripe/webhook` (general branch) | GeneralDonation (`recordDonation`) | `invalidateReports()` + `invalidateOwner(ownerSub)` (ownerSub may be null for anon) |
| `api/admin/bib/mark-paid` | Bib | `invalidateBib(ownerSub)` |
| `api/admin/bib/reconcile` | Bib or GeneralDonation + delete Pending | `invalidateBib(ownerSub)` |
| `api/admin/bib/reject` | delete Bib + Pending | `invalidateBib(ownerSub)` |
| `api/admin/bib/deny-pending` | Pending (soft-delete) | parse `ownerSub` from `pendingId` → `invalidateBib(sub)`; fallback `invalidateReports()` |
| `api/admin/bib/deny-pledge` | Bib (`willPayInPerson=false`) | `invalidateBib(ownerSub)` |
| `api/admin/bib/reverse-payment` | Bib (`reverseCashPayment`) | `invalidateBib(ownerSub)` |
| `api/bib` POST (`createBib`) | Bib | `invalidateBib(session.user.id)` |
| `api/bib` PATCH (name / pledge / burn) | Bib | `invalidateBib(session.user.id)` |

Call the helper **after** the write succeeds. `revalidateTag` is synchronous and safe to call unconditionally in a route handler.

### Not invalidated (TTL backstop only — documented)
- First-visit `createBib` during `/orderform` render (empty bib; admin `bibCount` lags ≤30s).
- `recordPending` during sponsor `venmo`/`cashapp` render (pending intent; user + admin lag ≤30s).
- External SES Lambda `BibReconcile` writes (admin reconcile section lags ≤30s).

## Testing / verification
- **Unit test** `__tests__/report-cache.test.ts` (mock `next/cache`, mirroring `copy.test.ts`): assert `invalidateBib(sub)` calls `revalidateTag` with exactly `bib:reports` and `bib:owner:<sub>`; `invalidateOwner(null)` is a no-op; `invalidateReports()` hits only `bib:reports`. This locks the tag contract that invalidation correctness depends on.
- `npx tsc --noEmit` clean.
- `npx next build` succeeds (`/admin`, `/orderform`, CSV route build).
- Manual/UAT (Kurt, post-deploy): after a mark-paid / name-change, admin + the runner's orderform reflect it near-immediately when served by the same task; within 30s otherwise.

## Out of scope (future, if it ever bites at larger scale)
GSI elimination of the scans (query instead of scan) — requires a Terraform GSI on the shared `run-human-electro` table + a prod backfill of index keys on existing items. Deferred per the authors' stated posture; caching is sufficient at con scale.
