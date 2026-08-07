"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { apiBase } from "./qr-ui";

/**
 * "Rescore everyone" — a UI trigger for POST /api/admin/rescore-all.
 *
 * WHY THIS EXISTS: scores are DERIVED but PERSISTED (points-consistency —
 * `rescoreUser` is the sole writer of RunUser score fields). A scoring change
 * or a config retune is therefore invisible until every runner rescores, and
 * the bulk endpoint had no caller anywhere in the UI: the only way to run it
 * was hand-rolling a fetch in devtools with an admin session. It is needed
 * after any retune, not just once, so it gets a button.
 *
 * NOT destructive — it recomputes from the ledger and is idempotent, so unlike
 * `CtfUnsolveButton` there is no `confirm()` gate. It IS slow (a full RunUser
 * scan, then every runner rescored 5-at-a-time), so the button reports the
 * `{ total, ok, failed }` tally rather than just succeeding silently, and
 * refreshes the page so the standings re-render from the new scores.
 *
 * Region-basePath-aware via `apiBase()` — a bare `/api/...` 404s in prod
 * because Next.js `basePath` strips the region segment.
 */
export default function RescoreAllButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function onClick() {
    setBusy(true);
    setMsg(null);
    setFailed(false);
    try {
      const res = await fetch(`${apiBase()}/api/admin/rescore-all`, {
        method: "POST",
      });
      if (!res.ok) {
        setFailed(true);
        // 404 is the admin gate's non-disclosure denial, not a missing route.
        setMsg(res.status === 404 ? "not authorized" : `failed (${res.status})`);
        return;
      }
      const data = (await res.json()) as {
        total: number;
        ok: number;
        failed: number;
      };
      // A partial failure is reported, never swallowed — `rescore-all` counts
      // failures rather than aborting, so "ok" alone would hide them.
      setFailed(data.failed > 0);
      setMsg(
        data.failed > 0
          ? `${data.ok}/${data.total} rescored, ${data.failed} failed`
          : `${data.ok}/${data.total} rescored`
      );
      router.refresh();
    } catch {
      setFailed(true);
      setMsg("failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="rounded-lg bg-primary px-3 py-1 text-[12px] font-medium text-black disabled:opacity-50"
        title="Recompute every runner's score from their ledger against current config. Idempotent; safe to re-run."
      >
        {busy ? "Rescoring everyone…" : "Rescore everyone"}
      </button>
      {msg ? (
        <span
          className={`text-[11px] ${failed ? "text-danger" : "text-success"}`}
        >
          {msg}
        </span>
      ) : null}
    </div>
  );
}
