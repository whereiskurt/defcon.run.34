/**
 * Admin reporting assembly (Phase 43, ADMN-02/03/04/05/07).
 *
 * Pure-where-possible server-side utility that JOINS every Plan-03 read helper
 * into one report row set for the admin users dashboard + CSV export:
 *
 *   scanAllRunUsers()            → the row spine (userId, displayName, hash,
 *                                  timestamps, checkInCount)
 *   getAuthUserEmails()          → userId → FULL email (PII; masked downstream)
 *   getQuotaByType(gpx_*)        → per-user gpx usage counts (routes/saves/shares)
 *   scanAllUploads()             → userId → {gpx,photo} count map (ONE scan)
 *   scanAccountSubs()            → adapterUserId → OIDC sub
 *   scanRunnerCodesBySub()       → OIDC sub → bib runnerCode
 *
 * The bib-code join is a pure map compose (scanAccountSubs ∘ scanRunnerCodesBySub)
 * — ZERO per-row resolvers. The uploads column comes from the single
 * scanAllUploads() map, never listUploadsByUser per row.
 *
 * SECURITY: buildUserReport() returns FULL emails (emailFull) so the admin-gated
 * route (Plan 04 Task 2) decides masking/reveal. maskEmail() guarantees the JSON
 * view never leaks more than the first local-part char. This module must NEVER be
 * imported into a client component.
 */

import { scanAllRunUsers, type RunUserItem } from "@/entities/run-user";
import { getAuthUserEmails } from "@/entities/auth-user";
import { scanAccountSubs } from "@/entities/auth-user";
import { scanRunnerCodesBySub } from "@/entities/bib";
import { scanAllUploads } from "@/entities/user-upload";
import {
  getQuotaByType,
  getAllProfileServices,
  type QuotaByTypeRow,
} from "@/lib/quota-client";

/** One assembled row for the admin users report. `emailFull` is PII. */
export type UserReportRow = {
  displayName: string;
  userId: string;
  emailFull: string | null;
  emailMasked: string;
  bibCode: string | null;
  qrUrl: string;
  signedUpAt: number | null;
  lastLoginAt: number | null;
  lastActivityAt: number | null;
  checkInCount: number;
  gpxRoutes: number;
  gpxSaves: number;
  gpxShares: number;
  gpxUploads: number;
  photoUploads: number;
  uploads: number;
  /** run.human runner class (mqttUsertype): rabbit / wildhare (hare) / admin / og. */
  runnerType: "rabbit" | "admin" | "wildhare" | "og" | null;
  services: string[];
};

export type ReportSort = "lastActivity" | "gpxUsage" | "signup";

export type SummaryTiles = {
  totalUsers: number;
  newSignups7d: number;
  active7d: number;
  withGpxActivity: number;
};

/**
 * Mask an email so the JSON view never leaks more than the first local-part
 * char: "kurt@gmail.com" → "k•••@gmail.com". Returns "" for null/empty and a
 * bare "•••" for a malformed value (no local part / no "@") so we never echo
 * unmasked input. PURE.
 */
export function maskEmail(email: string | null): string {
  if (!email) return "";
  const at = email.indexOf("@");
  if (at <= 0) return "•••";
  const first = email[0];
  const domain = email.slice(at); // includes the leading "@"
  return `${first}•••${domain}`;
}

/**
 * Runner QR URL from a RunUser.hash, matching the run-user.ts template
 * (`https://run.<siteDomain>/<REGION_SHORT>/r?h=<hash>`). Uses env with the
 * deployment defaults. PURE.
 */
export function runnerQrUrl(hash?: string): string {
  const siteDomain = process.env.SITE_DOMAIN || "defcon.run";
  const region = process.env.REGION_SHORT || "use1";
  return `https://run.${siteDomain}/${region}/r?h=${hash ?? ""}`;
}

/** Escape one CSV cell (RFC-4180: quote when it contains ",\n or "). PURE. */
export function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialize labelled columns + rows to a CSV string. PURE. */
export function toCsv(
  columns: { key: string; header: string }[],
  rows: Record<string, unknown>[]
): string {
  const head = columns.map((c) => csvCell(c.header)).join(",");
  const body = rows.map((row) =>
    columns.map((c) => csvCell(row[c.key])).join(",")
  );
  return [head, ...body].join("\n");
}

/**
 * lastActivityAt = max(updatedAt, lastLoginAt, lastCheckInAt), or null if the
 * user has none of the three. Extracted so it is unit-testable without mocking
 * the scans. PURE.
 */
export function lastActivityOf(u: {
  updatedAt?: number;
  lastLoginAt?: number;
  lastCheckInAt?: number;
}): number | null {
  const max = Math.max(u.updatedAt ?? 0, u.lastLoginAt ?? 0, u.lastCheckInAt ?? 0);
  return max > 0 ? max : null;
}

