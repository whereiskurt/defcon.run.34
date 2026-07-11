# Phase 43: run.human Admin Reporting Dashboard - Pattern Map

**Mapped:** 2026-07-11
**Files analyzed:** 9 new/modified files
**Analogs found:** 9 / 9 (every file has a concrete in-repo analog)

All excerpts below are verbatim from the current codebase with file paths + line
numbers. This is a **read-only** phase: the only cross-app addition is one ~30-line
run.auth bulk endpoint; everything else lives in run.human.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `apps/run.human/webapp/src/lib/admin-gate.ts` (NEW) | utility | transform (pure sync gate) | `apps/run.bib/webapp/src/lib/admin-gate.ts` | exact (copy verbatim) |
| `apps/run.human/webapp/src/app/admin/page.tsx` (NEW) | page (server component) | request-response (read) | `apps/run.bib/webapp/src/app/admin/page.tsx` | exact |
| `apps/run.human/webapp/src/app/api/admin/users/route.ts` (NEW) | route/controller | request-response + CRUD-read + CSV stream | `apps/run.human/webapp/src/app/api/admin/quota/route.ts` (gate) + `apps/run.bib/webapp/src/app/api/admin/bib/report/[type]/route.ts` (CSV) | role-match (composite) |
| `apps/run.human/webapp/src/lib/admin-report.ts` (NEW — CSV + row assembly helpers) | utility | transform | `apps/run.bib/webapp/src/lib/admin-reports.ts` | exact |
| `apps/run.human/webapp/src/entities/run-user.ts` (MODIFY — add `scanAllRunUsers`) | model | batch (scan) | `Bib.scan.go({ pages: "all" })` in `admin-reports.ts:421-429` | exact |
| `apps/run.human/webapp/src/entities/auth-user.ts` (NEW — email lookup from authjs USER#) | model | CRUD-read (key-get) | `resolveOidcSub` in `apps/run.human/webapp/src/entities/bib.ts:59-72` | role-match (query→get) |
| `apps/run.auth/webapp/src/app/api/internal/quota/by-type/[quotaId]/route.ts` (NEW) | route | request-response (GSI query) | `apps/run.auth/webapp/src/app/api/internal/quota/[userId]/route.ts` | exact |
| `apps/run.auth/webapp/src/services/quota.ts` (MODIFY — add `listQuotaByType`) | service | CRUD-read (GSI query) | `UserQuota.query.primary(...)` at `quota.ts:362` + `byQuotaRemaining` GSI (`user-quota.ts:83-88`) | role-match |
| `apps/run.human/webapp/src/lib/quota-client.ts` (MODIFY — add bulk fetch fn) | utility (HTTP client) | request-response | `getUserQuotas` in `quota-client.ts:116-118` | exact |

> **Bib code (`runnerCode`)** is read via the EXISTING `getRunnerCode(userId)` in
> `apps/run.human/webapp/src/entities/bib.ts` — no new file. To avoid N fan-out
> (CONTEXT lines 76-79), build a `sub → runnerCode` map once from a single
> `Bib.scan` (same pattern as `run-user.ts` scan below) OR resolve lazily on row
> expand. Do NOT call `getRunnerCode` per row in the list.

---

## Pattern Assignments

### `apps/run.human/webapp/src/lib/admin-gate.ts` (utility, pure sync gate)

**Analog:** `apps/run.bib/webapp/src/lib/admin-gate.ts` — **copy verbatim** into
run.human. It is app-agnostic (only reads `session.user.services`). This gives
page + users API + CSV one shared gate, exactly as CONTEXT specifies (lines 136-137).

**Core pattern** (`admin-gate.ts:28-56`):
```typescript
export function isAdmin(session: SessionLike): boolean {
  const services = session?.user?.services;
  return Array.isArray(services) && services.includes("admin");
}

export type RequireAdminResult =
  | { ok: true; email: string | null }
  | { ok: false; reason: "no_session" | "not_admin" };

export function requireAdmin(session: SessionLike): RequireAdminResult {
  if (!session?.user) return { ok: false, reason: "no_session" };
  if (!isAdmin(session)) return { ok: false, reason: "not_admin" };
  return { ok: true, email: session.user.email ?? null };
}
```

**Gate idiom already in run.human** (identical semantics) at
`apps/run.human/webapp/src/app/api/admin/quota/route.ts:10-13`:
```typescript
function isAdmin(session: { user?: { services?: string[] } } | null): boolean {
  if (!session?.user?.services) return false;
  return session.user.services.includes("admin");
}
```

**Phase-43 twist — 404 not 403, plus synchronous fresh-claims revalidation.**
The bib gate maps `not_admin → 403`. CONTEXT (lines 38-39, 49-52) requires a **404**
for non-admin/unauthenticated (don't advertise the route) AND a synchronous
revalidation on entry. Wrap `requireAdmin` with a fresh-claims check that reuses the
EXISTING internal-secret validate path — see Shared Pattern "Fresh-claims
revalidation" below. On any failure, `notFound()` (page) / `404` (API).

---

### `apps/run.human/webapp/src/app/admin/page.tsx` (page, server component, read)

**Analog:** `apps/run.bib/webapp/src/app/admin/page.tsx` — same shape: server
component, `runtime = "nodejs"`, `dynamic = "force-dynamic"`, gate → load data
in-process → render summary tiles + tables with a CSV download link.

**Server-component skeleton + gate** (`page.tsx:31-57`):
```typescript
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await auth();
  const gate = requireAdmin(session);
  if (!gate.ok && gate.reason === "no_session") redirect("/signin");
  if (!gate.ok) return <Forbidden />;
  const bundle = await loadReports();
  // ...render tiles + tables
}
```
> **Phase-43 change:** replace `return <Forbidden />` with `notFound()` (import
> `{ notFound } from "next/navigation"`) so non-admins get a 404, and run the
> fresh-claims revalidation before loading data (Shared Pattern below).

**CSV-download-link + basePath idiom** (`page.tsx:39-43`, `689-702`) — reuse for the
"Download CSV" button. Plain `<a href>` is NOT auto-prefixed with the region
basePath in production, so prepend it:
```typescript
function apiBase(): string {
  return process.env.NODE_ENV === "production"
    ? `/${process.env.NEXT_PUBLIC_REGION_SHORT || "use1"}`
    : "";
}
// ...
<a href={`${base}/api/admin/users?format=csv&...`}>Download CSV</a>
```

**Summary tiles / Chip + Table components** (`page.tsx:352-359` `Chip`, `712-805`
`Table`) are self-contained, inline-styled, and directly reusable for the tiles
(total users · new 7d · active 7d · gpx-active) and the paginated user table. The
`Table` already implements a sticky first column + horizontal scroll for mobile.

> **Discretion (CONTEXT 98-101):** table library vs hand-rolled, page size, mask
> format. The bib page hand-rolls plain inline-styled tables — follow that "boring,
> single-file" convention unless proven insufficient. run.human also has HeroUI
> available (see AGENTS.md) if a richer sortable table is wanted.

---

### `apps/run.human/webapp/src/app/api/admin/users/route.ts` (route, read + CSV)

This is the composite workhorse. It has three analogs, one per concern.

**(a) Gate + session read** — from `api/admin/quota/route.ts:70-84` (adapt 403→404):
```typescript
const session = await auth();
if (!session?.user?.id) return NextResponse.json({...}, { status: 401 }); // → 404 here
if (!isAdmin(session)) return NextResponse.json({...}, { status: 403 });   // → 404 here
```
Use the shared `requireAdmin` + fresh-claims revalidation instead; return a bare
`new Response(null, { status: 404 })` on any denial (do not leak existence).

**(b) CSV attachment response** — from
`apps/run.bib/webapp/src/app/api/admin/bib/report/[type]/route.ts:47-57`:
```typescript
const csv = reportToCsv(bundle, type as ReportType);
return new Response(csv, {
  status: 200,
  headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="bib-${type}.csv"`,
    "Cache-Control": "no-store",
  },
});
```
> Phase-43: filename includes the date (CONTEXT 93), e.g.
> `run-users-2026-07-11.csv`; ISO timestamps in cells; CSV carries FULL emails / QR
> URLs / bib codes (CONTEXT 93-96). Branch on `?format=csv` → this Response; else
> return JSON (masked emails) for the page/client.

**(c) CSV serialization helpers** — copy `csvCell` + `toCsv` from
`apps/run.bib/webapp/src/lib/admin-reports.ts:440-455` into the new
run.human `lib/admin-report.ts` (RFC-4180 escaping, already handles `" , \n`):
```typescript
function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(columns: {key:string;header:string}[], rows: Record<string,unknown>[]): string {
  const head = columns.map((c) => csvCell(c.header)).join(",");
  const body = rows.map((row) => columns.map((c) => csvCell(row[c.key])).join(","));
  return [head, ...body].join("\n");
}
```

