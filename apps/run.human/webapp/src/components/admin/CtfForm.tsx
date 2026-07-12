"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { cls } from "./qr-ui";
import { postQrAction } from "./qr-api";

export interface CtfRecord {
  challenge: string;
  answer?: string;
  points?: number;
  effect?: unknown;
  maxAttempts?: number;
  rateLimitWindow?: number;
  enabled?: boolean;
}

/**
 * Create/edit form for a CTF challenge. NOTE: the live resolver forwards
 * /ctf/<challenge>/<value> verbatim and never reads this row — these records are
 * data-prep for the future Phase-5 judge. Challenge names are lowercase-
 * normalized server-side. `effect` is a free-form JSON object.
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

  const [challenge, setChallenge] = useState(initial?.challenge ?? "");
  const [answer, setAnswer] = useState(initial?.answer ?? "");
  const [points, setPoints] = useState(
    initial?.points !== undefined ? String(initial.points) : ""
  );
  const [maxAttempts, setMaxAttempts] = useState(
    initial?.maxAttempts !== undefined ? String(initial.maxAttempts) : ""
  );
  const [rateLimitWindow, setRateLimitWindow] = useState(
    initial?.rateLimitWindow !== undefined ? String(initial.rateLimitWindow) : ""
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
      const ctf = {
        challenge,
        answer,
        points: numOrUndef(points),
        maxAttempts: numOrUndef(maxAttempts),
        rateLimitWindow: numOrUndef(rateLimitWindow),
        enabled,
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
        <input className={cls.input} value={answer} onChange={(e) => setAnswer(e.target.value)} />
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
