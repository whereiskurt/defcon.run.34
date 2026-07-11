# run.bib Admin Changes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Deny action for fake pending payment intents, enrich the printed-name CSV with payment type + email + QR URL, and split admin access into `bibadmin`/`runadmin` groups (with `admin` as superuser) — granting Kurt + Jesse membership.

**Architecture:** All code changes are in `apps/run.bib/webapp` except one additive field on a `run.human` internal endpoint. The authorization gate, entity, reports, API routes, and UI follow the existing run.bib admin patterns (group-claim `session.user.services`, ElectroDB entities, pure `buildReports` + network-free CSV, inline dark-theme admin components). CSV email/QR enrichment is an async, concurrency-capped, fail-open step layered on top of the pure report builder and scoped to the print-names download only.

**Tech Stack:** Next.js 16, React 19, TypeScript, ElectroDB (DynamoDB), Zod, Vitest, AWS CLI (DynamoDB, profile `dc34-application`).

## Global Constraints

- Money is integer **cents** everywhere; format at the edge (`formatUsd`/`dollars`).
- Admin group model: access = a string in `session.user.services`. No email allowlist, no env var. Fail-closed.
- `admin` remains a **superuser** — any `admin`-specific gate also admits `admin`.
- Membership propagates via the ~5-min session refresh; no redeploy needed.
- CSV enrichment must **never** fail the download — any per-runner lookup failure yields blank `email`/`qrUrl` cells.
- Denied pending intents keep their donation quota **consumed** (no restore).
- Run all bib tests from `apps/run.bib/webapp` with `npm test` (`vitest run`).
- Prod auth table: `run-auth-electro`, region `us-east-1`, AWS profile `dc34-application`.
- Do NOT add or reseed CMS copy keys (REQUIRED_BIB_KEYS exact-count + byte-parity landmine) — new UI strings in the Deny button are hardcoded literals.

## File Structure

**run.bib/webapp:**
- `src/lib/admin-gate.ts` (modify) — add `requireBibAdmin`, `requireRunAdmin`.
- `src/app/api/admin/bib/{reconcile,mark-paid,reject,pledged-unpaid}/route.ts` + `report/[type]/route.ts` (modify) — swap `requireAdmin` → `requireBibAdmin`.
- `src/app/admin/page.tsx` (modify) — swap gate; render `DenyPendingAction` beside `ReconcileAction`.
- `src/entities/pending-contribution.ts` (modify) — add `deniedAt`/`deniedBy` attrs + `denyPendingById`.
- `src/app/api/admin/bib/deny-pending/route.ts` (create) — POST deny endpoint.
- `src/lib/admin-reports.ts` (modify) — filter denied from outstanding, `deniedCount`, `paymentTypes` + `ownerSub` on `PrintNameRow`, new print-names CSV columns.
- `src/lib/social-qr.ts` (modify) — add `getRunnerContact`.
- `src/lib/admin-report-enrich.ts` (create) — `mapWithConcurrency`, `enrichPrintNames`.
- `src/components/AdminActions.tsx` (modify) — add `DenyPendingAction`.
- `src/__tests__/*` — new/extended tests.

**run.human/webapp:**
- `src/app/api/internal/user/[oidcSub]/route.ts` (modify) — also return `email`.

**ops:**
- `scripts/grant-admin-groups.sh` (create, run once) — additive services grant for Kurt + Jesse.

---

### Task 1: Group gate helpers (`requireBibAdmin`, `requireRunAdmin`)

**Files:**
- Modify: `apps/run.bib/webapp/src/lib/admin-gate.ts`
- Test: `apps/run.bib/webapp/src/__tests__/admin-gate.test.ts`

**Interfaces:**
- Consumes: existing `SessionLike`, `RequireAdminResult`, `isAdmin`.
- Produces: `hasGroup(session, group): boolean`, `requireBibAdmin(session): RequireAdminResult`, `requireRunAdmin(session): RequireAdminResult`. Both pass if services include the specific group **or** `"admin"`.

- [ ] **Step 1: Write the failing tests** — append to `admin-gate.test.ts`:

```typescript
import { requireBibAdmin, requireRunAdmin } from "@/lib/admin-gate";

describe("requireBibAdmin()", () => {
  it("admits a bibadmin", () => {
    const r = requireBibAdmin({ user: { email: "a@x.com", services: ["run", "bibadmin"] } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.email).toBe("a@x.com");
  });
  it("admits a superuser admin without bibadmin", () => {
    expect(requireBibAdmin({ user: { services: ["admin"] } }).ok).toBe(true);
  });
  it("rejects a plain user (not_admin)", () => {
    const r = requireBibAdmin({ user: { services: ["run", "flash"] } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_admin");
  });
  it("rejects no session (no_session)", () => {
    const r = requireBibAdmin(null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_session");
  });
});

describe("requireRunAdmin()", () => {
  it("admits a runadmin", () => {
    expect(requireRunAdmin({ user: { services: ["runadmin"] } }).ok).toBe(true);
  });
  it("admits a superuser admin", () => {
    expect(requireRunAdmin({ user: { services: ["admin"] } }).ok).toBe(true);
  });
  it("rejects a bibadmin-only user", () => {
    const r = requireRunAdmin({ user: { services: ["bibadmin"] } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_admin");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/run.bib/webapp && npx vitest run src/__tests__/admin-gate.test.ts`
Expected: FAIL — `requireBibAdmin`/`requireRunAdmin` are not exported.

- [ ] **Step 3: Implement the helpers** — append to `admin-gate.ts`:

```typescript
/**
 * True iff the session carries a specific service/group. Fail-closed on a
 * missing/null services array. Pure + sync (same contract as isAdmin).
 */
export function hasGroup(session: SessionLike, group: string): boolean {
  const services = session?.user?.services;
  return Array.isArray(services) && services.includes(group);
}

/**
 * Gate for the bib admin surface: admits `bibadmin` OR the `admin` superuser.
 * Same discriminated result + status mapping as requireAdmin.
 */
export function requireBibAdmin(session: SessionLike): RequireAdminResult {
  if (!session?.user) return { ok: false, reason: "no_session" };
  if (!hasGroup(session, "bibadmin") && !hasGroup(session, "admin")) {
    return { ok: false, reason: "not_admin" };
  }
  return { ok: true, email: session.user.email ?? null };
}

/**
 * Gate for the run admin surface: admits `runadmin` OR the `admin` superuser.
 * Reserved for the run.human admin dashboard — no run.bib route consumes it yet.
 */
export function requireRunAdmin(session: SessionLike): RequireAdminResult {
  if (!session?.user) return { ok: false, reason: "no_session" };
  if (!hasGroup(session, "runadmin") && !hasGroup(session, "admin")) {
    return { ok: false, reason: "not_admin" };
  }
  return { ok: true, email: session.user.email ?? null };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/run.bib/webapp && npx vitest run src/__tests__/admin-gate.test.ts`
Expected: PASS (all `isAdmin`/`requireAdmin`/`requireBibAdmin`/`requireRunAdmin` cases).

- [ ] **Step 5: Commit**

```bash
git add apps/run.bib/webapp/src/lib/admin-gate.ts apps/run.bib/webapp/src/__tests__/admin-gate.test.ts
git commit -m "feat(bib): add requireBibAdmin/requireRunAdmin group gates (admin superuser)"
```

---

### Task 2: Swap bib admin consumers to `requireBibAdmin`

**Files:**
- Modify: `apps/run.bib/webapp/src/app/api/admin/bib/reconcile/route.ts`
- Modify: `apps/run.bib/webapp/src/app/api/admin/bib/mark-paid/route.ts`
- Modify: `apps/run.bib/webapp/src/app/api/admin/bib/reject/route.ts`
- Modify: `apps/run.bib/webapp/src/app/api/admin/bib/pledged-unpaid/route.ts`
- Modify: `apps/run.bib/webapp/src/app/api/admin/bib/report/[type]/route.ts`
- Modify: `apps/run.bib/webapp/src/app/admin/page.tsx`

**Interfaces:**
- Consumes: `requireBibAdmin` from Task 1. `RequireAdminResult` shape is identical, so all existing `gate.ok`/`gate.reason`/`gate.email` usage is unchanged.

- [ ] **Step 1: Swap the import + call in each file**

In every file above, change the import and the single call site. Import line:

```typescript
// before
import { requireAdmin } from "@/lib/admin-gate";
// after
import { requireBibAdmin } from "@/lib/admin-gate";
```

Call site (the exact string differs per file — replace the identifier only):

```typescript
// before:  const gate = requireAdmin(await auth());
// after:   const gate = requireBibAdmin(await auth());
// and in page.tsx:
// before:  const gate = requireAdmin(session);
// after:   const gate = requireBibAdmin(session);
```

Verify each swap with:

Run: `cd apps/run.bib/webapp && grep -rn "requireAdmin\|requireBibAdmin" src/app/api/admin/bib src/app/admin/page.tsx`
Expected: every match reads `requireBibAdmin` (no bare `requireAdmin` remains in these files).

- [ ] **Step 2: Update the Forbidden copy in `page.tsx`**

In `apps/run.bib/webapp/src/app/admin/page.tsx`, the `Forbidden()` component references the `admin` group. Change the `<code>admin</code>` reference:

```tsx
// before
Your account is not in the <code>admin</code> group. Ask an organizer
// after
Your account is not in the <code>bibadmin</code> group. Ask an organizer
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/run.bib/webapp && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full bib test suite (nothing should regress)**

Run: `cd apps/run.bib/webapp && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/run.bib/webapp/src/app/api/admin/bib apps/run.bib/webapp/src/app/admin/page.tsx
git commit -m "feat(bib): gate bib admin routes + page on requireBibAdmin"
```

---

### Task 3: `PendingContribution` deny — attributes + `denyPendingById`

**Files:**
- Modify: `apps/run.bib/webapp/src/entities/pending-contribution.ts`
- Test: `apps/run.bib/webapp/src/__tests__/pending-contribution.test.ts`

**Interfaces:**
- Produces: `denyPendingById(pendingId: string, deniedBy: string): Promise<void>` — patches the row, setting `deniedAt` (ISO now) + `deniedBy`. Row survives (soft-delete). Entity gains optional `deniedAt`/`deniedBy` string attributes.

- [ ] **Step 1: Add a `patch` mock + failing test** — in `pending-contribution.test.ts`:

Add a `mockPatch` fn and a `patch` method to the mocked `Entity` class. In the `vi.mock("electrodb", ...)` block, add alongside the existing `const mockUpsert`/`mockDelete`/`mockScan`:

```typescript
const mockPatch = vi.fn();
```

and inside the mocked `class Entity`, add:

```typescript
patch(key: unknown) {
  return { set: (attrs: unknown) => ({ go: () => mockPatch(key, attrs) }) };
}
```

Then add `denyPendingById` to the import list and a new describe block:

```typescript
import { denyPendingById } from "@/entities/pending-contribution";

