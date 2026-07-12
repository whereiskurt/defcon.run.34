# run.bib In-person Pledge: editable Approve + Deny — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the admin **Outstanding + in-person** pledge rows the same controls as the Venmo rows — an editable `$amount` field + **Approve** (books cash) + **Deny** (soft-clears the pledge).

**Architecture:** Extend the existing `MarkPaidAction` (add an editable amount field, relabel "PAID"→"Approve"; it already POSTs the amount-accepting `mark-paid` route). Add a new `DenyPledgeAction` button + a new admin-gated `POST /api/admin/bib/deny-pledge` route that calls the existing `updateBibWillPayInPerson(ownerSub, false)`. Wire both into the in-person branch of the Outstanding table. All in `apps/run.bib/webapp`.

**Tech Stack:** Next.js 16, React 19, TypeScript, ElectroDB (DynamoDB), Zod, Vitest.

## Global Constraints

- Money is integer **cents**; the amount field is entered in DOLLARS and converted with `Math.round(Number(value) * 100)`; reject non-finite / `≤ 0`.
- **Deny is SOFT** — it sets `willPayInPerson = false` only. It must NOT delete the bib, clear the name, or touch quota (that is the separate roster Reject).
- Admin gate = `requireBibAdmin` (bibadmin OR admin superuser); 401 no_session / 403 not_admin.
- The `deny-pledge` route must **not** log request bodies/PII (only the error).
- **`mark-paid` and `reconcile` routes are unchanged.** The Venmo pending-intent flow (`ReconcileAction`, `DenyPendingAction`) is untouched.
- Copy for the new `DenyPledgeAction` is **hardcoded** (no CMS catalog key); the Approve label reuses the existing `bib.admin.approve` catalog key.
- Run bib tests from `apps/run.bib/webapp`. **Node:** `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 23.6.0` before `npx vitest`/`npx tsc`.
- After any task that runs npm/tsc, `git status --short`; revert stray `package.json`/`package-lock.json`/`tsconfig.tsbuildinfo` with `git checkout --` before committing. Commit only intended files.

## File Structure

- `src/app/api/admin/bib/deny-pledge/route.ts` (create) — POST route, mirrors `deny-pending`.
- `src/components/AdminActions.tsx` (modify) — extend `MarkPaidAction`; add `DenyPledgeAction`.
- `src/app/admin/page.tsx` (modify) — in-person Action cell: `MarkPaidAction` + `DenyPledgeAction`.

---

### Task 1: `POST /api/admin/bib/deny-pledge` route

**Files:**
- Create: `apps/run.bib/webapp/src/app/api/admin/bib/deny-pledge/route.ts`

**Interfaces:**
- Consumes: `requireBibAdmin` (`@/lib/admin-gate`), `auth` (`@/config/auth`), `updateBibWillPayInPerson` (`@/entities/bib`, existing: `(ownerSub: string, willPayInPerson: boolean) => Promise<BibItem>`, throws if bib missing).
- Produces: `POST { ownerSub }` → `{ ok: true }`; 400 invalid body, 401/403 gate, 500 on failure.

- [ ] **Step 1: Create the route**

```typescript
import { z } from "zod";
import { auth } from "@/config/auth";
import { requireBibAdmin } from "@/lib/admin-gate";
import { updateBibWillPayInPerson } from "@/entities/bib";

/**
 * POST /api/admin/bib/deny-pledge — Kurt 2026-07-12.
 *
 * Organizer-only. Soft-denies a runner's in-person pledge shown in the
 * Outstanding table (beside "Approve"). Clears willPayInPerson (=false) so the
 * row drops off the outstanding list. The bib, name, and quota are untouched —
 * the runner can re-pledge later. NOT the destructive roster Reject (delete).
 *
 * Node runtime — ElectroDB/AWS signing needs Node crypto. Force-dynamic — a live
 * mutation, never cached. Gated on the bibadmin/admin group claim.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ ownerSub: z.string().min(1) });

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
    await updateBibWillPayInPerson(parsed.data.ownerSub, false);
    return Response.json({ ok: true }, { status: 200 });
  } catch (err) {
    // Do not log the request body — only the error.
    console.error("[run.bib] /api/admin/bib/deny-pledge:", err);
    return Response.json({ error: "deny_pledge_failed" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/run.bib/webapp && npx tsc --noEmit`
Expected: no errors that reference `deny-pledge/route.ts` (report any pre-existing baseline errors that touch other files).

- [ ] **Step 3: Commit**

```bash
git add apps/run.bib/webapp/src/app/api/admin/bib/deny-pledge/route.ts
git commit -m "feat(bib): add POST /api/admin/bib/deny-pledge route"
```

No new test: the entity fn `updateBibWillPayInPerson` is already covered by `src/__tests__/will-pay-in-person.test.ts`, and the route follows the established gate+Zod no-new-harness pattern (same as `deny-pending`).