/** Total gpx usage (routes + saves + shares) for a row. PURE. */
function gpxUsageOf(r: UserReportRow): number {
  return r.gpxRoutes + r.gpxSaves + r.gpxShares;
}

/** Sort rows DESC by the requested key (lastActivity default). PURE, non-mutating. */
export function sortRows(rows: UserReportRow[], sort: ReportSort): UserReportRow[] {
  const key = (r: UserReportRow): number => {
    switch (sort) {
      case "gpxUsage":
        return gpxUsageOf(r);
      case "signup":
        return r.signedUpAt ?? 0;
      case "lastActivity":
      default:
        return r.lastActivityAt ?? 0;
    }
  };
  return [...rows].sort((a, b) => key(b) - key(a));
}

/** Filter rows by FULL-email substring (case-insensitive). PURE, non-mutating. */
export function filterByEmail(rows: UserReportRow[], q: string): UserReportRow[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((r) => (r.emailFull ?? "").toLowerCase().includes(needle));
}

/** Dashboard summary tiles over the given rows. PURE. */
export function summaryTiles(rows: UserReportRow[]): SummaryTiles {
  const now = Date.now();
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  return {
    totalUsers: rows.length,
    newSignups7d: rows.filter((r) => r.signedUpAt != null && now - r.signedUpAt <= WEEK)
      .length,
    active7d: rows.filter(
      (r) => r.lastActivityAt != null && now - r.lastActivityAt <= WEEK
    ).length,
    withGpxActivity: rows.filter((r) => gpxUsageOf(r) > 0).length,
  };
}

/**
 * Resolve a user's services through the adapter→sub→services bridge: the same
 * namespace hop the bib-code join uses. `adapterToSub` maps the Auth.js adapter
 * uuid (RunUser.userId) to the OIDC sub; `servicesBySub` is keyed by that sub.
 * Returns [] when either hop misses. PURE.
 */
export function servicesForUser(
  userId: string,
  adapterToSub: Record<string, string>,
  servicesBySub: Record<string, string[]>
): string[] {
  const sub = adapterToSub[userId];
  return sub ? servicesBySub[sub] ?? [] : [];
}

/** Index a bulk quota-by-type response by userId → consumptionCount. PURE. */
function indexQuota(rows: QuotaByTypeRow[]): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.userId] = r.consumptionCount;
    return acc;
  }, {});
}

/**
 * Assemble the full report row set. Fires the underlying reads concurrently:
 * ONE RunUser scan, one email map (sequential gets inside), one bulk gpx-usage
 * fetch per quota type, one uploads count map, and the two bib-namespace maps.
 * Returns FULL rows (emailFull populated) — the route masks/reveals.
 */
export async function buildUserReport(): Promise<UserReportRow[]> {
  const users = await scanAllRunUsers();
  const userIds = users.map((u) => u.userId);

  const [
    emails,
    gpxUpload,
    gpxSave,
    gpxShare,
    uploadsMap,
    adapterToSub,
    subToCode,
    servicesBySub,
  ] = await Promise.all([
    getAuthUserEmails(userIds),
    getQuotaByType("gpx_upload"),
    getQuotaByType("gpx_save"),
    getQuotaByType("gpx_share"),
    scanAllUploads(),
    scanAccountSubs(),
    scanRunnerCodesBySub(),
    getAllProfileServices(),
  ]);

  const routesIdx = indexQuota(gpxUpload);
  const savesIdx = indexQuota(gpxSave);
  const sharesIdx = indexQuota(gpxShare);

  return users.map((u: RunUserItem) => {
    const sub = adapterToSub[u.userId];
    const bibCode = sub ? subToCode[sub] ?? null : null;
    const up = uploadsMap[u.userId] ?? { gpx: 0, photo: 0 };
    const emailFull = emails[u.userId] ?? null;

    return {
      displayName: u.displayName ?? "",
      userId: u.userId,
      emailFull,
      emailMasked: maskEmail(emailFull),
      bibCode,
      qrUrl: runnerQrUrl(u.hash),
      signedUpAt: u.createdAt ?? null,
      lastLoginAt: u.lastLoginAt ?? null,
      lastActivityAt: lastActivityOf(u),
      checkInCount: u.checkInCount ?? 0,
      gpxRoutes: routesIdx[u.userId] ?? 0,
      gpxSaves: savesIdx[u.userId] ?? 0,
      gpxShares: sharesIdx[u.userId] ?? 0,
      gpxUploads: up.gpx,
      photoUploads: up.photo,
      uploads: up.gpx + up.photo,
      runnerType: u.mqttUsertype ?? null,
      // Services live on the AuthProfile (keyed by OIDC sub), joined through the
      // SAME adapter→sub bridge as the bib code — a pure map lookup, no fan-out.
      services: servicesForUser(u.userId, adapterToSub, servicesBySub),
    };
  });
}