describe("denyPendingById()", () => {
  beforeEach(() => {
    mockPatch.mockReset();
    mockPatch.mockResolvedValue({ data: {} });
  });

  it("patches deniedAt + deniedBy on exactly that pendingId (soft delete)", async () => {
    await denyPendingById("pending:u1:bib:venmo:2000", "admin@x.com");
    expect(mockPatch).toHaveBeenCalledTimes(1);
    const [key, attrs] = mockPatch.mock.calls[0];
    expect(key).toEqual({ pendingId: "pending:u1:bib:venmo:2000" });
    expect(attrs.deniedBy).toBe("admin@x.com");
    expect(typeof attrs.deniedAt).toBe("string");
  });

  it("never deletes the row", async () => {
    await denyPendingById("pending:u1:donation:venmo:1000", "admin@x.com");
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/run.bib/webapp && npx vitest run src/__tests__/pending-contribution.test.ts`
Expected: FAIL — `denyPendingById` is not exported (and the mock lacks `patch` until added).

- [ ] **Step 3: Add the entity attributes + helper** — in `pending-contribution.ts`:

Add two attributes to the `attributes` object (after `createdAt`):

```typescript
      deniedAt: {
        type: "string",
        // Soft-delete marker (Kurt 2026-07-11): set when an admin denies a fake
        // Venmo/CashApp intent. Presence hides the row from the Outstanding list;
        // the row survives for audit. Donation quota stays consumed (no restore).
      },
      deniedBy: {
        type: "string",
        // Admin email that denied the intent (audit trail).
      },
```

Add the helper below `clearPendingById`:

```typescript
/**
 * Deny a single pending intent (Kurt 2026-07-11). Soft-delete: patch the row to
 * set deniedAt (now) + deniedBy rather than deleting it, so a fake Venmo/CashApp
 * submission drops off the Outstanding list but stays auditable. Quota is
 * deliberately NOT restored — a denied attempt still counts against the runner.
 */
export async function denyPendingById(
  pendingId: string,
  deniedBy: string
): Promise<void> {
  await PendingContribution.patch({ pendingId })
    .set({ deniedAt: new Date().toISOString(), deniedBy })
    .go();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/run.bib/webapp && npx vitest run src/__tests__/pending-contribution.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/run.bib/webapp/src/entities/pending-contribution.ts apps/run.bib/webapp/src/__tests__/pending-contribution.test.ts
git commit -m "feat(bib): add deniedAt/deniedBy + denyPendingById to PendingContribution"
```

---

### Task 4: `POST /api/admin/bib/deny-pending` route

**Files:**
- Create: `apps/run.bib/webapp/src/app/api/admin/bib/deny-pending/route.ts`

**Interfaces:**
- Consumes: `requireBibAdmin` (Task 1), `denyPendingById` (Task 3).
- Produces: `POST { pendingId: string }` → `{ ok: true }` (200); 400 invalid body; 401/403 gate; 500 on failure. Mirrors the reconcile route's runtime/gate/error shape.

- [ ] **Step 1: Create the route**

```typescript
import { z } from "zod";
import { auth } from "@/config/auth";
import { requireBibAdmin } from "@/lib/admin-gate";
import { denyPendingById } from "@/entities/pending-contribution";

/**
 * POST /api/admin/bib/deny-pending — Kurt 2026-07-11.
 *
 * Organizer-only. Soft-denies a fake/unwanted pending Venmo/Cash App intent
 * shown in the Outstanding table (beside "Approve"). Sets deniedAt/deniedBy on
 * the PendingContribution row so it drops off the outstanding list but stays
 * auditable. Does NOT restore donation quota — a denied attempt still counts.
 *
 * Node runtime — ElectroDB/AWS signing needs Node crypto. Force-dynamic — a live
 * mutation, never cached. Gated on the bibadmin/admin group claim.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ pendingId: z.string().min(1) });

export async function POST(req: Request) {
  const gate = requireBibAdmin(await auth());
  if (!gate.ok) {
    const status = gate.reason === "no_session" ? 401 : 403;
    return new Response(
      gate.reason === "no_session" ? "unauthorized" : "forbidden",
      { status }
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    await denyPendingById(parsed.data.pendingId, gate.email ?? "admin");
    return Response.json({ ok: true }, { status: 200 });
  } catch (err) {
    // Do not log the pending intent details — only the error.
    console.error("[run.bib] /api/admin/bib/deny-pending:", err);
    return Response.json({ error: "deny_failed" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/run.bib/webapp && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/run.bib/webapp/src/app/api/admin/bib/deny-pending/route.ts
git commit -m "feat(bib): add POST /api/admin/bib/deny-pending soft-deny route"
```

---

### Task 5: Reports — exclude denied from Outstanding, `deniedCount`, `paymentTypes` + `ownerSub` on print-names

**Files:**
- Modify: `apps/run.bib/webapp/src/lib/admin-reports.ts`
- Test: `apps/run.bib/webapp/src/__tests__/admin-reports.test.ts`

**Interfaces:**
- Produces:
  - `PrintNameRow` gains `ownerSub: string`, `paymentTypes: string` (deduped `+`-joined providers, ordered by first appearance), and optional `email?: string`, `qrUrl?: string` (populated later by enrichment; undefined here).
  - `PendingLike` gains `deniedAt?: string`.
  - `ReportTotals` gains `deniedCount: number`.
  - `buildReports` excludes pendings with `deniedAt` from `outstanding`; `deniedCount` = number of denied pendings.

- [ ] **Step 1: Write failing tests** — add to `admin-reports.test.ts` (follow the file's existing `buildReports({...})` fixture style; pass empty arrays for unused inputs):

```typescript
describe("deny + print-names enrichment fields", () => {
  it("excludes denied pending intents from outstanding and counts them", () => {
    const bundle = buildReports({
      bibs: [],
      donations: [],
      reconciles: [],
      pendings: [
        { pendingId: "p1", ownerSub: "u1", kind: "bib", provider: "venmo", amountCents: 2000, runnerCode: "BIB-1", createdAt: "2026-07-10T00:00:00Z" },
        { pendingId: "p2", ownerSub: "u2", kind: "bib", provider: "venmo", amountCents: 2000, runnerCode: "BIB-2", createdAt: "2026-07-10T00:00:00Z", deniedAt: "2026-07-11T00:00:00Z" },
      ],
    });
    const pendingRows = bundle.outstanding.filter((r) => r.source === "pending-intent");
    expect(pendingRows.map((r) => r.pendingId)).toEqual(["p1"]);
    expect(bundle.totals.deniedCount).toBe(1);
  });

  it("carries ownerSub and a deduped joined paymentTypes on print-names rows", () => {
    const bundle = buildReports({
      bibs: [
        {
          ownerSub: "owner-9",
          runnerCode: "BIB-9",
          nameOnBib: "Dprk Runner",
          paidAmount: 4000,
          nameLocked: false,
          willPayInPerson: false,
          paidStatusHistory: [
            { provider: "cash", amount: 2000, timestamp: "2026-07-10T00:00:00Z" },
            { provider: "stripe", amount: 2000, timestamp: "2026-07-10T01:00:00Z" },
            { provider: "cash", amount: 0, timestamp: "2026-07-10T02:00:00Z" },
          ],
        } as never,
      ],
      donations: [],
      reconciles: [],
      pendings: [],
    });
    const row = bundle.printNames.find((r) => r.runnerCode === "BIB-9")!;
    expect(row.ownerSub).toBe("owner-9");
    expect(row.paymentTypes).toBe("cash+stripe");
    expect(row.email).toBeUndefined();
    expect(row.qrUrl).toBeUndefined();
  });

  it("gives an empty paymentTypes string when there is no payment history", () => {
    const bundle = buildReports({
      bibs: [
        { ownerSub: "o1", runnerCode: "BIB-0", nameOnBib: "No Pay", paidAmount: 0, nameLocked: false, willPayInPerson: true } as never,
      ],
      donations: [],
      reconciles: [],
      pendings: [],
    });
    expect(bundle.printNames[0].paymentTypes).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/run.bib/webapp && npx vitest run src/__tests__/admin-reports.test.ts`
Expected: FAIL — `paymentTypes`/`ownerSub`/`deniedCount` don't exist yet.

- [ ] **Step 3: Extend the types** — in `admin-reports.ts`:

Update `PrintNameRow`:

```typescript
export type PrintNameRow = {
  nameOnBib: string;
  runnerCode: string;
  ownerSub: string;
  paidAmountCents: number;
  nameLocked: boolean;
  printEligible: boolean;
  // Deduped, first-seen-ordered, "+"-joined payment methods from the bib's
  // paidStatusHistory (e.g. "cash+stripe"). Empty when unpaid.
  paymentTypes: string;
  // Populated by the CSV enrichment step (admin-report-enrich); undefined in the
  // pure builder and on the live dashboard.
  email?: string;
  qrUrl?: string;
};
```

Add `deniedAt` to `PendingLike`:

```typescript
type PendingLike = {
  kind?: "bib" | "donation";
  provider?: string;
  amountCents?: number;
  runnerCode?: string;
  createdAt?: string;
  pendingId?: string;
  ownerSub?: string;
  // Soft-deny marker — denied intents are excluded from Outstanding (Kurt 2026-07-11).
  deniedAt?: string;
};
```

Add `deniedCount` to `ReportTotals`:

```typescript
export type ReportTotals = {
  bibs: number;
  inPersonPledges: number;
  bibCollectedCents: number;
  donationCount: number;
  donationCents: number;
  grandTotalCents: number;
  pendingCount: number;
  printEligible: number;
  // Denied pending intents (soft-deleted fakes) — surfaced so they are counted,
  // not silently vanished.
  deniedCount: number;
};
```

- [ ] **Step 4: Implement the builder changes** — in `buildReports`:

In the print-names `.map((b) => { ... })`, add `ownerSub` and `paymentTypes` to the returned object. Compute `paymentTypes` from the bib's history (first-seen order, deduped):

```typescript
      const providers: string[] = [];
      for (const p of (b.paidStatusHistory ?? []) as Array<{ provider?: string }>) {
        const prov = (p.provider ?? "").trim();
        if (prov && !providers.includes(prov)) providers.push(prov);
      }
      return {
        nameOnBib: b.nameOnBib ?? "",
        runnerCode: b.runnerCode,
        ownerSub: b.ownerSub,
        paidAmountCents: effectivePaidCents,
        nameLocked: locked,
        printEligible: effectivePaidCents >= PRINT_GATE_CENTS,
        paymentTypes: providers.join("+"),
      };
```

Filter denied pendings before building `pendingRows`. Replace the `const pendingRows: OutstandingRow[] = pendings.map(...)` with a filtered source:

```typescript
  const activePendings = pendings.filter((p) => !p.deniedAt);
  const deniedCount = pendings.length - activePendings.length;
  const pendingRows: OutstandingRow[] = activePendings.map((p) => ({
```

(the `.map` body is unchanged).

Add `deniedCount` to the `totals` object:

```typescript
    printEligible: printNames.filter((r) => r.printEligible).length,
    deniedCount,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/run.bib/webapp && npx vitest run src/__tests__/admin-reports.test.ts`
Expected: PASS. Also run `npx tsc --noEmit` — expect no errors (the admin page reads `PrintNameRow` fields that still exist; new fields are additive).

- [ ] **Step 6: Commit**

```bash
git add apps/run.bib/webapp/src/lib/admin-reports.ts apps/run.bib/webapp/src/__tests__/admin-reports.test.ts
git commit -m "feat(bib): exclude denied intents, add deniedCount + paymentTypes/ownerSub to print-names"
```

---

### Task 6: `DenyPendingAction` component + wire into Outstanding table

**Files:**
- Modify: `apps/run.bib/webapp/src/components/AdminActions.tsx`
- Modify: `apps/run.bib/webapp/src/app/admin/page.tsx`

**Interfaces:**
- Consumes: `POST /api/admin/bib/deny-pending` (Task 4). Pending-intent rows already carry `pendingId`.
- Produces: `DenyPendingAction({ apiBase, pendingId })` — red "Deny" button behind `window.confirm()`, `router.refresh()` on success. Strings hardcoded (no CMS copy key).

- [ ] **Step 1: Add the component** — append to `AdminActions.tsx`:

```tsx
export interface DenyPendingActionProps {
  apiBase: string;
  pendingId: string;
}

/**
 * DenyPendingAction (Kurt 2026-07-11) — the destructive "Deny" pill beside
 * Approve on Outstanding pending-intent rows. Soft-denies a fake Venmo/Cash App
 * submission via /api/admin/bib/deny-pending (sets deniedAt), dropping it off
 * the list. Behind a window.confirm(). Copy is hardcoded to avoid touching the
 * REQUIRED_BIB_KEYS CMS catalog.
 */
export function DenyPendingAction({ apiBase, pendingId }: DenyPendingActionProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const onDeny = async () => {
    const ok = window.confirm(
      "Deny this pending payment? It drops off the outstanding list (kept for audit). The runner's donation quota is NOT refunded."
    );
    if (!ok) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`${apiBase}/api/admin/bib/deny-pending`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingId }),
      });
      if (res.ok) {
        router.refresh();
        return;
      }
      setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button
        type="button"
        onClick={onDeny}
        disabled={busy}
        aria-label="Deny pending payment"
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: "#ff8a8a",
          backgroundColor: "transparent",
          padding: "6px 10px",
          borderRadius: 6,
          border: "1px solid #3a2a2e",
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.6 : 1,
          whiteSpace: "nowrap",
        }}
      >
        Deny
      </button>
      {failed && (
        <span style={{ fontSize: 13, color: "#ff8a8a", whiteSpace: "nowrap" }}>
          Couldn&apos;t apply — try again.
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 2: Wire it into the Outstanding table** — in `apps/run.bib/webapp/src/app/admin/page.tsx`:

Add `DenyPendingAction` to the import from `@/components/AdminActions`:

```tsx
import {
  ReconcileAction,
  RejectAction,
  MarkPaidAction,
  DenyPendingAction,
} from "@/components/AdminActions";
```

In the Outstanding `rows={bundle.outstanding.map((r) => [ ... ])}`, change the pending-intent action cell (currently only `<ReconcileAction .../>`) to render Approve **and** Deny together:

```tsx
              r.source === "pending-intent" && r.pendingId && r.ownerSub && r.kind ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <ReconcileAction
                    apiBase={base}
                    pendingId={r.pendingId}
                    ownerSub={r.ownerSub}
                    kind={r.kind}
                    provider={r.provider as "venmo" | "cashapp"}
                    amountCents={r.amountCents}
                  />
                  <DenyPendingAction apiBase={base} pendingId={r.pendingId} />
                </span>
              ) : r.source === "in-person" && r.ownerSub ? (
```

(the rest of the ternary — `MarkPaidAction` and the `""` fallback — is unchanged.)

- [ ] **Step 3: Add the denied count to the chip strip (optional visibility)** — in the `<div className="adash-chips">` block, add after the "Pending reconcile" chip:

```tsx
        <Chip k="Denied" v={totals.deniedCount} />
```

- [ ] **Step 4: Typecheck + build**

Run: `cd apps/run.bib/webapp && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/run.bib/webapp/src/components/AdminActions.tsx apps/run.bib/webapp/src/app/admin/page.tsx
git commit -m "feat(bib): Deny button beside Approve on outstanding intents + denied chip"
```

---

### Task 7: run.human internal endpoint returns `email`

**Files:**
- Modify: `apps/run.human/webapp/src/app/api/internal/user/[oidcSub]/route.ts`

**Interfaces:**
- Produces: the internal user endpoint response gains `email: string | null` (the authjs adapter user's email), alongside existing `hash`. Additive — existing consumers (flash, bib QR) ignore the new field.

- [ ] **Step 1: Read the authjs user email + add it to the response**

After the `getRunUser(adapterUserId)` block resolves `user`, fetch the adapter user record's email. The `@auth/dynamodb-adapter` stores the user under `pk = USER#<id>`, `sk = USER#<id>`. Add before the `return NextResponse.json({...})`:

```typescript
    // The runner's email lives on the authjs adapter USER record (not on
    // RunUser). Best-effort: a lookup miss returns null email rather than
    // failing the whole endpoint — the bib CSV enrichment treats null as blank.
    let email: string | null = null;
    try {
      const userRec = await dynamodbClient.get({
        TableName: DYNAMODB_TABLE,
        Key: { pk: `USER#${adapterUserId}`, sk: `USER#${adapterUserId}` },
      });
      const raw = userRec.Item?.email;
      email = typeof raw === "string" && raw ? raw : null;
    } catch (e) {
      console.error("[run.human] /api/internal/user email lookup:", e);
    }
```

Then add `email` to the returned JSON object (after `hash: user.hash,`):

```typescript
      hash: user.hash,
      email,
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/run.human/webapp && npx tsc --noEmit`
Expected: no errors. (No unit test — this route has no existing test harness and mocking the authjs `get` is disproportionate; covered by typecheck + the enrichment test in Task 9 which mocks the HTTP boundary, plus manual verification in Task 12.)

- [ ] **Step 3: Commit**

```bash
git add apps/run.human/webapp/src/app/api/internal/user/[oidcSub]/route.ts
git commit -m "feat(human): return adapter user email from internal user endpoint"
```

---

### Task 8: `getRunnerContact` client in social-qr

**Files:**
- Modify: `apps/run.bib/webapp/src/lib/social-qr.ts`
- Test: `apps/run.bib/webapp/src/__tests__/social-qr.test.ts`

**Interfaces:**
- Produces: `getRunnerContact(ownerSub: string): Promise<{ hash: string | null; email: string | null }>` — one call to run.human's internal user endpoint returning both fields. Any failure → `{ hash: null, email: null }`, never throws. Reuses the module's `HUMAN_BASE_URL`/`INTERNAL_SECRET`.

- [ ] **Step 1: Write failing tests** — mirror the existing `social-qr.test.ts` fetch-mock style. Add:

```typescript
import { getRunnerContact } from "@/lib/social-qr";

describe("getRunnerContact()", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("returns hash + email from a 200 response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hash: "abc123", email: "runner@x.com" }),
    }) as never;
    expect(await getRunnerContact("sub-1")).toEqual({ hash: "abc123", email: "runner@x.com" });
  });

  it("returns nulls on a non-2xx response", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as never;
    expect(await getRunnerContact("sub-1")).toEqual({ hash: null, email: null });
  });

  it("returns nulls (never throws) on a network error", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("boom")) as never;
    expect(await getRunnerContact("sub-1")).toEqual({ hash: null, email: null });
  });

  it("nulls missing/blank fields individually", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hash: "h", email: "" }),
    }) as never;
    expect(await getRunnerContact("sub-1")).toEqual({ hash: "h", email: null });
  });
});
```

(If `social-qr.test.ts` does not already import `vi`/`describe`/`afterEach`, add them to its `vitest` import.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/run.bib/webapp && npx vitest run src/__tests__/social-qr.test.ts`
Expected: FAIL — `getRunnerContact` not exported.