**Runner QR URL construction** (CONTEXT 71-74, spec 84-88) — build from RunUser
`hash` exactly as `run-user.ts:191` does:
```typescript
`https://run.${siteDomain}/${REGION_SHORT}/r?h=${hash}`
// siteDomain = process.env.SITE_DOMAIN, REGION_SHORT = process.env.REGION_SHORT
```
`eqr` (the pre-rendered QR data-URL of that same link) is optional row-expand only.

> Route file should set `export const runtime = "nodejs"` and
> `export const dynamic = "force-dynamic"` — ElectroDB scans need Node crypto for
> AWS SDK signing (see the note at `report/[type]/route.ts:16-20`).

**Per-row email reveal:** CONTEXT (57) says reveal only on explicit request. Simplest
boring option = a query param on THIS same route (`?reveal=<userId>` returns that one
full email) rather than a separate `[userId]` route — Claude's discretion (CONTEXT
98-101). Never ship unrevealed full emails to the client.

---

### `apps/run.human/webapp/src/entities/run-user.ts` (MODIFY — add `scanAllRunUsers`)

**Analog:** the scan idiom in `admin-reports.ts:421-429`. `RunUser` has **no
list-all GSI** (`run-user.ts:132-143` only `primary` + `byHash`), so the list is a
full scan — ElectroDB auto-filters by entity (CONTEXT 42-44, spec 131-133).

Add alongside the existing `getRunUser` (`run-user.ts:236-239`):
```typescript
export async function scanAllRunUsers(): Promise<RunUserItem[]> {
  const result = await RunUser.scan.go({ pages: "all" });
  return result.data;
}
```
`RunUserItem` (already exported, `run-user.ts:326-350`) is the row shape; surfaces
`displayName`, `createdAt`, `updatedAt`, `lastLoginAt`, `lastCheckInAt`,
`checkInCount`, `hash`, `eqr`. "Last activity" = `max(updatedAt, lastLoginAt,
lastCheckInAt)` (CONTEXT 45-46). The `.where(...)` filter variant is at
`services/quota.ts:61-65` if a filtered scan is ever needed.

---

### `apps/run.human/webapp/src/entities/auth-user.ts` (NEW — email from authjs USER#)

**Analog:** `resolveOidcSub` in `apps/run.human/webapp/src/entities/bib.ts:59-72` —
same `dynamodbClient` + `DYNAMODB_TABLE` (= `run-human-authjs`), same `USER#{id}` key
namespace. Emails live on the Auth.js adapter USER# record, NOT on RunUser (CONTEXT
51-54). Adapter USER# records are keyed `pk = USER#{userId}, sk = USER#{userId}`, so
use a direct `.get` rather than the `query`+`begins_with` used for ACCOUNT# records:

