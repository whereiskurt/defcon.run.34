/**
 * SERVER-ONLY. Single source of truth for bib report/list caching.
 *
 * The bib /admin dashboard (loadReports — 4 full-table scans) and the
 * /orderform per-user reads (donations + pending scans) are cached with
 * unstable_cache so they run at most once per TTL per task instead of on
 * every request. Route-handler writes call invalidate* to drop the cache
 * immediately (same task). A 30s TTL is the backstop for the ≤2-task
 * process-local gap (revalidateTag is process-local — no shared cacheHandler)
 * and the three writes that cannot revalidateTag: render-time createBib
 * (orderform) + recordPending (sponsor pages) and the external SES
 * BibReconcile Lambda.
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

/**
 * Next 16 requires a profile arg on revalidateTag. `{ expire: 0 }` = immediate
 * hard expiry (the next request recomputes synchronously → read-your-writes
 * across requests). The named SWR profiles ("max" etc.) would serve the stale
 * pre-write value once more, which we do NOT want after a payment/name change.
 * It also avoids the single-arg deprecation warning.
 */
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
