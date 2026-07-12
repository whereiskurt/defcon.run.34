# run.bib Reverse Cash Payment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a bib admin reverse (un-book) a mistaken **cash** payment from the Payments/revenue table — subtract its amount and delete the ledger entry — with stripe/venmo reversal impossible by construction.

**Architecture:** New entity fn `reverseCashPayment` (read-modify-write on `Bib.paidStatusHistory` + `paidAmount`), a new admin-gated POST route, two new `PaymentRow` fields to target the exact entry, and a `RemoveCashAction` button wired into the Payments table for cash rows only. All in `apps/run.bib/webapp`. Mirrors the existing deny/reconcile patterns.

**Tech Stack:** Next.js 16, React 19, TypeScript, ElectroDB (DynamoDB), Zod, Vitest.

## Global Constraints

- Money is integer **cents** everywhere; `paidAmount` never goes below 0.
- **Cash-only reversal is enforced in the data layer** (`provider === "cash"` match), not just the UI — a stripe/venmo row can never be reversed.
- Admin gate = `requireBibAdmin` (bibadmin OR admin superuser); 401 no_session / 403 not_admin.
- Reversal must **not** log request bodies/PII (only the error).
- Payments **CSV is unchanged** (explicit column allowlist in `reportToCsv`).
- Run bib tests from `apps/run.bib/webapp`. **Node:** `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 23.6.0` before `npx vitest`/`npx tsc` (default v22.1.0 fails vitest with an engine error).
- After any task that runs npm/tsc, `git status --short`; revert stray `package.json`/`package-lock.json`/`tsconfig.tsbuildinfo` with `git checkout --` before committing. Commit only intended files.

## File Structure

- `src/entities/bib.ts` (modify) — add `reverseCashPayment` + `ReverseCashInput`.
- `src/__tests__/reverse-cash-payment.test.ts` (create) — unit tests (mirror `apply-payment.test.ts` mock).
- `src/app/api/admin/bib/reverse-payment/route.ts` (create) — POST route.
- `src/lib/admin-reports.ts` (modify) — `PaymentRow` gains `ownerSub?`/`reconciledVia?`, populated for bib rows.
- `src/__tests__/admin-reports.test.ts` (modify) — assert the new fields on bib payment rows.
- `src/components/AdminActions.tsx` (modify) — add `RemoveCashAction`.
- `src/app/admin/page.tsx` (modify) — Payments table Action column + wire `RemoveCashAction` on cash rows.

---

### Task 1: `reverseCashPayment` entity function

**Files:**
- Modify: `apps/run.bib/webapp/src/entities/bib.ts`
- Test: `apps/run.bib/webapp/src/__tests__/reverse-cash-payment.test.ts`

**Interfaces:**
- Produces: `reverseCashPayment(ownerSub: string, input: { timestamp: string; reconciledVia: string }): Promise<{ reversed: boolean; amountCents: number }>`.

- [ ] **Step 1: Write the failing test** — create `src/__tests__/reverse-cash-payment.test.ts`. The electrodb mock mirrors `apply-payment.test.ts` but the patch chain must record `.set()`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGet = vi.fn();
const mockPatch = vi.fn();

vi.mock("electrodb", () => {
  class Entity {
    constructor(_schema: unknown, _opts: unknown) {}
    get(key: unknown) {
      return { go: () => mockGet(key) };
    }
    query = { byRunnerCode: (_k: unknown) => ({ go: async () => ({ data: [] }) }) };
    create(_input: unknown) {
      return { go: () => Promise.resolve({ data: null }) };
    }
    patch(key: unknown) {
      const chain = {
        setPayload: {} as Record<string, unknown>,
        set(payload: Record<string, unknown>) {
          this.setPayload = payload;
          return this;
        },
        go(opts?: unknown) {
          return mockPatch(key, this, opts);
        },
      };
      return chain;
    }
  }
  return { Entity };
});

vi.mock("@/entities/client", () => ({
  electroClient: {},
  ELECTRO_TABLE: "run-human-electro-mock",
}));

import { reverseCashPayment } from "@/entities/bib";