```typescript
import { dynamodbClient, DYNAMODB_TABLE } from "./client";

export async function getAuthUserEmail(userId: string): Promise<string | null> {
  const res = await dynamodbClient.get({
    TableName: DYNAMODB_TABLE,
    Key: { pk: `USER#${userId}`, sk: `USER#${userId}` },
    ProjectionExpression: "email",
  });
  return (res.Item?.email as string | undefined) ?? null;
}
```
> **Verify the USER# sk shape against a live/local record before finalizing** — the
> `@auth/dynamodb-adapter` stores the user item with `pk=sk=USER#{id}` by default,
> but confirm (the ACCOUNT# query in `bib.ts:60-69` is the proven read path in this
> table). For search-by-full-email + bulk masking, a single `scanAllRunUsers` gives
> the userIds; batch-get emails or reuse the adapter's GSI1 (`GSI1PK=USER#{id}`).
> Mask presentation-side (e.g. `k•••@gmail.com`); keep full emails server-side only
> (CONTEXT 55-57, 140-142).

---

### `apps/run.auth/webapp/src/app/api/internal/quota/by-type/[quotaId]/route.ts` (NEW)

**Analog:** `apps/run.auth/webapp/src/app/api/internal/quota/[userId]/route.ts`
(entire file, 74 lines) — same directory, same internal-secret gate. Keep the new one
~30 lines, read-only (CONTEXT 63-66, 138-139).