- [ ] **Step 3: Implement** — append to `social-qr.ts` (reuses `HUMAN_BASE_URL` + `INTERNAL_SECRET` already in module scope):

```typescript
/**
 * Resolve BOTH the runner's social-QR hash and email from run.human's internal
 * user endpoint in a single call (Kurt 2026-07-11) — used by the admin
 * print-names CSV enrichment. Fail-open: any error / non-2xx / missing field
 * yields null for that field and never throws, so a CSV download never 500s.
 */
export async function getRunnerContact(
  ownerSub: string
): Promise<{ hash: string | null; email: string | null }> {
  try {
    const url = `${HUMAN_BASE_URL}/api/internal/user/${encodeURIComponent(ownerSub)}`;
    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": INTERNAL_SECRET,
      },
    });
    if (!response.ok) return { hash: null, email: null };
    const json = (await response.json()) as { hash?: unknown; email?: unknown };
    return {
      hash: typeof json.hash === "string" && json.hash ? json.hash : null,
      email: typeof json.email === "string" && json.email ? json.email : null,
    };
  } catch {
    return { hash: null, email: null };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/run.bib/webapp && npx vitest run src/__tests__/social-qr.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/run.bib/webapp/src/lib/social-qr.ts apps/run.bib/webapp/src/__tests__/social-qr.test.ts
git commit -m "feat(bib): add getRunnerContact (hash+email) internal client"
```

