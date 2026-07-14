"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { cls } from "./qr-ui";
import { postQrAction } from "./qr-api";

export interface CtfRecord {
  challenge: string;
  answer?: string;
  points?: number;
  // Scoring curve (Phase 44). Surfaced in the Scoring card below.
  pointMax?: number;
  pointFloor?: number;
  maxSolves?: number;
  firstBloodBonus?: number;
  // Active-window ceilings, edited via the Time tiers card.
  timeTiers?: Array<{ from?: string; to?: string; ceiling?: number }>;
  // Presence ONLY drives the "leave blank to keep answer" edit hint. The row no
  // longer carries plaintext; its value is never rendered.
  answerHash?: string;
  effect?: unknown;
  maxAttempts?: number;
  rateLimitWindow?: number;
  enabled?: boolean;
}

/** A local time-tier row; `_id` is a client-only key (never persisted). */
interface TierRow {
  _id: string;
  from?: string;
  to?: string;
  ceiling?: string;
}

function rid(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

// ── Time-tier datetime helpers (ported from QrForm) ─────────────────────────
// timeTiers store from/to as absolute UTC-ISO strings; a <input
// type="datetime-local"> speaks LOCAL wall-clock "YYYY-MM-DDTHH:mm". The admin
// picks browser-local time and we persist UTC ISO (unambiguous for the judge).

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Stored ISO → the local "YYYY-MM-DDTHH:mm" a datetime-local input wants. */
function toLocalInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}`;
}

/** datetime-local value (local wall-clock) → stored UTC ISO (or "" when empty). */
function fromLocalInput(local: string): string {
  if (!local) return "";
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

const isoOf = (d: Date) => d.toISOString();

/** Quick preset that populates a tier's from/to (the DEF CON 34 window, local). */
const TIER_PRESET = {
  label: "DEF CON 34",
  range: (): { from: string; to: string } => ({
    from: isoOf(new Date(2026, 7, 6, 0, 0, 0)),
    to: isoOf(new Date(2026, 7, 10, 0, 0, 0)),
  }),
};

/**
 * Create/edit form for a CTF challenge. NOTE: the live resolver forwards
 * /ctf/<challenge>/<value> verbatim and never reads this row — these records are
 * data-prep for the Phase-44 judge. Challenge names are lowercase-normalized
 * server-side. `effect` is a free-form JSON object. The answer is HASHED on the
 * server (ctf_upsert → ctfAttributes); the client never hashes and never
 * prefills a plaintext answer on edit — a blank answer field keeps the stored
 * hash untouched.
 */
export default function CtfForm({
  initial,
  mode,
}: {
  initial?: CtfRecord | null;
  mode: "create" | "edit";
}) {
  const router = useRouter();
  const isEdit = mode === "edit";
  const hasStoredAnswer = Boolean(initial?.answerHash);

  const [challenge, setChallenge] = useState(initial?.challenge ?? "");
  // Never prefill the answer on edit — the row no longer carries plaintext.
  const [answer, setAnswer] = useState("");
  const [points, setPoints] = useState(
    initial?.points !== undefined ? String(initial.points) : ""
  );
  const [pointMax, setPointMax] = useState(
    initial?.pointMax !== undefined ? String(initial.pointMax) : ""
  );
  const [pointFloor, setPointFloor] = useState(
    initial?.pointFloor !== undefined ? String(initial.pointFloor) : ""
  );
  const [maxSolves, setMaxSolves] = useState(
    initial?.maxSolves !== undefined ? String(initial.maxSolves) : ""
  );
  const [firstBloodBonus, setFirstBloodBonus] = useState(
    initial?.firstBloodBonus !== undefined ? String(initial.firstBloodBonus) : ""
  );
  const [maxAttempts, setMaxAttempts] = useState(
    initial?.maxAttempts !== undefined ? String(initial.maxAttempts) : ""
  );
  const [rateLimitWindow, setRateLimitWindow] = useState(
    initial?.rateLimitWindow !== undefined ? String(initial.rateLimitWindow) : ""
  );
  const [tiers, setTiers] = useState<TierRow[]>(
    (initial?.timeTiers ?? []).map((t) => ({
      _id: rid(),
      from: t.from,
      to: t.to,
      ceiling: t.ceiling !== undefined ? String(t.ceiling) : "",
    }))
  );
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [effectText, setEffectText] = useState(
    initial?.effect !== undefined ? JSON.stringify(initial.effect, null, 2) : ""
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function numOrUndef(s: string): number | undefined {
    const t = s.trim();
    if (t === "") return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  }

  function updateTier(id: string, patch: Partial<TierRow>) {
    setTiers((ts) => ts.map((t) => (t._id === id ? { ...t, ...patch } : t)));
  }

  async function onSave() {
    setError(null);
    let effect: unknown = undefined;
    if (effectText.trim() !== "") {
      try {
        effect = JSON.parse(effectText);
      } catch {
        setError("Effect must be valid JSON (or empty).");
        return;
      }
    }
    setBusy(true);
    try {
      const timeTiers = tiers
        .filter((t) => (t.from ?? "").trim() !== "" || (t.to ?? "").trim() !== "")
        .map((t) => ({ from: t.from, to: t.to, ceiling: numOrUndef(t.ceiling ?? "") }));
      const ctf = {
        challenge,
        // Send plaintext; the server hashes it (the client never hashes). A
        // blank field on edit tells the server to keep the existing answerHash.
        answer,
        points: numOrUndef(points),
        pointMax: numOrUndef(pointMax),
        pointFloor: numOrUndef(pointFloor),
        maxSolves: numOrUndef(maxSolves),
        firstBloodBonus: numOrUndef(firstBloodBonus),
        maxAttempts: numOrUndef(maxAttempts),
        rateLimitWindow: numOrUndef(rateLimitWindow),
        enabled,
        ...(timeTiers.length ? { timeTiers } : {}),
        ...(effect !== undefined ? { effect } : {}),
      };
      await postQrAction({ action: "ctf_upsert", ctf });
      router.push("/admin/qr");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!confirm(`Delete challenge ${initial?.challenge}? This cannot be undone.`)) return;
    setError(null);
    setBusy(true);
    try {
      await postQrAction({ action: "ctf_delete", challenge: initial?.challenge });
      router.push("/admin/qr");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <div className="rounded-lg border border-danger text-danger bg-danger/10 px-3.5 py-2.5 text-sm">
          {error}
        </div>
      ) : null}

      <div className={cls.cardPad}>
        <label className={cls.label}>Challenge name</label>
        <input
          className={`${cls.input} ${isEdit ? "opacity-60" : ""}`}
          value={challenge}
          onChange={(e) => setChallenge(e.target.value)}
          placeholder="sao"
          disabled={isEdit}
        />
        <p className="text-[12.5px] text-default-500 mt-2">
          Stored lowercase. Submitted via{" "}
          <code>
            q.defcon.run/ctf/{challenge.trim().toLowerCase() || "<name>"}/&lt;guess&gt;
          </code>
          {isEdit ? " · immutable (delete + recreate to rename)." : "."}
        </p>
      </div>

      <div className={cls.cardPad}>
        <label className={cls.label}>Answer</label>
        <input
          className={cls.input}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder={isEdit && hasStoredAnswer ? "•••••• (leave blank to keep)" : ""}
        />
        <p className="text-[12.5px] text-default-500 mt-2">
          {isEdit && hasStoredAnswer
            ? "An answer is already set (stored hashed). Leave this blank to keep it; type a new answer only to replace it."
            : "Hashed on save — the plaintext answer is never stored."}
        </p>
      </div>

      {/* Scoring curve */}
      <div className={cls.cardPad}>
        <label className={cls.label}>Scoring</label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div>
            <label className={cls.label}>Point max</label>
            <input
              className={cls.input}
              inputMode="numeric"
              value={pointMax}
              onChange={(e) => setPointMax(e.target.value)}
            />
          </div>
          <div>
            <label className={cls.label}>Point floor</label>
            <input
              className={cls.input}
              inputMode="numeric"
              value={pointFloor}
              onChange={(e) => setPointFloor(e.target.value)}
            />
          </div>
          <div>
            <label className={cls.label}>Max solves</label>
            <input
              className={cls.input}
              inputMode="numeric"
              value={maxSolves}
              onChange={(e) => setMaxSolves(e.target.value)}
            />
          </div>
          <div>
            <label className={cls.label}>First-blood bonus</label>
            <input
              className={cls.input}
              inputMode="numeric"
              value={firstBloodBonus}
              onChange={(e) => setFirstBloodBonus(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Time tiers */}
      <div className={cls.cardPad}>
        <div className="flex justify-between items-center mb-2.5 gap-2 flex-wrap">
          <label className={`${cls.label} mb-0`}>
            Time tiers (active window overrides Point max with its ceiling)
          </label>
          <button
            type="button"
            className={cls.btn}
            onClick={() => setTiers((ts) => [...ts, { _id: rid(), from: "", to: "", ceiling: "" }])}
          >
            + Time tier
          </button>
        </div>

        {tiers.length === 0 ? (
          <p className="text-[13px] text-default-400">
            No tiers — scoring uses Point max across the whole window.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {tiers.map((t) => (
              <div
                key={t._id}
                className="border border-divider rounded-lg p-3 flex flex-wrap gap-2 items-end"
              >
                <div className="w-full flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-default-400 mr-1">Quick set:</span>
                  <button
                    type="button"
                    className="text-[11px] px-2 py-1 rounded-full border border-divider text-default-500 hover:bg-content2 hover:text-foreground transition-colors"
                    onClick={() => updateTier(t._id, TIER_PRESET.range())}
                  >
                    {TIER_PRESET.label}
                  </button>
                </div>
                <div className="flex-1 min-w-[160px]">
                  <label className={cls.label}>From</label>
                  <input
                    type="datetime-local"
                    className={cls.input}
                    value={toLocalInput(t.from)}
                    onChange={(e) => updateTier(t._id, { from: fromLocalInput(e.target.value) })}
                  />
                </div>
                <div className="flex-1 min-w-[160px]">
                  <label className={cls.label}>To</label>
                  <input
                    type="datetime-local"
                    className={cls.input}
                    value={toLocalInput(t.to)}
                    onChange={(e) => updateTier(t._id, { to: fromLocalInput(e.target.value) })}
                  />
                </div>
                <div className="w-[120px]">
                  <label className={cls.label}>Ceiling</label>
                  <input
                    className={cls.input}
                    inputMode="numeric"
                    value={t.ceiling ?? ""}
                    onChange={(e) => updateTier(t._id, { ceiling: e.target.value })}
                  />
                </div>
                <button
                  type="button"
                  className={cls.btnDanger}
                  onClick={() => setTiers((ts) => ts.filter((x) => x._id !== t._id))}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={cls.cardPad}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div>
            <label className={cls.label}>Points</label>
            <input
              className={cls.input}
              inputMode="numeric"
              value={points}
              onChange={(e) => setPoints(e.target.value)}
            />
          </div>
          <div>
            <label className={cls.label}>Max attempts</label>
            <input
              className={cls.input}
              inputMode="numeric"
              value={maxAttempts}
              onChange={(e) => setMaxAttempts(e.target.value)}
            />
          </div>
          <div>
            <label className={cls.label}>Rate-limit window (s)</label>
            <input
              className={cls.input}
              inputMode="numeric"
              value={rateLimitWindow}
              onChange={(e) => setRateLimitWindow(e.target.value)}
            />
          </div>
        </div>
        <label className="flex gap-2 items-center text-sm mt-3">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enabled
        </label>
      </div>

      <div className={cls.cardPad}>
        <label className={cls.label}>Effect (JSON, optional)</label>
        <textarea
          className={cls.textarea}
          value={effectText}
          onChange={(e) => setEffectText(e.target.value)}
          placeholder={'{ "kind": "confetti", "intensity": 11 }'}
        />
      </div>

      <div className="flex gap-2.5 items-center">
        <button type="button" className={cls.btnPrimary} onClick={onSave} disabled={busy}>
          {busy ? "Saving…" : isEdit ? "Save changes" : "Create challenge"}
        </button>
        <button
          type="button"
          className={cls.btn}
          onClick={() => router.push("/admin/qr")}
          disabled={busy}
        >
          Cancel
        </button>
        {isEdit ? (
          <button
            type="button"
            className={`${cls.btnDanger} ml-auto`}
            onClick={onDelete}
            disabled={busy}
          >
            Delete
          </button>
        ) : null}
      </div>
    </div>
  );
}