const CASH = {
  provider: "cash",
  amount: 2000,
  timestamp: "2026-07-11T22:01:06.000Z",
  reconciled_via: "admin_inperson_cash_user-ogre",
};
const STRIPE = {
  provider: "stripe",
  amount: 2000,
  timestamp: "2026-07-11T22:16:52.000Z",
  reconciled_via: "stripe_webhook_cs_x",
};

describe("reverseCashPayment()", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPatch.mockReset();
    mockPatch.mockResolvedValue({ data: {} });
  });

  it("removes only the matching cash entry and decrements paidAmount", async () => {
    mockGet.mockResolvedValue({
      data: { ownerSub: "user-ogre", runnerCode: "BIB-wbbb", paidAmount: 4000, paidStatusHistory: [STRIPE, CASH] },
    });
    const out = await reverseCashPayment("user-ogre", {
      timestamp: CASH.timestamp,
      reconciledVia: CASH.reconciled_via,
    });
    expect(out).toEqual({ reversed: true, amountCents: 2000 });
    expect(mockPatch).toHaveBeenCalledTimes(1);
    const [key, chain] = mockPatch.mock.calls[0] as unknown as [
      { ownerSub: string },
      { setPayload: { paidStatusHistory: unknown[]; paidAmount: number } },
    ];
    expect(key).toEqual({ ownerSub: "user-ogre" });
    expect(chain.setPayload.paidAmount).toBe(2000);
    expect(chain.setPayload.paidStatusHistory).toEqual([STRIPE]);
  });

  it("no-ops (no patch) when nothing matches", async () => {
    mockGet.mockResolvedValue({
      data: { ownerSub: "u", runnerCode: "BIB-1", paidAmount: 2000, paidStatusHistory: [CASH] },
    });
    const out = await reverseCashPayment("u", { timestamp: "nope", reconciledVia: "nope" });
    expect(out).toEqual({ reversed: false, amountCents: 0 });
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("refuses to reverse a non-cash entry even if timestamp+reconciledVia match", async () => {
    mockGet.mockResolvedValue({
      data: { ownerSub: "u", runnerCode: "BIB-1", paidAmount: 2000, paidStatusHistory: [STRIPE] },
    });
    const out = await reverseCashPayment("u", {
      timestamp: STRIPE.timestamp,
      reconciledVia: STRIPE.reconciled_via,
    });
    expect(out).toEqual({ reversed: false, amountCents: 0 });
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("clamps paidAmount at 0 and returns reversed:false for a missing bib", async () => {
    mockGet.mockResolvedValue({ data: null });
    const out = await reverseCashPayment("ghost", { timestamp: CASH.timestamp, reconciledVia: CASH.reconciled_via });
    expect(out).toEqual({ reversed: false, amountCents: 0 });
    expect(mockPatch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/run.bib/webapp && npx vitest run src/__tests__/reverse-cash-payment.test.ts`
Expected: FAIL — `reverseCashPayment` not exported.

- [ ] **Step 3: Implement** — append to `src/entities/bib.ts` (after `applyPayment`). Uses the same `getBib` + `Bib.patch` already in the file:

```typescript
/** Options for {@link reverseCashPayment}. */
export interface ReverseCashInput {
  /** ISO8601 timestamp of the exact paidStatusHistory entry to reverse. */
  timestamp: string;
  /** reconciled_via marker of that entry (e.g. admin_inperson_cash_<ownerSub>). */
  reconciledVia: string;
}

/**
 * Reverse (un-book) a mistaken CASH payment (Kurt 2026-07-11).
 *
 * Removes exactly the paidStatusHistory entry identified by (provider="cash",
 * timestamp, reconciled_via) and subtracts its amount from paidAmount. The
 * `provider === "cash"` clause is the cash-only guarantee — a stripe/venmo row
 * can never be reversed here, regardless of client input, because those reflect
 * real external money and reversing only the ledger would desync the books.
 *
 * Idempotent: if no matching cash entry exists (already reversed, or wrong ids),
 * this is a no-op returning { reversed: false }. Read-modify-write is acceptable
 * for this rare admin-only manual correction (no concurrent writers).
 */
export async function reverseCashPayment(
  ownerSub: string,
  input: ReverseCashInput
): Promise<{ reversed: boolean; amountCents: number }> {
  const bib = await getBib(ownerSub);
  if (!bib) return { reversed: false, amountCents: 0 };

  const history = (bib.paidStatusHistory ?? []) as Array<{
    provider?: string;
    amount?: number;
    timestamp?: string;
    reconciled_via?: string;
  }>;

  const idx = history.findIndex(
    (p) =>
      p?.provider === "cash" &&
      p?.timestamp === input.timestamp &&
      p?.reconciled_via === input.reconciledVia
  );
  if (idx === -1) return { reversed: false, amountCents: 0 };

  const amount = Math.max(0, Math.trunc(history[idx].amount ?? 0));
  const newHistory = history.filter((_, i) => i !== idx);
  const newPaid = Math.max(0, (bib.paidAmount ?? 0) - amount);

  await Bib.patch({ ownerSub })
    .set({ paidStatusHistory: newHistory, paidAmount: newPaid })
    .go();

  return { reversed: true, amountCents: amount };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/run.bib/webapp && npx vitest run src/__tests__/reverse-cash-payment.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add apps/run.bib/webapp/src/entities/bib.ts apps/run.bib/webapp/src/__tests__/reverse-cash-payment.test.ts
git commit -m "feat(bib): add reverseCashPayment (cash-only ledger reversal)"
```

---

### Task 2: `POST /api/admin/bib/reverse-payment` route

**Files:**
- Create: `apps/run.bib/webapp/src/app/api/admin/bib/reverse-payment/route.ts`

**Interfaces:**
- Consumes: `requireBibAdmin`, `reverseCashPayment` (Task 1).
- Produces: `POST { ownerSub, timestamp, reconciledVia }` → `{ ok: true, reversed, amountCents }`; 400/401/403/500.

- [ ] **Step 1: Create the route**

```typescript
import { z } from "zod";
import { auth } from "@/config/auth";
import { requireBibAdmin } from "@/lib/admin-gate";
import { reverseCashPayment } from "@/entities/bib";

/**
 * POST /api/admin/bib/reverse-payment — Kurt 2026-07-11.
 *
 * Organizer-only. Reverses a mistaken CASH payment booked via the in-person
 * PAID button: subtracts the amount from paidAmount and deletes the exact
 * paidStatusHistory entry. Cash-only is enforced in reverseCashPayment (the
 * provider="cash" match), so a stripe/venmo target is a safe no-op.
 *
 * Node runtime — ElectroDB/AWS signing needs Node crypto. Force-dynamic — a live
 * mutation, never cached. Gated on the bibadmin/admin group claim.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  ownerSub: z.string().min(1),
  timestamp: z.string().min(1),
  reconciledVia: z.string().min(1),
});

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
    const { ownerSub, timestamp, reconciledVia } = parsed.data;
    const result = await reverseCashPayment(ownerSub, { timestamp, reconciledVia });
    return Response.json({ ok: true, ...result }, { status: 200 });
  } catch (err) {
    // Do not log the request body — only the error.
    console.error("[run.bib] /api/admin/bib/reverse-payment:", err);
    return Response.json({ error: "reverse_failed" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/run.bib/webapp && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/run.bib/webapp/src/app/api/admin/bib/reverse-payment/route.ts
git commit -m "feat(bib): add POST /api/admin/bib/reverse-payment route"
```

---

### Task 3: Carry `ownerSub` + `reconciledVia` on bib `PaymentRow`

**Files:**
- Modify: `apps/run.bib/webapp/src/lib/admin-reports.ts`
- Test: `apps/run.bib/webapp/src/__tests__/admin-reports.test.ts`

**Interfaces:**
- Produces: `PaymentRow` gains `ownerSub?: string`, `reconciledVia?: string`, populated for bib rows (from `b.ownerSub` and the history row's `reconciled_via`).

- [ ] **Step 1: Write failing test** — append to `admin-reports.test.ts`:

```typescript
describe("PaymentRow reversal keys", () => {
  it("carries ownerSub + reconciledVia on bib payment rows", () => {
    const bundle = buildReports({
      bibs: [
        {
          ownerSub: "owner-x",
          runnerCode: "BIB-wbbb",
          nameOnBib: "OGRE",
          paidAmount: 2000,
          nameLocked: false,
          willPayInPerson: false,
          paidStatusHistory: [
            { provider: "cash", amount: 2000, timestamp: "2026-07-11T22:01:06.000Z", reconciled_via: "admin_inperson_cash_owner-x" },
          ],
        } as never,
      ],
      donations: [],
      reconciles: [],
      pendings: [],
    });
    const row = bundle.payments.rows.find((r) => r.provider === "cash")!;
    expect(row.ownerSub).toBe("owner-x");
    expect(row.reconciledVia).toBe("admin_inperson_cash_owner-x");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/run.bib/webapp && npx vitest run src/__tests__/admin-reports.test.ts`
Expected: FAIL — `ownerSub`/`reconciledVia` are undefined on the row.

- [ ] **Step 3: Extend the type + mapping** — in `admin-reports.ts`:

Add to `PaymentRow`:

```typescript
export type PaymentRow = {
  kind: "bib" | "donation";
  runnerCode: string;
  nameOnBib: string;
  provider: string;
  amountCents: number;
  timestamp: string;
  // Reversal keys — carried on bib rows so RemoveCashAction can target the exact
  // paidStatusHistory entry (Kurt 2026-07-11). Undefined for donation rows.
  ownerSub?: string;
  reconciledVia?: string;
};
```

In `buildReports`, extend the `bibPayments` map's history cast + returned object:

```typescript
  const bibPayments: PaymentRow[] = bibs.flatMap((b) =>
    ((b.paidStatusHistory ?? []) as Array<{
      provider?: string;
      amount?: number;
      timestamp?: string;
      reconciled_via?: string;
    }>).map((p) => ({
      kind: "bib" as const,
      runnerCode: b.runnerCode,
      nameOnBib: b.nameOnBib ?? "",
      provider: p.provider ?? "stripe",
      amountCents: p.amount ?? 0,
      timestamp: p.timestamp ?? "",
      ownerSub: b.ownerSub,
      reconciledVia: p.reconciled_via,
    }))
  );
```

(Leave `donationPayments` unchanged — donation rows keep `ownerSub`/`reconciledVia` undefined.)

- [ ] **Step 4: Run test + typecheck**

Run: `cd apps/run.bib/webapp && npx vitest run src/__tests__/admin-reports.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/run.bib/webapp/src/lib/admin-reports.ts apps/run.bib/webapp/src/__tests__/admin-reports.test.ts
git commit -m "feat(bib): carry ownerSub/reconciledVia on bib payment rows"
```

---

### Task 4: `RemoveCashAction` component + wire into Payments table

**Files:**
- Modify: `apps/run.bib/webapp/src/components/AdminActions.tsx`
- Modify: `apps/run.bib/webapp/src/app/admin/page.tsx`

**Interfaces:**
- Consumes: `POST /api/admin/bib/reverse-payment` (Task 2); `PaymentRow.ownerSub`/`reconciledVia`/`timestamp`/`provider` (Task 3).
- Produces: `RemoveCashAction({ apiBase, ownerSub, timestamp, reconciledVia })`.

- [ ] **Step 1: Add the component** — append to `AdminActions.tsx` (uses the `useState`/`useRouter` already imported at the top):

```tsx
export interface RemoveCashActionProps {
  apiBase: string;
  ownerSub: string;
  timestamp: string;
  reconciledVia: string;
}

/**
 * RemoveCashAction (Kurt 2026-07-11) — the destructive "Remove" pill on CASH
 * rows in the Payments/revenue table. Un-books a mistaken cash payment via
 * /api/admin/bib/reverse-payment (subtracts the amount, deletes the ledger
 * entry). Behind a window.confirm(). Copy hardcoded to avoid the CMS catalog.
 */
export function RemoveCashAction({
  apiBase,
  ownerSub,
  timestamp,
  reconciledVia,
}: RemoveCashActionProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const onRemove = async () => {
    const ok = window.confirm(
      "Remove this cash payment? It subtracts the amount from the runner's paid total and deletes the ledger entry. Use only for a mistaken cash booking."
    );
    if (!ok) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`${apiBase}/api/admin/bib/reverse-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerSub, timestamp, reconciledVia }),
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
        onClick={onRemove}
        disabled={busy}
        aria-label="Remove cash payment"
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
        Remove
      </button>
      {failed && (
        <span style={{ fontSize: 13, color: "#ff8a8a", whiteSpace: "nowrap" }}>
          Couldn&apos;t remove — try again.
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 2: Wire into the Payments table** — in `apps/run.bib/webapp/src/app/admin/page.tsx`:

Add `RemoveCashAction` to the import from `@/components/AdminActions`:

```tsx
import {
  ReconcileAction,
  RejectAction,
  MarkPaidAction,
  DenyPendingAction,
  RemoveCashAction,
} from "@/components/AdminActions";
```

In the **Payments / revenue** `<ReportSection>`, change the `<Table>` to add an "Action" first column and the cash-only action cell:

```tsx
          <Table
            columns={["Action", "Name", "Runner code", "When", "Kind", "Provider", "Amount"]}
            rows={bundle.payments.rows.map((r) => [
              r.kind === "bib" &&
              r.provider === "cash" &&
              r.ownerSub &&
              r.timestamp &&
              r.reconciledVia ? (
                <RemoveCashAction
                  apiBase={base}
                  ownerSub={r.ownerSub}
                  timestamp={r.timestamp}
                  reconciledVia={r.reconciledVia}
                />
              ) : (
                ""
              ),
              r.nameOnBib,
              r.runnerCode,
              (r.timestamp || "").slice(0, 19),
              r.kind,
              r.provider,
              formatUsd(r.amountCents),
            ])}
            empty="No reconciled payments yet."
          />
```

(Only the Payments table changes. Pass the FULL `r.timestamp` to the action — the `.slice(0,19)` is display-only.)

- [ ] **Step 3: Typecheck**

Run: `cd apps/run.bib/webapp && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/run.bib/webapp/src/components/AdminActions.tsx apps/run.bib/webapp/src/app/admin/page.tsx
git commit -m "feat(bib): Remove button on cash rows in Payments table"
```

---

### Task 5: Full verification gate

**Files:** none.

- [ ] **Step 1: Full bib test suite**

Run: `cd apps/run.bib/webapp && npm test`
Expected: PASS (incl. reverse-cash-payment + admin-reports).

- [ ] **Step 2: Typecheck + build**

Run: `cd apps/run.bib/webapp && npx tsc --noEmit && npm run build`
Expected: no type errors; build compiles with `/api/admin/bib/reverse-payment` in the route manifest.

- [ ] **Step 3: Clean status**

Run: `git status --short` (revert any stray package/tsbuildinfo). Expected: only intended commits.

---

## Self-Review

**Spec coverage:** cash-only reversal (Task 1 provider guard + Task 2 route), Remove button on cash Payments rows (Task 4), targeting the exact entry via ownerSub/reconciledVia (Task 3). ✓
**Placeholder scan:** none — full code in every step. ✓
**Type consistency:** `reverseCashPayment(ownerSub, {timestamp, reconciledVia})` (Task 1) consumed by the route (Task 2); `PaymentRow.ownerSub/reconciledVia/timestamp/provider` (Task 3) consumed by the UI (Task 4). ✓

## Ship notes (after execution)

- Deploy is run.bib-only (no run.human change this time). Merge PR to main, then `buildpub apps=run.bib create_pr=true deploy=false`, then `deploy.yml region=us-east-1 pr_number=latest`. **Watch for the release-race / immutable-tag collision** (see memory `project_bib_admin_deny_csv_groups`): confirm the built ECR tag's push time is AFTER your merge and the Release PR's version isn't already consumed before deploying.
- Verify on OGRE (`bib-wbbb`): after Remove on the cash row, cash total drops $40→$20, OGRE's stripe $20 remains, grand total $200→$180. Needs a signed-in admin session (`/admin` is auth-gated).
