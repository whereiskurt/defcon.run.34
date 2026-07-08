# Bib Ordering Workflow Rework — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refocus the bib order page on sponsoring a bib, move donations into the header modal (restyled to match the on-page panel), add a Signal-confirm gate for cash payers, celebrate donations with a cash rain, and reset all bogus test payment data before launch.

**Architecture:** All UI work is in `apps/run.bib/webapp` (Next.js 16 / React 19, inline-styled components, CMS-driven copy via `t()`/`useCopy`). Change ② also touches the byte-duplicated `DonateModal.tsx` in run.human + run.flash. The reset (⑥) is a standalone Node script hitting the shared `run-human-electro` DynamoDB table through the existing ElectroDB entities.

**Tech Stack:** Next.js 16, React 19, TypeScript, vitest 4 + @testing-library/react, ElectroDB, AWS SDK v3.

## Global Constraints

- Copy is CMS-driven — **never hardcode UI strings**; use `t(copy, "key")` (server) or `useCopy().t("key")` (client). The 5 new keys are already live in the catalog + S3; add them to the committed snapshot floor (Task 1).
- `DonateModal.tsx` is duplicated byte-for-byte into run.human + run.flash — change ② must be applied identically to all three (run.bib has already diverged; reconcile).
- No HeroUI modal in the repo — modals use the custom `createPortal` overlay pattern from `DonateModal.tsx`.
- Cash rain is driven by the `rain-store` singleton (`setRaining`), not React props across siblings.
- Branch: `gsd/bib-ui-fixes` (PR #461). Never merge without explicit approval. Push before session end.
- Run `npm test` and `npx tsc --noEmit` from `apps/run.bib/webapp` (and the other two apps for ②) before claiming done.

---

### Task 1: Add the 5 new copy keys to the run.bib snapshot floor

**Files:**
- Modify: `apps/run.bib/webapp/src/lib/copy-snapshot.json`
- Test: `apps/run.bib/webapp/src/__tests__/copy-catalog-bib.test.ts` (existing — verifies snapshot key coverage)

**Interfaces:**
- Produces: snapshot keys `bib.status.donationSuccess`, `bib.cashConfirm.title`, `bib.cashConfirm.instruction`, `bib.cashConfirm.confirm`, `bib.cashConfirm.cancel` — consumed by Tasks 3 & 4.

- [ ] **Step 1: Add the 5 keys** under the `"default"` object in `copy-snapshot.json`, verbatim from the live catalog (values below), keeping alphabetical-ish grouping with neighbors:

```json
"bib.cashConfirm.cancel": "Cancel",
"bib.cashConfirm.confirm": "OK, I'll send it",
"bib.cashConfirm.instruction": "Send your bib code above to Agent X on Signal to confirm your in-person payment — we'll print your bib once it's confirmed.",
"bib.cashConfirm.title": "One more step to lock it in 💵",
"bib.status.donationSuccess": "Donation received — thanks for backing defcon.run 34! 🙏 Reconciliation may take a moment.",
```

- [ ] **Step 2: Verify JSON parses + keys present**

Run: `cd apps/run.bib/webapp && node -e "const s=require('./src/lib/copy-snapshot.json').default; ['bib.cashConfirm.title','bib.cashConfirm.instruction','bib.cashConfirm.confirm','bib.cashConfirm.cancel','bib.status.donationSuccess'].forEach(k=>{if(!s[k])throw new Error('missing '+k)}); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Run the copy-catalog test**

Run: `cd apps/run.bib/webapp && npx vitest run copy-catalog-bib`
Expected: PASS (if it enumerates required keys, add the 5 there too so it passes).

- [ ] **Step 4: Commit**

```bash
git add apps/run.bib/webapp/src/lib/copy-snapshot.json apps/run.bib/webapp/src/__tests__/copy-catalog-bib.test.ts
git commit -m "feat(bib): snapshot floor for donation + cash-confirm copy keys"
```

---

### Task 2: ① Drop the Donate tile; Sponsor tile full-width; ④ reconcile sponsored state

**Files:**
- Modify: `apps/run.bib/webapp/src/components/ContributionTiles.tsx`
- Modify: `apps/run.bib/webapp/src/app/orderform/page.tsx:276-281` (ContributionTiles usage — prop cleanup)

**Interfaces:**
- Consumes: `hasSponsored`, `initialRaining`, `initialBurning`, `runnerCode` (unchanged props).
- Produces: `ContributionTiles` now renders a single full-width Sponsor tile (no Donate tile, no 2-up grid). When `hasSponsored`, renders `null` (nothing to buy — the page's `ContributionChip`/thank-you covers it).

- [ ] **Step 1: Rewrite the `ContributionTiles` return** so there is no Donate tile and the Sponsor tile spans full width. Replace the `hasSponsored` early-return and the 2-up grid with:

```tsx
  // Already PAID → nothing left to buy; the page's contribution chip + thank-you
  // banner communicate the paid state. No tile to render.
  if (hasSponsored) return null;

  // Not paid: a single FULL-WIDTH Sponsor tile (Donate moved to the header modal).
  // Pledging in person / torching dims the tile and (unless burned) rains over it.
  const dimSponsor = raining || isBurned;
  return (
    <div
      aria-disabled={dimSponsor || undefined}
      style={{ minWidth: 0, position: "relative", borderRadius: 14, overflow: "hidden" }}
    >
      <div style={dimSponsor ? { opacity: 0.5, pointerEvents: "none" } : undefined}>
        <Tile
          kicker={t("bib.contribution.kickerThis")}
          title={t("bib.contribution.sponsorTitle")}
          body={t("bib.contribution.sponsorBody")}
          art={<SponsorArt />}
        >
          <SponsorForm
            variant="bib"
            ctaLabel={t("bib.contribution.sponsorVerb")}
            runnerCode={runnerCode}
            disabled={dimSponsor}
          />
        </Tile>
      </div>
      {dimSponsor && !isBurned && <CashRain active />}
    </div>
  );
```

- [ ] **Step 2: Delete the now-unused `donateTile` helper** and the `DonateArt` function from `ContributionTiles.tsx` (the Donate tile no longer renders here; `DonateArt` moves into `DonateModal` in Task 5 — copy it there, don't share). Keep `SponsorArt`, `Tile`.

- [ ] **Step 3: Typecheck**

Run: `cd apps/run.bib/webapp && npx tsc --noEmit`
Expected: exit 0 (no unused-symbol or missing-import errors).

- [ ] **Step 4: Manual verify** the order page renders one full-width Sponsor tile, no Donate tile; a sponsored bib shows no buy tile. (Covered by the run gate at the end; note it here.)

- [ ] **Step 5: Commit**

```bash
git add apps/run.bib/webapp/src/components/ContributionTiles.tsx apps/run.bib/webapp/src/app/orderform/page.tsx
git commit -m "feat(bib): drop Donate tile from order page, Sponsor goes full-width"
```

---

### Task 3: ⑤ CashConfirmModal + gate the pay-in-person pledge behind it

**Files:**
- Create: `apps/run.bib/webapp/src/components/CashConfirmModal.tsx`
- Modify: `apps/run.bib/webapp/src/components/ContributionChoice.tsx`
- Modify: `apps/run.bib/webapp/src/app/orderform/page.tsx:270` (pass `runnerCode` to `ContributionChoice`)
- Test: `apps/run.bib/webapp/src/__tests__/contribution-choice-cash-gate.test.tsx` (new)

**Interfaces:**
- Produces: `CashConfirmModal({ open, runnerCode, onConfirm, onCancel }): JSX.Element | null`.
- Consumes: `RunnerCodeBadge` (`components/RunnerCodeBadge.tsx`), `useCopy`.
- `ContributionChoice` gains prop `runnerCode?: string`.

- [ ] **Step 1: Write the failing test** for the gating behavior:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CopyProvider } from "@/components/CopyProvider";
import { ContributionChoice } from "@/components/ContributionChoice";
import * as rainStore from "@/lib/rain-store";

const copy = { "bib.cashConfirm.title": "T", "bib.cashConfirm.instruction": "I",
  "bib.cashConfirm.confirm": "OK", "bib.cashConfirm.cancel": "Cancel",
  "bib.contribution.optInPerson": "Pay in person", "bib.contribution.optBurn": "Burn",
  "bib.contribution.hintNothing": "", "bib.contribution.hintInPerson": "",
  "bib.contribution.hintBurn": "" } as Record<string, string>;

const wrap = (ui: React.ReactNode) => render(<CopyProvider value={copy}>{ui}</CopyProvider>);

describe("ContributionChoice cash gate", () => {
  it("opens the modal on pay-in-person and does NOT rain until confirmed", () => {
    const setRaining = vi.spyOn(rainStore, "setRaining");
    wrap(<ContributionChoice initialChoice="nothing" runnerCode="BIB-1234" />);
    fireEvent.click(screen.getByLabelText("Pay in person"));
    expect(screen.getByText("I")).toBeInTheDocument();      // modal open
    expect(setRaining).not.toHaveBeenCalledWith(true);       // no rain yet
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByText("I")).not.toBeInTheDocument(); // modal closed
    expect(setRaining).not.toHaveBeenCalledWith(true);       // cancel = no rain
  });

  it("rains after confirming", () => {
    const setRaining = vi.spyOn(rainStore, "setRaining");
    wrap(<ContributionChoice initialChoice="nothing" runnerCode="BIB-1234" />);
    fireEvent.click(screen.getByLabelText("Pay in person"));
    fireEvent.click(screen.getByText("OK"));
    expect(setRaining).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd apps/run.bib/webapp && npx vitest run contribution-choice-cash-gate`
Expected: FAIL (`runnerCode` prop unknown / modal never opens).

- [ ] **Step 3: Create `CashConfirmModal.tsx`** (portal overlay, DonateModal pattern):

```tsx
"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { RunnerCodeBadge } from "./RunnerCodeBadge";
import { useCopy } from "@/components/CopyProvider";

/**
 * CashConfirmModal (⑤ 2026-07-08) — the friction gate shown when a runner opts
 * to pay in person. Displays their bib code (copyable) + a Signal instruction.
 * OK commits the pledge (caller persists + rains); Cancel/Esc/backdrop reverts.
 */
export interface CashConfirmModalProps {
  open: boolean;
  runnerCode?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function CashConfirmModal({ open, runnerCode, onConfirm, onCancel }: CashConfirmModalProps) {
  const { t } = useCopy();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex",
        alignItems: "center", justifyContent: "center", padding: 16,
        background: "rgba(4,4,8,0.72)", backdropFilter: "blur(4px)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 420, background: "#12121a",
          border: "1px solid #24242e", borderRadius: 14, padding: 20,
          display: "flex", flexDirection: "column", gap: 14 }}
      >
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "var(--bib-ink)" }}>
          {t("bib.cashConfirm.title")}
        </h2>
        {runnerCode && <RunnerCodeBadge code={runnerCode} />}
        <p style={{ margin: 0, color: "var(--bib-muted)", fontSize: 14, lineHeight: 1.5 }}>
          {t("bib.cashConfirm.instruction")}
        </p>
        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <button type="button" onClick={onCancel}
            style={{ flex: "0 0 auto", padding: "12px 16px", borderRadius: 6,
              background: "transparent", border: "1px solid var(--bib-border-2)",
              color: "var(--bib-ink)", fontWeight: 600, cursor: "pointer" }}>
            {t("bib.cashConfirm.cancel")}
          </button>
          <button type="button" onClick={onConfirm}
            style={{ flex: 1, padding: "12px 16px", borderRadius: 6, background: "#6CCDB8",
              border: "none", color: "#0a0a0a", fontWeight: 700, cursor: "pointer" }}>
            {t("bib.cashConfirm.confirm")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default CashConfirmModal;
```

- [ ] **Step 4: Gate `ContributionChoice`** — add the `runnerCode` prop, a `pendingInPerson` modal-open state, and route the `inperson` pick through the modal. Change the props interface and `onSelect`:

```tsx
// import at top:
import { CashConfirmModal } from "./CashConfirmModal";

export interface ContributionChoiceProps {
  initialChoice: Choice;
  runnerCode?: string;
}

export function ContributionChoice({ initialChoice, runnerCode }: ContributionChoiceProps) {
  // ...existing hooks...
  const [cashModalOpen, setCashModalOpen] = useState(false);

  // Commit the in-person pledge for real (after the modal OK): flip state,
  // rain, and persist — same effects the other picks apply inline.
  const commitInPerson = useCallback(() => {
    setCashModalOpen(false);
    setLimitReached(false);
    setChoice("inperson");
    applyStores("inperson");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { timerRef.current = null; runPatch("inperson"); }, PATCH_DEBOUNCE_MS);
  }, [applyStores, runPatch]);

  const onSelect = useCallback((next: Choice) => {
    if (next === choice) return;
    // Pay-in-person is gated behind the Signal-confirm modal (⑤). Don't flip
    // the checkbox, rain, or PATCH until the runner clicks OK.
    if (next === "inperson") { setCashModalOpen(true); return; }
    setLimitReached(false);
    setChoice(next);
    applyStores(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { timerRef.current = null; runPatch(next); }, PATCH_DEBOUNCE_MS);
  }, [choice, applyStores, runPatch]);
```

And render the modal at the end of the returned JSX (inside the outer `<div>`), passing `runnerCode`:

```tsx
      <CashConfirmModal
        open={cashModalOpen}
        runnerCode={runnerCode}
        onConfirm={commitInPerson}
        onCancel={() => setCashModalOpen(false)}
      />
```

- [ ] **Step 5: Pass `runnerCode` from the page** — `app/orderform/page.tsx` line ~270:

```tsx
{showCheckbox && <ContributionChoice initialChoice={initialChoice} runnerCode={bib.runnerCode} />}
```

- [ ] **Step 6: Run the test — expect PASS**

Run: `cd apps/run.bib/webapp && npx vitest run contribution-choice-cash-gate`
Expected: PASS (both cases).

- [ ] **Step 7: Typecheck + commit**

```bash
cd apps/run.bib/webapp && npx tsc --noEmit
git add apps/run.bib/webapp/src/components/CashConfirmModal.tsx apps/run.bib/webapp/src/components/ContributionChoice.tsx apps/run.bib/webapp/src/app/orderform/page.tsx apps/run.bib/webapp/src/__tests__/contribution-choice-cash-gate.test.tsx
git commit -m "feat(bib): Signal-confirm modal gates the pay-in-person pledge (⑤)"
```

---

### Task 4: ③ Donation → status=donated + one-shot cash rain + thank-you

**Files:**
- Modify: `apps/run.bib/webapp/src/app/api/checkout/general/route.ts:191` (success_url)
- Modify: `apps/run.bib/webapp/src/components/StripeStatusBanner.tsx` (accept `"donated"`)
- Modify: `apps/run.bib/webapp/src/app/orderform/page.tsx:84-85` (accept `"donated"` status) + mount a one-shot rain trigger
- Create: `apps/run.bib/webapp/src/components/DonationRain.tsx` (client, fires `setRaining(true)` once on mount)
- Test: `apps/run.bib/webapp/src/__tests__/donation-status.test.ts` (new — pure status mapping)

**Interfaces:**
- Consumes: `rain-store.setRaining`, `useCopy`.
- Produces: `StripeStatusBanner` accepts `status: "success" | "cancel" | "donated"`; page recognizes `"donated"`.

- [ ] **Step 1: Point the general success_url at `?status=donated`** (`route.ts:191`):

```ts
      success_url: `${base}/orderform?status=donated`,
```

(Leave `cancel_url` as `?status=cancel`. Bib checkout keeps `?status=success` — do NOT change `checkout/bib/route.ts`.)

- [ ] **Step 2: Write the failing test** for status parsing (extract a tiny pure helper to keep the server component testable):

```ts
import { describe, it, expect } from "vitest";
import { parseStatus } from "@/lib/order-status";

describe("parseStatus", () => {
  it("recognizes the three states + null", () => {
    expect(parseStatus("success")).toBe("success");
    expect(parseStatus("cancel")).toBe("cancel");
    expect(parseStatus("donated")).toBe("donated");
    expect(parseStatus("bogus")).toBe(null);
    expect(parseStatus(undefined)).toBe(null);
  });
});
```

- [ ] **Step 3: Run to confirm fail**

Run: `cd apps/run.bib/webapp && npx vitest run donation-status`
Expected: FAIL (`@/lib/order-status` missing).

- [ ] **Step 4: Create `src/lib/order-status.ts`:**

```ts
export type OrderStatus = "success" | "cancel" | "donated";

/** Narrow the `?status=` querystring to a known order-status, else null. */
export function parseStatus(raw: string | string[] | undefined): OrderStatus | null {
  return raw === "success" || raw === "cancel" || raw === "donated" ? raw : null;
}
```

- [ ] **Step 5: Use it in `page.tsx`** — replace the inline status parse (lines ~83-85):

```tsx
  const status = parseStatus(params.status);
```

(add `import { parseStatus } from "@/lib/order-status";`)

- [ ] **Step 6: Extend `StripeStatusBanner`** to handle `"donated"`:

```tsx
export function StripeStatusBanner({ status }: { status: "success" | "cancel" | "donated" }) {
  // ...existing dismiss effect...
  const isSuccess = status === "success" || status === "donated";
  const message =
    status === "donated" ? t("bib.status.donationSuccess")
    : status === "success" ? t("bib.status.paymentSuccess")
    : t("bib.status.paymentCancel");
  // ...unchanged styled div using isSuccess...
}
```

- [ ] **Step 7: Create `DonationRain.tsx`** (one-shot, non-persistent — does NOT set the willPayInPerson pledge):

```tsx
"use client";
import { useEffect } from "react";
import { setRaining } from "@/lib/rain-store";

/** One-shot celebratory rain on returning from a completed donation.
 *  CashRain's own ~60s cap ends it; we only kick it on mount. */
export function DonationRain() {
  useEffect(() => { setRaining(true); }, []);
  return null;
}
export default DonationRain;
```

- [ ] **Step 8: Mount it in `page.tsx`** where the banner renders, only when donated:

```tsx
{status && <StripeStatusBanner status={status} />}
{status === "donated" && <DonationRain />}
```

- [ ] **Step 9: Run tests + typecheck — expect PASS/0**

Run: `cd apps/run.bib/webapp && npx vitest run donation-status && npx tsc --noEmit`
Expected: PASS, exit 0.

- [ ] **Step 10: Commit**

```bash
git add apps/run.bib/webapp/src/app/api/checkout/general/route.ts apps/run.bib/webapp/src/components/StripeStatusBanner.tsx apps/run.bib/webapp/src/components/DonationRain.tsx apps/run.bib/webapp/src/lib/order-status.ts apps/run.bib/webapp/src/app/orderform/page.tsx apps/run.bib/webapp/src/__tests__/donation-status.test.ts
git commit -m "feat(bib): donation return lands on bib with thank-you + one-shot rain (③)"
```

---

### Task 5: ② Restyle DonateModal to the Donate panel — all 3 apps

**Files:**
- Modify: `apps/run.bib/webapp/src/components/DonateModal.tsx`
- Modify: `apps/run.human/webapp/src/components/DonateModal.tsx`
- Modify: `apps/run.flash/webapp/src/components/DonateModal.tsx`

**Interfaces:** No prop changes — internal restyle only. Reuses existing copy keys (`bib.donate.title`, `bib.contribution.donateBody`, `bib.contribution.kickerSupport`) that already resolve in all three apps.

- [ ] **Step 1: Diff run.bib's divergence** so the reconciled version is intentional:

Run: `diff apps/run.human/webapp/src/components/DonateModal.tsx apps/run.bib/webapp/src/components/DonateModal.tsx`
Expected: review the delta; carry any run.bib-specific behavior (e.g. same-origin `bibOrigin=""`) into the final shared body.

- [ ] **Step 2: Add the panel chrome to the modal card** — inside the modal card `<div>`, above the existing amount/provider/CTA form, insert a centered graphic + kicker + title + body block. Add the self-contained `DonateArt` SVG at the bottom of the file (copy from the pre-Task-2 `ContributionTiles.tsx`):

```tsx
{/* Donate panel header (⑤ 2026-07-08) — matches the on-page tile look. */}
<div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, paddingBottom: 4 }}>
  <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11,
    letterSpacing: "0.2em", textTransform: "uppercase", color: "#7a9dff" }}>
    {t("bib.contribution.kickerSupport")}
  </span>
  <div style={{ color: "#7a9dff" }}><DonateArt /></div>
  <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0, textAlign: "center", color: "var(--bib-ink)" }}>
    {t("bib.donate.title")}
  </h2>
  <p style={{ margin: 0, color: "var(--bib-muted)", fontSize: 14, lineHeight: 1.5, textAlign: "center" }}>
    {t("bib.contribution.donateBody")}
  </p>
</div>
```

```tsx
/** Donate panel art — pixel-coin motif (copied from the on-page tile). */
function DonateArt() {
  return (
    <svg width="88" height="88" viewBox="0 0 88 88" fill="none" aria-hidden="true">
      <circle cx="52" cy="52" r="20" fill="currentColor" fillOpacity="0.15" />
      <circle cx="44" cy="44" r="24" stroke="currentColor" strokeWidth="2.5" fill="none" />
      <circle cx="44" cy="44" r="18" stroke="currentColor" strokeWidth="1.5" fill="none" strokeDasharray="4 3" />
      <text x="44" y="52" textAnchor="middle" fontSize="24" fontWeight="900" fill="currentColor" fontFamily="ui-monospace, Menlo, monospace">$</text>
      <circle cx="20" cy="20" r="2" fill="currentColor" fillOpacity="0.7" />
      <circle cx="72" cy="16" r="1.5" fill="currentColor" fillOpacity="0.5" />
      <circle cx="16" cy="72" r="1.5" fill="currentColor" fillOpacity="0.5" />
    </svg>
  );
}
```

- [ ] **Step 3: Copy the reconciled file to the other two apps** so they stay byte-identical to each other (run.bib keeps its origin diff):

Run: `cp apps/run.human/webapp/src/components/DonateModal.tsx /tmp/dm.tsx` (after editing run.human), then apply the same header edit to run.flash. Verify: `md5 apps/run.human/webapp/src/components/DonateModal.tsx apps/run.flash/webapp/src/components/DonateModal.tsx` → identical hashes.

- [ ] **Step 4: Typecheck all three**

Run: `for a in run.bib run.human run.flash; do (cd apps/$a/webapp && npx tsc --noEmit) || echo "FAIL $a"; done`
Expected: no FAIL lines.

- [ ] **Step 5: Commit**

```bash
git add apps/run.bib/webapp/src/components/DonateModal.tsx apps/run.human/webapp/src/components/DonateModal.tsx apps/run.flash/webapp/src/components/DonateModal.tsx
git commit -m "feat(bib): restyle Donate modal to the on-page panel (graphic + copy), all 3 apps (②)"
```

---

### Task 6: ⑥ Release reset — nuke all bib test payment data (dry-run first)

**Files:**
- Create: `apps/run.bib/webapp/scripts/reset-payment-data.mjs`

**Interfaces:** standalone Node script; reads `RUN_ELECTRO_*` / `RUN_DYNAMODB_*` from env; deletes ALL rows of `Bib`, `GeneralDonation`, `PendingContribution`, `BibReconcile`. Dry-run by default; `--confirm` performs deletes.

- [ ] **Step 1: Write the script.** Reuse ElectroDB via a minimal inline client (the webapp entities import server-only paths; a standalone script re-declares the four entities' service/table so it can `.scan` + `.delete`). Simplest robust approach — raw DynamoDB scan + batched delete filtered by the ElectroDB `__edb_e__` entity attribute:

```js
#!/usr/bin/env node
// Reset ALL bib test payment data. Dry-run by default; pass --confirm to delete.
// Env: RUN_ELECTRO_ID/SECRET, RUN_DYNAMODB_REGION, RUN_ELECTRO_DBNAME (default run-human-electro).
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

const CONFIRM = process.argv.includes("--confirm");
const TABLE = process.env.RUN_ELECTRO_DBNAME || "run-human-electro";
const ENTITIES = ["Bib", "GeneralDonation", "PendingContribution", "BibReconcile"];

const doc = DynamoDBDocument.from(new DynamoDB({
  region: process.env.RUN_DYNAMODB_REGION,
  credentials: { accessKeyId: process.env.RUN_ELECTRO_ID, secretAccessKey: process.env.RUN_ELECTRO_SECRET },
  ...(process.env.RUN_ELECTRO_ENDPOINT ? { endpoint: process.env.RUN_ELECTRO_ENDPOINT } : {}),
}));

async function scanEntity(entity) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const r = await doc.scan({
      TableName: TABLE,
      FilterExpression: "#e = :e",
      ExpressionAttributeNames: { "#e": "__edb_e__" },
      ExpressionAttributeValues: { ":e": entity },
      ExclusiveStartKey,
    });
    items.push(...(r.Items || []));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

(async () => {
  console.log(`Table: ${TABLE}  Region: ${process.env.RUN_DYNAMODB_REGION}  Mode: ${CONFIRM ? "DELETE" : "DRY-RUN"}`);
  let grand = 0;
  for (const entity of ENTITIES) {
    const items = await scanEntity(entity);
    console.log(`  ${entity}: ${items.length} rows`);
    grand += items.length;
    if (CONFIRM && items.length) {
      for (const batch of chunk(items, 25)) {
        await doc.batchWrite({ RequestItems: { [TABLE]: batch.map((it) => ({
          DeleteRequest: { Key: { pk: it.pk, sk: it.sk } } })) } });
      }
      console.log(`    deleted ${items.length}`);
    }
  }
  console.log(`${CONFIRM ? "Deleted" : "Would delete"} ${grand} rows total.`);
  if (!CONFIRM) console.log("Re-run with --confirm to delete.");
})().catch((e) => { console.error(e); process.exit(1); });
```

> NOTE: confirm the table's key attribute names are `pk`/`sk` — verify against `bib.ts`'s ElectroDB index config before running. If the table uses different PK/SK names, adjust the `Key` in the DeleteRequest.

- [ ] **Step 2: Dry-run against LOCAL first** (validate the scan/count logic without risk):

Run (operator, with local electro env): `node apps/run.bib/webapp/scripts/reset-payment-data.mjs`
Expected: prints per-entity counts, `Would delete N rows total.`, no deletes.

- [ ] **Step 3: Dry-run against PROD** (operator, with prod `RUN_ELECTRO_*` creds): confirm the counts look like test data.

- [ ] **Step 4: Execute against PROD** with `--confirm` (operator). Expected: `Deleted N rows total.` Re-run dry-run → all four entities report `0 rows`.

- [ ] **Step 5: Commit the script**

```bash
git add apps/run.bib/webapp/scripts/reset-payment-data.mjs
git commit -m "feat(bib): one-off script to reset all test payment data (dry-run default) (⑥)"
```

---

## Self-Review

- **Spec coverage:** ①→Task 2, ②→Task 5, ③→Task 4, ④→Task 2 (sponsored=null tile) + existing gates, ⑤→Task 3, ⑥→Task 6, CMS keys→already seeded + Task 1 snapshot floor. All covered.
- **Placeholder scan:** none — all steps carry real code/commands.
- **Type consistency:** `parseStatus`/`OrderStatus` used identically in Tasks 4; `CashConfirmModal` prop shape matches its usage in `ContributionChoice`; `runnerCode` threaded page→ContributionChoice→CashConfirmModal.
- **`paymentSuccess` reword:** intentionally deferred (current wording reads fine for bib; rewording live now would mis-greet donors pre-deploy). Not a gap.

## Final gates (run once at the end, before pushing)
- `cd apps/run.bib/webapp && npm test && npx tsc --noEmit`
- Manual run of the order page (see `/run` skill): one full-width Sponsor tile; header Donate opens the restyled panel; cash toggle → modal → OK rains / Cancel reverts; donation return shows thank-you + rain; sponsored bib hides controls.
- `git pull --rebase && git push` (PR #461).