**Internal-secret gate** (`internal/quota/[userId]/route.ts:5-17`) — copy verbatim:
```typescript
const INTERNAL_SECRET = process.env.AUTH_INTERNAL_SECRET;
function verifyInternalSecret(request: NextRequest): boolean {
  if (!INTERNAL_SECRET) { console.error("[Internal API] AUTH_INTERNAL_SECRET not configured"); return false; }
  const providedSecret = request.headers.get("X-Internal-Secret");
  return providedSecret === INTERNAL_SECRET;
}
```

**Handler shape** (mirror `internal/quota/[userId]/route.ts:25-73`): gate → read
`{ quotaId }` from params → `listQuotaByType(quotaId)` → return
`[{ userId, consumptionCount, remaining, updatedAt }]` (spec 63-71). One GSI query,
no per-user fan-out.

---

### `apps/run.auth/webapp/src/services/quota.ts` (MODIFY — add `listQuotaByType`)

**Analog:** the primary-index query at `quota.ts:362`
(`UserQuota.query.primary({ userId }).go()`) + the `byQuotaRemaining` GSI declared at
`apps/run.auth/webapp/src/entities/user-quota.ts:83-88`
(`pk composite ["quotaId"]`, `sk composite ["remaining"]`). Query the GSI by
`quotaId` in ONE call:
```typescript
export async function listQuotaByType(quotaId: string) {
  const result = await UserQuota.query.byQuotaRemaining({ quotaId }).go({ pages: "all" });
  return result.data.map((q) => ({
    userId: q.userId,
    consumptionCount: q.consumptionCount ?? 0,
    remaining: q.remaining,
    updatedAt: q.updatedAt,
  }));
}
```
`UserQuotaItem` shape is at `user-quota.ts:98-109`. Called for `gpx_upload`
(optionally `gpx_save`, `gpx_share`); run.human joins by `userId` (CONTEXT 59-68).

---

### `apps/run.human/webapp/src/lib/quota-client.ts` (MODIFY — add bulk fetch fn)

**Analog:** `getUserQuotas` at `quota-client.ts:116-118` + the shared `quotaRequest`
helper (`quota-client.ts:82-111`) which already sets `X-Internal-Secret` and base
URL. Add a bulk fetch that calls the new run.auth endpoint:
```typescript
export async function getQuotaByType(quotaId: QuotaId) {
  return quotaRequest<Array<{ userId: string; consumptionCount: number; remaining: number; updatedAt: number }>>(
    `/api/internal/quota/by-type/${quotaId}`
  );
}
```
`QuotaId` (union incl. `gpx_upload`/`gpx_save`/`gpx_share`) is at
`quota-client.ts:18-29`. Base URL + secret are `config.urls.privateAuthServer` /
`config.auth.internalSecret` (`quota-client.ts:10-11`).

---

## Shared Patterns

### Admin gate (`services.includes("admin")`)
**Source:** `apps/run.bib/webapp/src/lib/admin-gate.ts:28-56` (and identical inline
idiom `apps/run.human/webapp/src/app/api/admin/quota/route.ts:10-13`).
**Apply to:** the new `lib/admin-gate.ts`, `admin/page.tsx`, `api/admin/users/route.ts`.
DynamoDB-backed `services` membership only — **no email allowlist** (CONTEXT 32-33).