---

### Task 9: Enrichment module (`mapWithConcurrency`, `enrichPrintNames`)

**Files:**
- Create: `apps/run.bib/webapp/src/lib/admin-report-enrich.ts`
- Test: `apps/run.bib/webapp/src/__tests__/admin-report-enrich.test.ts`

**Interfaces:**
- Consumes: `PrintNameRow` (Task 5), `getRunnerContact` (Task 8), `buildSocialQrUrl` (existing).
- Produces:
  - `mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]>` — order-preserving bounded-concurrency map.
  - `enrichPrintNames(rows: PrintNameRow[], limit?: number): Promise<PrintNameRow[]>` — returns new rows with `email`/`qrUrl` filled from `getRunnerContact(row.ownerSub)`; blank (`""`) on any failure or missing hash/email.

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect, vi } from "vitest";

const mockGetRunnerContact = vi.fn();
vi.mock("@/lib/social-qr", () => ({
  getRunnerContact: (sub: string) => mockGetRunnerContact(sub),
  buildSocialQrUrl: (hash: string) => `https://run.defcon.run/use1/r?h=${hash}`,
}));

import { mapWithConcurrency, enrichPrintNames } from "@/lib/admin-report-enrich";

const baseRow = {
  nameOnBib: "R",
  runnerCode: "BIB-1",
  ownerSub: "sub-1",
  paidAmountCents: 2000,
  nameLocked: false,
  printEligible: true,
  paymentTypes: "stripe",
};

