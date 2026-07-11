"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCopy } from "@/components/CopyProvider";

/**
 * AdminActions — v1.8 Phase 34 (Kurt 2026-07-04).
 *
 * Client-side inline actions for the plain dark-theme /admin dashboard. Two
 * exports, wired into the existing tables by admin/page.tsx:
 *   - ReconcileAction → the Outstanding table's pending-intent rows: an editable
 *     amount (cents) + a mint "Approve" pill that POSTs the reconcile route.
 *   - RejectAction    → the All-registrations roster rows: a destructive
 *     "Reject" button behind a window.confirm() that POSTs the reject route.
 *
 * Both refresh the server component on success (router.refresh()) and surface a
 * quiet inline "Couldn't apply — try again." on failure WITHOUT refreshing, so
 * the admin can retry. Styling matches admin/page.tsx (mint #6CCDB8 primary,
 * #ff8a8a destructive, 13px monospace/700). See 34-UI-SPEC.md IC-4.
 */

// Visible prose (fail/deduped/labels/reject-confirm) now resolves from the
// bib.admin.* catalog via useCopy() at render — NOT module scope (hook rule).
// WR-01 rationale for the deduped notice (bib.admin.dedupedText): the reconcile
// marker embeds the ORIGINAL amount, so re-approving an edited amount is an
// idempotent no-op server-side; surface that so an admin correcting an amount
// knows the correction did NOT land.

export interface ReconcileActionProps {
  apiBase: string;
  pendingId: string;
  ownerSub: string;
  kind: "bib" | "donation";
  provider: "venmo" | "cashapp";
  amountCents: number;
}

export function ReconcileAction({
  apiBase,
  pendingId,
  ownerSub,
  kind,
  provider,
  amountCents,
}: ReconcileActionProps) {
  const router = useRouter();
  const { t } = useCopy();
  // The field holds the amount as DOLLARS for display/entry (prefilled from the
  // intent's amountCents, e.g. 2000 → "20.00"), converted back to integer cents
  // on submit. The reconcile API contract is unchanged — it still POSTs cents.
  const [value, setValue] = useState<string>(
    ((amountCents ?? 0) / 100).toFixed(2)
  );
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [deduped, setDeduped] = useState(false);

  const onApprove = async () => {
    // Dollars → integer cents (the field is money now, not raw cents).
    const cents = Math.round(Number(value) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      setFailed(true);
      return;
    }
    setBusy(true);
    setFailed(false);
    setDeduped(false);
    try {
      const res = await fetch(`${apiBase}/api/admin/bib/reconcile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pendingId,
          ownerSub,
          kind,
          provider,
          amountCents: cents,
        }),
      });
      if (res.ok) {
        // WR-01: a deduped response means the marker already existed and the
        // amount was NOT changed — do NOT silently refresh as if it applied.
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
        onClick={onApprove}
        disabled={busy}
        aria-label="Approve payment"
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
          {t("bib.admin.dedupedText")}
        </span>
      )}
    </span>
  );
}

export interface MarkPaidActionProps {
  apiBase: string;
  ownerSub: string;
  /** Amount to book, cents. Defaults to the $20 bib price (the pledge amount). */
  amountCents?: number;
}

/**
 * MarkPaidAction (Kurt 2026-07-05) — the "PAID" pill on Outstanding + in-person
 * pledge rows. When a runner hands over cash at the event, the organizer taps
 * PAID: this books `amountCents` (default $20) against the bib via
 * /api/admin/bib/mark-paid, dropping the row off Outstanding and adding it to
 * revenue. Idempotent server-side (a re-tap is a no-op → "already booked").
 */
export function MarkPaidAction({
  apiBase,
  ownerSub,
  amountCents = 2000,
}: MarkPaidActionProps) {
  const router = useRouter();
  const { t } = useCopy();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [deduped, setDeduped] = useState(false);

  const onMarkPaid = async () => {
    setBusy(true);
    setFailed(false);
    setDeduped(false);
    try {
      const res = await fetch(`${apiBase}/api/admin/bib/mark-paid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerSub, amountCents }),
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
      <button
        type="button"
        onClick={onMarkPaid}
        disabled={busy}
        aria-label="Mark paid in person"
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
        {t("bib.admin.paid")}
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

export interface RejectActionProps {
  apiBase: string;
  ownerSub: string;
}

export function RejectAction({ apiBase, ownerSub }: RejectActionProps) {
  const router = useRouter();
  const { t } = useCopy();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const onReject = async () => {
    const ok = window.confirm(t("bib.admin.rejectConfirm"));
    if (!ok) return;

    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`${apiBase}/api/admin/bib/reject`, {
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
        onClick={onReject}
        disabled={busy}
        aria-label="Reject bib"
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
        {t("bib.admin.reject")}
      </button>
      {failed && (
        <span style={{ fontSize: 13, color: "#ff8a8a", whiteSpace: "nowrap" }}>
          {t("bib.admin.failText")}
        </span>
      )}
    </span>
  );
}