### Fresh-claims revalidation on `/admin` entry
**Source:** `apps/run.human/webapp/src/config/auth.ts:55-89` (`fetchFreshClaims`) and
the endpoint it hits, `apps/run.auth/.../session/validate/user/[userId]/route.ts`.
**Apply to:** the `/admin` page AND the admin users API (CONTEXT 34-37, spec 36-38).
The existing internal call is:
```typescript
// config/auth.ts:56, 60-67
const validateUrl = `${config.urls.privateAuthServer}/api/session/validate/user`;
const response = await fetch(`${validateUrl}/${userId}`, {
  method: "GET",
  headers: { "Content-Type": "application/json", "X-Internal-Secret": config.auth.internalSecret },
});
// response.json() → { valid, user: { services, sessionVersion, lockedOut, ... } }
```
`fetchFreshClaims` is currently module-private in `config/auth.ts`; either export a
small `revalidateAdmin(userId)` from there (preferred — single source) or reproduce
this fetch in the gate wrapper. Deny (→ **404**) if fresh `services` lacks `"admin"`,
even when the cached JWT still says admin (defeats the ~5-min staleness window).
Validate response type: `InternalValidateResponse` at
`.../validate/user/[userId]/route.ts:32-46`.

### Internal server-to-server auth (`X-Internal-Secret`)
**Source:** `apps/run.human/webapp/src/lib/quota-client.ts:82-111` (client side) and
`apps/run.auth/.../internal/quota/[userId]/route.ts:5-17` (server side).
**Apply to:** the new run.auth bulk endpoint + its run.human client. Secret is
`config.auth.internalSecret` (run.human) / `process.env.AUTH_INTERNAL_SECRET` (run.auth).

### CSV serialization + attachment response
**Source:** `apps/run.bib/webapp/src/lib/admin-reports.ts:440-455` (`csvCell`/`toCsv`)
+ `apps/run.bib/.../api/admin/bib/report/[type]/route.ts:47-57` (Response headers).
**Apply to:** `api/admin/users/route.ts` (`?format=csv`) and the new
`lib/admin-report.ts`. ISO timestamps, dated filename, `Content-Disposition:
attachment`, `Cache-Control: no-store` (CONTEXT 90-96).

### ElectroDB full-table scan (`pages: "all"`)
**Source:** `apps/run.bib/webapp/src/lib/admin-reports.ts:421-429`;
filtered variant `apps/run.human/webapp/src/services/quota.ts:61-65`.
**Apply to:** `run-user.ts` `scanAllRunUsers` (and any `Bib.scan` used to build the
`sub → runnerCode` map). Acceptable at event scale (hundreds–low-thousands), CONTEXT 42-44.

### Node runtime + force-dynamic for admin routes/pages
**Source:** `report/[type]/route.ts:16-20`, `run.bib admin/page.tsx:31-32`.
**Apply to:** `admin/page.tsx` and `api/admin/users/route.ts` — scans need Node
crypto (AWS SDK signing) and must never be cached.

---

## No Analog Found

None. Every file has a concrete in-repo analog. Two items need a live-data
confirmation rather than a new pattern:

| Item | Note |
|------|------|
| authjs `USER#` sk shape for email `.get` | Confirm `pk=sk=USER#{id}` on a real `run-human-authjs` record before finalizing `getAuthUserEmail`; the proven adjacent read is the ACCOUNT# `query` in `bib.ts:60-69`. |
| 404-not-403 gate + fresh-claims wrap | New composition of two existing patterns (bib gate + `fetchFreshClaims`); no single file does both today. |

## Metadata

**Analog search scope:** `apps/run.human/webapp/src`, `apps/run.bib/webapp/src`,
`apps/run.auth/webapp/src` (lib, app/api, app/admin, entities, services, config).
**Files scanned:** ~14 read in full/part + targeted greps for gate/CSV/scan/USER#.
**Pattern extraction date:** 2026-07-11