describe("mapWithConcurrency()", () => {
  it("preserves order and never runs more than `limit` at once", async () => {
    let active = 0;
    let peak = 0;
    const fn = async (n: number) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n * 2;
    };
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, fn);
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe("enrichPrintNames()", () => {
  it("fills email + qrUrl from getRunnerContact", async () => {
    mockGetRunnerContact.mockResolvedValue({ hash: "H1", email: "a@x.com" });
    const [row] = await enrichPrintNames([{ ...baseRow }], 4);
    expect(row.email).toBe("a@x.com");
    expect(row.qrUrl).toBe("https://run.defcon.run/use1/r?h=H1");
  });

  it("blanks email/qrUrl when the lookup returns nulls", async () => {
    mockGetRunnerContact.mockResolvedValue({ hash: null, email: null });
    const [row] = await enrichPrintNames([{ ...baseRow }], 4);
    expect(row.email).toBe("");
    expect(row.qrUrl).toBe("");
  });

  it("blanks a row whose ownerSub is empty without calling the client", async () => {
    mockGetRunnerContact.mockReset();
    const [row] = await enrichPrintNames([{ ...baseRow, ownerSub: "" }], 4);
    expect(row.email).toBe("");
    expect(row.qrUrl).toBe("");
    expect(mockGetRunnerContact).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/run.bib/webapp && npx vitest run src/__tests__/admin-report-enrich.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `admin-report-enrich.ts`**

```typescript
/**
 * CSV enrichment for the admin print-names report (Kurt 2026-07-11).
 *
 * The pure builder (admin-reports.buildReports) is AWS-/network-free. Email and
 * the runner's social-QR URL live in run.human, so we fetch them here — ONLY for
 * the print-names CSV download (the bib-vendor handoff), never on the live
 * dashboard. Fail-open: any per-runner miss yields blank cells so a slow or down
 * run.human never breaks the download.
 */

import type { PrintNameRow } from "@/lib/admin-reports";
import { getRunnerContact, buildSocialQrUrl } from "@/lib/social-qr";

/**
 * Order-preserving map with a hard concurrency cap. Keeps the N internal HTTP
 * calls bounded (default caller passes 8) so a full-roster CSV doesn't fan out
 * hundreds of simultaneous requests at run.human.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

/**
 * Enrich print-name rows with `email` + `qrUrl` fetched from run.human. Returns
 * NEW row objects (does not mutate input). A row with no ownerSub, or any lookup
 * failure, gets blank ("") email/qrUrl.
 */
export async function enrichPrintNames(
  rows: PrintNameRow[],
  limit = 8
): Promise<PrintNameRow[]> {
  return mapWithConcurrency(rows, limit, async (row) => {
    if (!row.ownerSub) return { ...row, email: "", qrUrl: "" };
    const { hash, email } = await getRunnerContact(row.ownerSub);
    return {
      ...row,
      email: email ?? "",
      qrUrl: hash ? buildSocialQrUrl(hash) : "",
    };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/run.bib/webapp && npx vitest run src/__tests__/admin-report-enrich.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/run.bib/webapp/src/lib/admin-report-enrich.ts apps/run.bib/webapp/src/__tests__/admin-report-enrich.test.ts
git commit -m "feat(bib): print-names CSV email/qrUrl enrichment (bounded, fail-open)"
```

---

### Task 10: Print-names CSV columns + wire enrichment into the report route

**Files:**
- Modify: `apps/run.bib/webapp/src/lib/admin-reports.ts` (`reportToCsv` print-names case)
- Modify: `apps/run.bib/webapp/src/app/api/admin/bib/report/[type]/route.ts`
- Test: `apps/run.bib/webapp/src/__tests__/admin-reports.test.ts`

**Interfaces:**
- Consumes: `enrichPrintNames` (Task 9); `PrintNameRow.email`/`qrUrl`/`paymentTypes` (Task 5).
- Produces: print-names CSV header `name,runnerCode,paidUsd,printEligible,nameLocked,paymentTypes,email,qrUrl`. The report route enriches the print-names bundle before serializing.

- [ ] **Step 1: Write failing test** — add to `admin-reports.test.ts`:

```typescript
import { reportToCsv } from "@/lib/admin-reports";

describe("reportToCsv print-names columns", () => {
  it("emits paymentTypes, email and qrUrl columns", () => {
    const bundle = buildReports({
      bibs: [
        {
          ownerSub: "o1",
          runnerCode: "BIB-1",
          nameOnBib: "Ada",
          paidAmount: 2000,
          nameLocked: false,
          willPayInPerson: false,
          paidStatusHistory: [{ provider: "stripe", amount: 2000, timestamp: "2026-07-10T00:00:00Z" }],
        } as never,
      ],
      donations: [],
      reconciles: [],
      pendings: [],
    });
    // Simulate the route's enrichment having run:
    bundle.printNames[0].email = "ada@x.com";
    bundle.printNames[0].qrUrl = "https://run.defcon.run/use1/r?h=H1";
    const csv = reportToCsv(bundle, "print-names");
    const [header, firstRow] = csv.split("\n");
    expect(header).toBe("name,runnerCode,paidUsd,printEligible,nameLocked,paymentTypes,email,qrUrl");
    expect(firstRow).toContain("stripe");
    expect(firstRow).toContain("ada@x.com");
    expect(firstRow).toContain("https://run.defcon.run/use1/r?h=H1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/run.bib/webapp && npx vitest run src/__tests__/admin-reports.test.ts`
Expected: FAIL — header lacks the new columns.

- [ ] **Step 3: Add the CSV columns** — in `reportToCsv`, the `case "print-names":` `toCsv([...], ...)` columns array — append three columns after `nameLocked`, and pass through the new fields (default blank so a non-enriched bundle still serializes):

```typescript
    case "print-names":
      return toCsv(
        [
          { key: "nameOnBib", header: "name" },
          { key: "runnerCode", header: "runnerCode" },
          { key: "paid", header: "paidUsd" },
          { key: "printEligible", header: "printEligible" },
          { key: "nameLocked", header: "nameLocked" },
          { key: "paymentTypes", header: "paymentTypes" },
          { key: "email", header: "email" },
          { key: "qrUrl", header: "qrUrl" },
        ],
        bundle.printNames.map((r) => ({
          ...r,
          paid: dollars(r.paidAmountCents),
          email: r.email ?? "",
          qrUrl: r.qrUrl ?? "",
        }))
      );
```

- [ ] **Step 4: Wire enrichment into the report route** — in `apps/run.bib/webapp/src/app/api/admin/bib/report/[type]/route.ts`:

Add the import:

```typescript
import { enrichPrintNames } from "@/lib/admin-report-enrich";
```

Between `const bundle = await loadReports();` and `const csv = reportToCsv(bundle, type);`, enrich only for print-names:

```typescript
    const bundle = await loadReports();
    // Only the vendor-facing print-names CSV pays the per-runner run.human
    // lookup cost (email + QR). Fail-open inside enrichPrintNames — blank cells,
    // never a failed download.
    if (type === "print-names") {
      bundle.printNames = await enrichPrintNames(bundle.printNames);
    }
    const csv = reportToCsv(bundle, type);
```

(Adjust to the file's existing variable names/spacing — the explorer noted it does `const bundle = await loadReports(); const csv = reportToCsv(bundle, type);` around lines 48-49.)

- [ ] **Step 5: Run tests + typecheck**

Run: `cd apps/run.bib/webapp && npx vitest run src/__tests__/admin-reports.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/run.bib/webapp/src/lib/admin-reports.ts apps/run.bib/webapp/src/app/api/admin/bib/report/[type]/route.ts apps/run.bib/webapp/src/__tests__/admin-reports.test.ts
git commit -m "feat(bib): print-names CSV gains paymentTypes/email/qrUrl columns"
```

---

### Task 11: Grant `admin`+`bibadmin`+`runadmin` to Kurt + Jesse (prod, additive)

**Files:**
- Create: `apps/run.bib/scripts/grant-admin-groups.sh` (run-once ops helper)

**Interfaces:**
- Consumes: AWS profile `dc34-application`, table `run-auth-electro` (us-east-1). Requires `jq`.
- Produces: each target user's `services` list = existing services ∪ {`admin`,`bibadmin`,`runadmin`}. Idempotent (union dedupes).

- [ ] **Step 1: Write the additive grant script**

```bash
#!/bin/bash
# Grant admin + bibadmin + runadmin to specific users, PRESERVING existing
# services (union, not overwrite). Run once. Requires jq + AWS profile with
# write access to run-auth-electro (Kurt 2026-07-11).
set -euo pipefail

PROFILE="${AWS_PROFILE_OVERRIDE:-dc34-application}"
REGION="us-east-1"
TABLE="run-auth-electro"
ADD=("admin" "bibadmin" "runadmin")
USERS=("whereiskurt@gmail.com" "jessekrembs@gmail.com")

for EMAIL in "${USERS[@]}"; do
  echo "== $EMAIL =="
  PK=$(aws dynamodb query --profile "$PROFILE" --region "$REGION" --table-name "$TABLE" --index-name gsi1pk-gsi1sk-index --key-condition-expression "gsi1pk = :e" --expression-attribute-values "{\":e\":{\"S\":\"\$oidc#email_${EMAIL}\"}}" --query 'Items[0].pk.S' --output text)
  if [ -z "$PK" ] || [ "$PK" = "None" ]; then echo "  NOT FOUND — skipping"; continue; fi
  CURRENT=$(aws dynamodb get-item --profile "$PROFILE" --region "$REGION" --table-name "$TABLE" --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"\$authprofile_1\"}}" --query 'Item.services.L[].S' --output json)
  MERGED=$(printf '%s\n' "$CURRENT" | jq -c --argjson add "$(printf '%s\n' "${ADD[@]}" | jq -R . | jq -s .)" '(. // []) + $add | unique')
  echo "  current: $CURRENT"
  echo "  merged:  $MERGED"
  VALUES=$(printf '%s' "$MERGED" | jq -c '{":s":{"L":(map({"S":.}))}}')
  aws dynamodb update-item --profile "$PROFILE" --region "$REGION" --table-name "$TABLE" --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"\$authprofile_1\"}}" --update-expression "SET services = :s" --expression-attribute-values "$VALUES"
  echo "  updated."
done
echo "Done. Users must re-auth or wait ~5 min for the session claim to refresh."
```

- [ ] **Step 2: Dry-run the read half first (no writes)**

Run (verifies lookup + current services without mutating):
```bash
for E in whereiskurt@gmail.com jessekrembs@gmail.com; do PK=$(aws dynamodb query --profile dc34-application --region us-east-1 --table-name run-auth-electro --index-name gsi1pk-gsi1sk-index --key-condition-expression "gsi1pk = :e" --expression-attribute-values "{\":e\":{\"S\":\"\$oidc#email_${E}\"}}" --query 'Items[0].pk.S' --output text); echo "$E -> $PK"; aws dynamodb get-item --profile dc34-application --region us-east-1 --table-name run-auth-electro --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"\$authprofile_1\"}}" --query 'Item.services.L[].S' --output json; done
```
Expected: both emails resolve to a `pk`, and each prints its current services array.

- [ ] **Step 3: Run the grant**

```bash
chmod +x apps/run.bib/scripts/grant-admin-groups.sh && ./apps/run.bib/scripts/grant-admin-groups.sh
```
Expected: per user, `current` → `merged` includes `admin`, `bibadmin`, `runadmin` plus all prior services; "updated."

- [ ] **Step 4: Verify the write**

```bash
aws dynamodb get-item --profile dc34-application --region us-east-1 --table-name run-auth-electro --key "{\"pk\":{\"S\":\"<PK-from-step-2>\"},\"sk\":{\"S\":\"\$authprofile_1\"}}" --query 'Item.services.L[].S' --output json
```
Expected: array contains `admin`, `bibadmin`, `runadmin` and the user's original services (nothing dropped).

- [ ] **Step 5: Commit the script**

```bash
git add apps/run.bib/scripts/grant-admin-groups.sh
git commit -m "chore(bib): additive admin/bibadmin/runadmin grant script"
```

---

### Task 12: Full verification gate

**Files:** none (verification only).

- [ ] **Step 1: Full bib test suite**

Run: `cd apps/run.bib/webapp && npm test`
Expected: PASS (all suites, including the new admin-gate, pending-contribution, admin-reports, social-qr, admin-report-enrich cases).

- [ ] **Step 2: Typecheck both apps**

Run: `cd apps/run.bib/webapp && npx tsc --noEmit && cd ../../run.human/webapp && npx tsc --noEmit`
Expected: no errors in either.

- [ ] **Step 3: Production build (run.bib)**

Run: `cd apps/run.bib/webapp && npm run build`
Expected: build succeeds (App Router compiles the new route + modified page).

- [ ] **Step 4: Manual smoke (local, optional but recommended)**

Per AGENTS.md dev servers: run run.human (`PORT=3001`) and run.bib, sign in as an admin, open `/admin`. Verify:
- Outstanding pending-intent rows show **Approve** and **Deny**; clicking Deny (confirm) removes the row and increments the "Denied" chip.
- Download the print-names CSV → header includes `paymentTypes,email,qrUrl`; a paid runner shows their method(s), email, and `https://run.defcon.run/use1/r?h=...`.

- [ ] **Step 5: Final status check**

Run: `git status`
Expected: clean tree, all task commits present.

---

## Self-Review

**Spec coverage:**
- Deny pending intent → Tasks 3 (entity/helper), 4 (route), 5 (reports filter/count), 6 (UI). ✓
- Soft-delete + quota-consumed → Task 3 (patch, no restore) + Task 4 (no quota call). ✓
- Donation quota "verify only" → confirmed in spec/conversation; no code task (correctly, it already exists). Verified again in Task 12 manual smoke is optional; the number (5) is documented. ✓
- CSV paymentTypes/email/qrUrl → Tasks 5 (paymentTypes/ownerSub), 8 (client), 9 (enrich), 10 (columns + route). ✓
- run.human email field → Task 7. ✓
- Groups bibadmin/runadmin + admin superuser → Tasks 1, 2. ✓
- Membership grants Kurt + Jesse → Task 11. ✓
- Rollout ordering (human endpoint before bib enrichment; superuser prevents lockout) → Tasks ordered 7 before real reliance; grant safe anytime. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. ✓

**Type consistency:** `PrintNameRow` fields (`ownerSub`, `paymentTypes`, `email?`, `qrUrl?`) defined in Task 5, consumed in Tasks 9/10. `getRunnerContact` return `{hash,email}` defined in Task 8, consumed in Task 9. `requireBibAdmin`/`requireRunAdmin` return `RequireAdminResult` (Task 1), consumed in Tasks 2/4. `denyPendingById(pendingId, deniedBy)` defined in Task 3, consumed in Task 4. `enrichPrintNames` defined Task 9, consumed Task 10. Consistent. ✓