---

### Task 2: extend `MarkPaidAction` + add `DenyPledgeAction`

**Files:**
- Modify: `apps/run.bib/webapp/src/components/AdminActions.tsx`

**Interfaces:**
- Consumes: `POST /api/admin/bib/mark-paid` (existing, accepts `{ ownerSub, amountCents }`); `POST /api/admin/bib/deny-pledge` (Task 1). Uses `useState`/`useRouter`/`useCopy` already imported at the top of the file.
- Produces: `MarkPaidAction` (same props: `{ apiBase, ownerSub, amountCents? }`) now renders an editable amount + "Approve"; new `DenyPledgeAction({ apiBase, ownerSub })`.

Note: `MarkPaidAction` is consumed in exactly one place (`admin/page.tsx` in-person row) — its prop shape is unchanged, so extending it is safe.

- [ ] **Step 1: Replace the `MarkPaidAction` function body** — the props interface `MarkPaidActionProps` is unchanged. Replace the whole `export function MarkPaidAction(...) { ... }` block (currently the fixed-$20 PAID button) with this editable-amount version:

```tsx
export function MarkPaidAction({
  apiBase,
  ownerSub,
  amountCents = 2000,
}: MarkPaidActionProps) {
  const router = useRouter();
  const { t } = useCopy();
  // Editable amount, DOLLARS for display (prefilled from the pledge's
  // amountCents, e.g. 2000 → "20.00"), converted to integer cents on submit.
  // The mark-paid contract is unchanged — it still receives cents.
  const [value, setValue] = useState<string>(
    ((amountCents ?? 0) / 100).toFixed(2)
  );
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [deduped, setDeduped] = useState(false);

  const onMarkPaid = async () => {
    // Dollars → integer cents (the field is money, not raw cents).
    const cents = Math.round(Number(value) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      setFailed(true);
      return;
    }
    setBusy(true);
    setFailed(false);
    setDeduped(false);
    try {
      const res = await fetch(`${apiBase}/api/admin/bib/mark-paid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerSub, amountCents: cents }),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { deduped?: boolean }
          | null;
        if (data?.deduped) {
          setDeduped(true);
          return;
        }
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
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "0 8px",
          borderRadius: 4,
          border: "1px solid #2a2a34",
          backgroundColor: "#0a0a0f",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            color: "#8f8fa8",
            fontSize: 13,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
        >
          $
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          // Money field: allow only digits and a single decimal point.
          onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ""))}
          aria-label="Amount in dollars"
          title="Amount in dollars"
          disabled={busy}
          style={{
            width: 60,
            padding: "5px 0",
            border: "none",
            outline: "none",
            backgroundColor: "transparent",
            color: "#e4e4ef",
            fontSize: 13,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
        />
      </span>
      <button
        type="button"
        onClick={onMarkPaid}
        disabled={busy}
        aria-label="Approve in-person cash payment"
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: "#0a0a0a",
          backgroundColor: "#6CCDB8",
          padding: "6px 14px",
          borderRadius: 6,
          border: "none",
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.6 : 1,
          whiteSpace: "nowrap",
        }}
      >
        {t("bib.admin.approve")}
      </button>
      {failed && (
        <span style={{ fontSize: 13, color: "#ff8a8a", whiteSpace: "nowrap" }}>
          {t("bib.admin.failText")}
        </span>
      )}
      {deduped && (
        <span
          role="status"
          style={{ fontSize: 13, color: "#f4c680", whiteSpace: "nowrap" }}
        >
          {t("bib.admin.alreadyBooked")}
        </span>
      )}
    </span>
  );
}
```

(The JSDoc comment block directly above `MarkPaidAction` may be left as-is or updated to mention the editable amount + "Approve" label; do not delete the attribution line.)

- [ ] **Step 2: Append the `DenyPledgeAction` component** — add at the end of the file (after `RemoveCashAction`), using the `useState`/`useRouter` already imported at the top:

```tsx
export interface DenyPledgeActionProps {
  apiBase: string;
  ownerSub: string;
}

/**
 * DenyPledgeAction (Kurt 2026-07-12) — the destructive "Deny" pill beside
 * Approve on Outstanding in-person pledge rows. Soft-clears the runner's
 * in-person pledge via /api/admin/bib/deny-pledge (willPayInPerson=false), so
 * the row drops off the outstanding list. The bib, name, and quota are kept —
 * the runner can re-pledge later. Behind a window.confirm(). Copy hardcoded to
 * avoid touching the REQUIRED_BIB_KEYS CMS catalog.
 */
