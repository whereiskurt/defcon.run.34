"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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

const FAIL_TEXT = "Couldn't apply — try again.";
// WR-01: the reconcile marker embeds the ORIGINAL amount, so re-approving an
// edited amount is an idempotent no-op server-side. Surface that explicitly so
// an admin correcting an amount knows the correction did NOT land.
const DEDUPED_TEXT = "Already reconciled — amount unchanged.";

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
  // Cents-int discipline: the field holds the integer amount in cents,
  // prefilled from the intent's amountCents (34-UI-SPEC.md).
  const [value, setValue] = useState<string>(String(amountCents ?? 0));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [deduped, setDeduped] = useState(false);

  const onApprove = async () => {
    const cents = Math.trunc(Number(value));
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
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Amount in cents"
        title="Amount in cents"
        disabled={busy}
        style={{
          width: 76,
          padding: "5px 8px",
          borderRadius: 4,
          border: "1px solid #2a2a34",
          backgroundColor: "#0a0a0f",
          color: "#e4e4ef",
          fontSize: 13,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      />
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
        Approve
      </button>
      {failed && (
        <span style={{ fontSize: 13, color: "#ff8a8a", whiteSpace: "nowrap" }}>
          {FAIL_TEXT}
        </span>
      )}
      {deduped && (
        <span
          role="status"
          style={{ fontSize: 13, color: "#f4c680", whiteSpace: "nowrap" }}
        >
          {DEDUPED_TEXT}
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
        PAID
      </button>
      {failed && (
        <span style={{ fontSize: 13, color: "#ff8a8a", whiteSpace: "nowrap" }}>
          {FAIL_TEXT}
        </span>
      )}
      {deduped && (
        <span
          role="status"
          style={{ fontSize: 13, color: "#f4c680", whiteSpace: "nowrap" }}
        >
          Already booked.
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
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const onReject = async () => {
    const ok = window.confirm(
      "Reject this bib? This deletes the bib and pending payments and resets the runner's name-change quota. Donations are kept."
    );
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
        Reject
      </button>
      {failed && (
        <span style={{ fontSize: 13, color: "#ff8a8a", whiteSpace: "nowrap" }}>
          {FAIL_TEXT}
        </span>
      )}
    </span>
  );
}