export function DenyPledgeAction({ apiBase, ownerSub }: DenyPledgeActionProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const onDeny = async () => {
    const ok = window.confirm(
      "Deny this in-person pledge? It drops off the outstanding list. The runner keeps their bib and name and can pledge again later."
    );
    if (!ok) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`${apiBase}/api/admin/bib/deny-pledge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerSub }),
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
        aria-label="Deny in-person pledge"
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

- [ ] **Step 3: Typecheck**

Run: `cd apps/run.bib/webapp && npx tsc --noEmit`
Expected: no errors that reference `AdminActions.tsx`.

- [ ] **Step 4: Commit**

```bash
git add apps/run.bib/webapp/src/components/AdminActions.tsx
git commit -m "feat(bib): editable-amount Approve + DenyPledgeAction for in-person rows"
```

---

### Task 3: wire `MarkPaidAction` + `DenyPledgeAction` into the Outstanding table

**Files:**
- Modify: `apps/run.bib/webapp/src/app/admin/page.tsx`

**Interfaces:**
- Consumes: `MarkPaidAction` (Task 2, unchanged props), `DenyPledgeAction` (Task 2).

- [ ] **Step 1: Add `DenyPledgeAction` to the import** from `@/components/AdminActions`:

```tsx
import {
  ReconcileAction,
  RejectAction,
  MarkPaidAction,
  DenyPendingAction,
  RemoveCashAction,
  DenyPledgeAction,
} from "@/components/AdminActions";
```

- [ ] **Step 2: Update the in-person branch of the Outstanding table's Action cell.** Find this block in the `bundle.outstanding.map(...)` Action cell:

```tsx
              ) : r.source === "in-person" && r.ownerSub ? (
                // Runner paid their pledged $20 cash at the event → book it.
                <MarkPaidAction
                  apiBase={base}
                  ownerSub={r.ownerSub}
                  amountCents={r.amountCents}
                />
              ) : (
```

Replace it with (wrap Approve + Deny in the same inline-flex span the pending-intent branch uses):

```tsx
              ) : r.source === "in-person" && r.ownerSub ? (
                // Runner pledged to pay cash in person → Approve (book the
                // editable amount) or Deny (soft-clear the pledge; bib kept).
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <MarkPaidAction
                    apiBase={base}
                    ownerSub={r.ownerSub}
                    amountCents={r.amountCents}
                  />
                  <DenyPledgeAction apiBase={base} ownerSub={r.ownerSub} />
                </span>
              ) : (
```

(Only the in-person branch changes. The pending-intent branch and the `""` fallback are untouched.)

- [ ] **Step 3: Typecheck**

Run: `cd apps/run.bib/webapp && npx tsc --noEmit`
Expected: no errors that reference `admin/page.tsx`.

- [ ] **Step 4: Commit**

```bash
git add apps/run.bib/webapp/src/app/admin/page.tsx
git commit -m "feat(bib): Approve+Deny on in-person pledge rows in Outstanding table"
```

---

### Task 4: Full verification gate

**Files:** none.

- [ ] **Step 1: Full bib test suite**

Set Node first: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 23.6.0`
Run: `cd apps/run.bib/webapp && npm test`
Expected: PASS (the existing suite, incl. `will-pay-in-person` + `copy-catalog-bib`).

- [ ] **Step 2: Typecheck + build**

Run: `cd apps/run.bib/webapp && npx tsc --noEmit && npm run build`
Expected: no type errors; build compiles with `/api/admin/bib/deny-pledge` in the route manifest (grep the build output for `deny-pledge`).

- [ ] **Step 3: Clean status**

Run: `git status --short` (revert any stray package/tsbuildinfo). Expected: only the intended commits.

---

## Self-Review

**Spec coverage:** editable Approve books cash via mark-paid (Task 2 field + Task 3 wiring); Deny soft-clears the pledge (Task 1 route + Task 2 component + Task 3 wiring); label "Approve" via existing catalog key (Task 2); mark-paid/reconcile untouched (no task changes them). ✓
**Placeholder scan:** none — full code in every step. ✓
**Type consistency:** `updateBibWillPayInPerson(ownerSub, false)` (existing) consumed by the route (Task 1); `MarkPaidAction` props unchanged, `DenyPledgeAction({apiBase, ownerSub})` (Task 2) consumed by the wiring (Task 3). ✓

## Ship notes (after execution)

- Deploy is run.bib-only. Merge PR to main, then `buildpub apps=run.bib regions=use1 create_pr=true deploy=false` (create+merges the Release version-bump PR), then `deploy.yml region=us-east-1 pr_number=skip invalidate_cache=true`. Confirm the built ECR tag's push time is AFTER the merge (immutable-tag collision landmine).
- Verify on an in-person pledge row (e.g. KPH `bib-wll5`): edit the amount → Approve books cash (row leaves Outstanding, shows in Payments, reversible via Remove). Deny → row leaves Outstanding, bib/name kept. Needs a signed-in admin session (`/admin` is auth-gated).
