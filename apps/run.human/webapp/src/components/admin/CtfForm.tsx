"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";

import { cls } from "./qr-ui";
import { postQrAction } from "./qr-api";
import {
  presetToAdvanced,
  previewPoints,
  inferAnswerType,
  inferChallengeType,
  buildOtpAnswerField,
  formStateToScoreWindow,
  scoreWindowToFormState,
  PRESET_IDS,
  type ChallengeTypePreset,
  type OtpAnswerField,
  type RedactedCtfRecord,
} from "./ctf-form-model";
import {
  TZ_OPTIONS,
  DEFCON_RUN_HOURS,
  WEEKDAY_LABELS,
  validateScoreWindow,
} from "@/lib/ctf-score-window";
import { asOtpEnrollEffect } from "@/lib/ctf-otp-enroll";
import CtfOtpEnroll from "@/components/ctf/CtfOtpEnroll";

/**
 * The shape the form receives on edit. This is EXACTLY the redacted record the
 * server edit page produces via `redactCtfSecrets` — the write-only secrets
 * (answer plaintext, `otp.secret`, and `effect`) are never present. Only the
 * non-secret OTP summary (`otp.digits/period/algorithm`) and the presence
 * booleans (`hasOtpSecret`, `hasEffect`) survive to drive the "already set —
 * leave blank to keep" hints (T-54-04-01).
 */
export type CtfRecord = RedactedCtfRecord;

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

/** Display labels for the challenge-type segmented control (order = PRESET_IDS). */
const PRESET_LABEL: Record<ChallengeTypePreset, string> = {
  "flat-points": "Flat points",
  "first-blood-race": "First-blood race",
  "timed-drop": "Timed drop",
  "easter-egg": "Easter egg",
  custom: "Custom",
};

type AnswerType = "static" | "otp" | "wordlist";

// Weekday chip labels (index = getDay, 0=Sun … 6=Sat) are imported from
// ctf-score-window — the shared source of truth the predicate also uses (IN-02).

/**
 * Create/edit form for a CTF challenge (design "A" — Slice 1b). NOTE: the live
 * resolver forwards /ctf/<challenge>/<value> verbatim and never reads this row —
 * these records are data-prep for the Phase-44 judge. Challenge names are
 * lowercase-normalized server-side. The answer + OTP secret + effect are HASHED
 * / stored on the server (ctf_upsert → ctfAttributes); the client never hashes
 * and never prefills a secret on edit — a blank field keeps the stored value.
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
  const hasOtpSecret = Boolean(initial?.hasOtpSecret);

  const [challenge, setChallenge] = useState(initial?.challenge ?? "");

  // Segmented selections. In edit mode, recover them from the loaded record.
  const [challengeType, setChallengeType] = useState<ChallengeTypePreset>(
    initial ? inferChallengeType(initial) : "custom"
  );
  const [answerType, setAnswerType] = useState<AnswerType>(
    initial ? inferAnswerType(initial) : "static"
  );

  // Never prefill the answer/OTP secret on edit — the row carries no plaintext.
  const [answer, setAnswer] = useState("");
  const [otpSecret, setOtpSecret] = useState("");
  // Wordlist one-time codes (Slice 3, CTFT-14). WRITE-ONLY + add-only: NEVER
  // prefilled on edit (only hashes exist server-side — the plaintext is
  // unreadable). On save the non-blank lines are posted as `codes` for the server
  // to hash + de-dup; the pool status shows via the read-only count line below.
  const [codesText, setCodesText] = useState("");

  // ── Advanced scoring knobs (presets pre-fill these; drawer UI in Task 3) ──
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
  // Effect is write-only: never prefilled on edit (the redacted record carries no
  // `effect`; `hasEffect` only drives the keep-hint). Blank on save keeps stored.
  const [effectText, setEffectText] = useState("");

  // ── Scoring window & limits (Section 4) ──
  const [perPlayerIntervalHours, setPerPlayerIntervalHours] = useState(
    initial?.perPlayerIntervalHours !== undefined
      ? String(initial.perPlayerIntervalHours)
      : ""
  );
  const [perPlayerMax, setPerPlayerMax] = useState(
    initial?.perPlayerMax !== undefined ? String(initial.perPlayerMax) : ""
  );
  const [globalMax, setGlobalMax] = useState(
    initial?.globalMax !== undefined ? String(initial.globalMax) : ""
  );

  // ── Day/time/tz scoring window (Section 4, CTFT-11) ──
  // Rehydrate the picker from the loaded record via the pure 55-01 bridge: an
  // existing flag restores enabled + days + times + PT/ET/UTC label; a new flag
  // starts disabled ("Scorable any time."). The stored value is the IANA id — the
  // label↔IANA mapping lives ONLY in the bridge helpers (single source of truth).
  const swInit = scoreWindowToFormState(initial?.scoreWindow);
  const [windowEnabled, setWindowEnabled] = useState(swInit.enabled);
  const [windowDays, setWindowDays] = useState<number[]>(swInit.days);
  const [windowFrom, setWindowFrom] = useState(swInit.from);
  const [windowTo, setWindowTo] = useState(swInit.to);
  const [windowTzLabel, setWindowTzLabel] = useState(swInit.tzLabel);
  // WR-02: preserve the raw stored IANA id so a zone outside PT/ET/UTC round-trips
  // unchanged instead of being silently rewritten to UTC on the first admin save.
  const [windowTz, setWindowTz] = useState<string | undefined>(swInit.tz);

  // ── Unlock & chaining (Section 5) ──
  const [unlockAfter, setUnlockAfter] = useState(initial?.unlockAfter ?? "");

  // ── Static Reward → OTP enrollment (Section 3a) ──
  // The reward otpauth is write-only, exactly like the raw effect: never
  // prefilled on edit; blank on save keeps the stored effect (no-clobber).
  const [rewardEnabled, setRewardEnabled] = useState(false);
  const [rewardOtpauth, setRewardOtpauth] = useState("");
  const [rewardNextFlag, setRewardNextFlag] = useState("");
  const [revealPreview, setRevealPreview] = useState(false);

  // Advanced drawer: collapsed by default; opened on edit when the record did not
  // round-trip to a clean preset (the admin hand-tuned the knobs).
  const [advancedOpen, setAdvancedOpen] = useState(
    Boolean(initial) && inferChallengeType(initial!) === "custom"
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

  /**
   * Pick a challenge-type preset: record the selection AND pre-fill the Advanced
   * scoring knobs from the pure `presetToAdvanced` map. The knobs stay fully
   * editable afterward — a preset never locks them (T-54-04-02). `custom` is a
   * no-op that leaves the admin's manual knobs untouched.
   */
  function applyPreset(id: ChallengeTypePreset) {
    setChallengeType(id);
    const knobs = presetToAdvanced(id);
    if (knobs.pointMax !== undefined) setPointMax(String(knobs.pointMax));
    if (knobs.pointFloor !== undefined) setPointFloor(String(knobs.pointFloor));
    if (knobs.maxSolves !== undefined) setMaxSolves(String(knobs.maxSolves));
    if (knobs.firstBloodBonus !== undefined) setFirstBloodBonus(String(knobs.firstBloodBonus));
    if (knobs.maxAttempts !== undefined) setMaxAttempts(String(knobs.maxAttempts));
    if (knobs.rateLimitWindow !== undefined) setRateLimitWindow(String(knobs.rateLimitWindow));
  }

  /** Toggle a weekday (0=Sun..6=Sat) in the scoring-window day set. */
  function toggleWindowDay(day: number) {
    setWindowDays((ds) =>
      ds.includes(day) ? ds.filter((d) => d !== day) : [...ds, day].sort((a, b) => a - b)
    );
  }

  /**
   * "DEF CON run hours" quick set: fill the picker from `DEFCON_RUN_HOURS`
   * (Thu–Sun 06:00–08:00 America/Los_Angeles). Presets PRE-FILL only — every field
   * stays individually editable afterward (never locks), mirroring `applyPreset`.
   * Maps the constant's IANA tz back to its PT/ET/UTC label via the pure bridge.
   */
  function applyDefconRunHours() {
    const s = scoreWindowToFormState(DEFCON_RUN_HOURS);
    setWindowEnabled(true);
    setWindowDays(s.days);
    setWindowFrom(s.from);
    setWindowTo(s.to);
    setWindowTzLabel(s.tzLabel);
    setWindowTz(s.tz);
  }

  const rewardActive =
    answerType === "static" && rewardEnabled && rewardOtpauth.trim() !== "";

  async function onSave() {
    setError(null);
    let effect: unknown = undefined;
    if (rewardActive) {
      // Compose the otp-enroll reward payload from the write-only otpauth. This
      // takes precedence over the raw Effect JSON when a reward is configured.
      const rewardEffect = {
        kind: "otp-enroll",
        otpauth: rewardOtpauth.trim(),
        ...(rewardNextFlag.trim() !== "" ? { nextFlag: rewardNextFlag.trim() } : {}),
      };
      // WR-01: validate the reward otpauth BEFORE save. Without this a malformed
      // URL persists silently and the player's reward card never renders (the
      // downstream `asOtpEnrollEffect` gate drops it), with no admin feedback.
      if (asOtpEnrollEffect(rewardEffect) === null) {
        setError("Reward otpauth:// is not a valid enrollment URL.");
        return;
      }
      effect = rewardEffect;
    } else if (effectText.trim() !== "") {
      try {
        effect = JSON.parse(effectText);
      } catch {
        setError("Effect must be valid JSON (or empty).");
        return;
      }
    }

    // CR-01: parse the Rotating-OTP answer's otpauth:// URL into { secret, digits,
    // period } so the judge's base32Decode gets a decodable base32 secret. Sending
    // the raw otpauth URL made every OTP-answer flag unsolvable. Reject unparseable
    // input rather than persist an unsolvable flag. Blank on edit keeps the stored
    // secret (no-clobber, T-54-04-03).
    const otpSecretTrimmed = otpSecret.trim();
    let otpField: OtpAnswerField | undefined;
    if (answerType === "otp" && otpSecretTrimmed !== "") {
      try {
        otpField = buildOtpAnswerField(otpSecretTrimmed);
      } catch {
        setError("OTP secret must be a valid otpauth:// URL (otpauth://totp/...).");
        return;
      }
    }

    // Day/time/tz scoring window (CTFT-11): the pure bridge resolves the PT/ET/UTC
    // label to its IANA id, or returns undefined when the toggle is off.
    const scoreWindow = formStateToScoreWindow({
      enabled: windowEnabled,
      days: windowDays,
      from: windowFrom,
      to: windowTo,
      tzLabel: windowTzLabel,
      tz: windowTz,
    });
    // WR-01: block a degenerate / never-scoring window with inline feedback BEFORE
    // the POST. The judge is fail-closed, so a window with no days, malformed times,
    // or close <= open would silently never score — reject it here (the server
    // re-validates at the write boundary as the authoritative backstop).
    if (scoreWindow) {
      const swErr = validateScoreWindow(scoreWindow);
      if (swErr) {
        setError(swErr);
        return;
      }
    }
    // CR-01: when editing an existing flag that HAS a stored window and the admin
    // turns the toggle OFF, send an explicit `null` sentinel so the server CLEARS
    // the stored window (attribute remove). Omitting the key is no-clobber — the
    // old window would survive and keep gating the flag while the UI says "Scorable
    // any time." A brand-new flag with no stored window just omits the key.
    const clearWindow = isEdit && !windowEnabled && Boolean(initial?.scoreWindow);

    setBusy(true);
    try {
      const timeTiers = tiers
        .filter((t) => (t.from ?? "").trim() !== "" || (t.to ?? "").trim() !== "")
        .map((t) => ({ from: t.from, to: t.to, ceiling: numOrUndef(t.ceiling ?? "") }));
      // Wordlist (Slice 3, CTFT-14): split the textarea into one code per line and
      // post them as `codes` for the SERVER to hash + de-dup + append add-only (the
      // client never hashes). A wordlist flag has no single static `answer`, so the
      // Static answer field is left out of this branch entirely. An empty paste
      // omits `codes` (a no-op edit that just keeps the existing pool).
      const codes =
        answerType === "wordlist"
          ? codesText.split("\n").map((l) => l.trim()).filter((l) => l !== "")
          : [];
      const ctf = {
        challenge,
        // Send plaintext answer; the server hashes it (the client never hashes). A
        // blank field on edit keeps the existing answerHash. Omitted for wordlist —
        // a wordlist flag's answers live in the CtfCode pool, not a single answer.
        ...(answerType !== "wordlist" ? { answer } : {}),
        answerType,
        // Only send the OTP secret when the admin typed a new one — blank keeps
        // the stored secret (no-clobber, T-54-04-03).
        ...(otpField ? { otp: otpField } : {}),
        // Wordlist codes — server-hashed, add-only. Only sent when non-empty.
        ...(codes.length ? { codes } : {}),
        pointMax: numOrUndef(pointMax),
        pointFloor: numOrUndef(pointFloor),
        maxSolves: numOrUndef(maxSolves),
        firstBloodBonus: numOrUndef(firstBloodBonus),
        maxAttempts: numOrUndef(maxAttempts),
        rateLimitWindow: numOrUndef(rateLimitWindow),
        perPlayerIntervalHours: numOrUndef(perPlayerIntervalHours),
        perPlayerMax: numOrUndef(perPlayerMax),
        globalMax: numOrUndef(globalMax),
        ...(unlockAfter.trim() !== "" ? { unlockAfter: unlockAfter.trim() } : {}),
        enabled,
        ...(timeTiers.length ? { timeTiers } : {}),
        ...(scoreWindow ? { scoreWindow } : clearWindow ? { scoreWindow: null } : {}),
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

  const otpSummary = initial?.otp;

  return (
    <div className={cls.root}>
      {error ? (
        <div className="rounded-lg border border-danger text-danger bg-danger/10 px-3.5 py-2.5 text-sm">
          {error}
        </div>
      ) : null}

      {/* ── Section 1 — Name ─────────────────────────────────────────────── */}
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

      {/* ── Section 2 — Challenge type (presets) ─────────────────────────── */}
      <div className={cls.cardPad}>
        <label className={cls.label}>Challenge type</label>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Challenge type">
          {PRESET_IDS.map((id) => {
            const active = challengeType === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                className={`${cls.segment} ${active ? cls.segmentActive : cls.segmentIdle}`}
                onClick={() => applyPreset(id)}
              >
                {PRESET_LABEL[id]}
              </button>
            );
          })}
        </div>
        <p className="text-[12.5px] text-default-500 mt-2">
          Presets pre-fill the Advanced scoring knobs below. You can still edit every
          knob after picking one.
        </p>
      </div>

      {/* ── Section 3 — Answer type ──────────────────────────────────────── */}
      <div className={cls.cardPad}>
        <label className={cls.label}>Answer type</label>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Answer type">
          {(
            [
              ["static", "Static"],
              ["otp", "Rotating OTP"],
              ["wordlist", "Wordlist"],
            ] as Array<[AnswerType, string]>
          ).map(([id, lbl]) => {
            const active = answerType === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                className={`${cls.segment} ${active ? cls.segmentActive : cls.segmentIdle}`}
                onClick={() => setAnswerType(id)}
              >
                {lbl}
              </button>
            );
          })}
        </div>

        {answerType === "static" ? (
          /* Section 3a — Static */
          <div className="mt-3.5">
            <label className={cls.label}>Answer</label>
            <input
              className={cls.input}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder={isEdit && hasStoredAnswer ? "•••••• (leave blank to keep)" : ""}
            />
            <p className="text-[12.5px] text-default-500 mt-2">
              {isEdit && hasStoredAnswer
                ? "An answer is already set (stored hashed). Leave blank to keep it; type a new answer only to replace it."
                : "Hashed on save — the plaintext answer is never stored."}
            </p>

            {/* Reward → OTP enrollment (Static only) */}
            <div className="mt-3.5 rounded-lg border border-divider bg-content2 p-3">
              <label className="flex gap-2 items-center text-sm">
                <input
                  type="checkbox"
                  checked={rewardEnabled}
                  onChange={(e) => {
                    setRewardEnabled(e.target.checked);
                    if (!e.target.checked) setRevealPreview(false);
                  }}
                />
                <span className={rewardEnabled ? "text-primary font-semibold" : ""}>
                  Reward on solve → OTP enrollment
                </span>
              </label>
              <p className="text-[12.5px] text-default-500 mt-2">
                On solve, hand the runner a QR + rolling code to add to their
                authenticator. Paste the same otpauth:// secret you set on the chained
                Rotating-OTP flag.
              </p>

              {rewardEnabled ? (
                <div className="mt-3 flex flex-col gap-2.5">
                  <div>
                    <label className={cls.label}>Reward otpauth://</label>
                    <input
                      className={cls.input}
                      value={rewardOtpauth}
                      onChange={(e) => setRewardOtpauth(e.target.value)}
                      placeholder={
                        isEdit && initial?.hasEffect
                          ? "•••••• (set — leave blank to keep)"
                          : "otpauth://totp/..."
                      }
                    />
                  </div>
                  <div>
                    <label className={cls.label}>Unlocks flag (optional)</label>
                    <input
                      className={cls.input}
                      value={rewardNextFlag}
                      onChange={(e) => setRewardNextFlag(e.target.value)}
                      placeholder="chained-otp-flag-name"
                    />
                  </div>
                  <div>
                    <button
                      type="button"
                      className={cls.btn}
                      disabled={rewardOtpauth.trim() === ""}
                      onClick={() => setRevealPreview((v) => !v)}
                    >
                      {revealPreview ? "Hide preview" : "Reveal preview"}
                    </button>
                  </div>
                  {revealPreview && rewardOtpauth.trim() !== "" ? (
                    <div className={`${cls.rewardCard} flex justify-center`}>
                      {/* Exactly what the solver sees — reuses the 54-03 renderer. */}
                      <CtfOtpEnroll
                        otpauth={rewardOtpauth.trim()}
                        nextFlag={rewardNextFlag.trim() || undefined}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : answerType === "otp" ? (
          /* Section 3b — Rotating OTP */
          <div className="mt-3.5">
            <label className={cls.label}>OTP secret (otpauth://)</label>
            <input
              className={cls.input}
              value={otpSecret}
              onChange={(e) => setOtpSecret(e.target.value)}
              placeholder={
                isEdit && hasOtpSecret
                  ? "•••••• (set — leave blank to keep)"
                  : "otpauth://totp/..."
              }
            />
            {otpSummary &&
            (otpSummary.digits !== undefined ||
              otpSummary.period !== undefined ||
              otpSummary.algorithm !== undefined) ? (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {otpSummary.digits !== undefined ? (
                  <span className={cls.chip}>{otpSummary.digits} digits</span>
                ) : null}
                {otpSummary.period !== undefined ? (
                  <span className={cls.chip}>{otpSummary.period}s period</span>
                ) : null}
                {otpSummary.algorithm !== undefined ? (
                  <span className={cls.chip}>{otpSummary.algorithm}</span>
                ) : null}
              </div>
            ) : null}
            <p className="text-[12.5px] text-default-500 mt-2">
              The runner submits the current 6-digit code from their authenticator. The
              shared secret is stored so the judge can verify it, and is never shown
              again after you save.
            </p>
          </div>
        ) : (
          /* Section 3c — Wordlist (a pool of single-use codes, consumed first-come) */
          <div className="mt-3.5">
            <p className="text-[12.5px] text-default-500 mb-2.5">
              A pool of single-use codes, consumed first-come.
            </p>
            <label className={cls.label}>One-time codes</label>
            <textarea
              className={cls.textarea}
              value={codesText}
              onChange={(e) => setCodesText(e.target.value)}
              placeholder={"code-one\ncode-two\ncode-three"}
            />
            <p className="text-[12.5px] text-default-500 mt-2">
              One code per line. Each code can be claimed once, first-come. Codes are
              hashed on save — they are never stored or shown in plaintext.
            </p>
            {/* Read-only pool status (edit only) — aggregate counts, never a code.
                On create there is no pool yet, so show the empty-state hint. */}
            {initial?.codeCounts ? (
              <p className="text-[13px] text-default-500 mt-2.5">
                <span className="font-semibold text-foreground">
                  {initial.codeCounts.loaded}
                </span>{" "}
                codes loaded ·{" "}
                <span className="font-semibold text-foreground">
                  {initial.codeCounts.unclaimed}
                </span>{" "}
                unclaimed.
              </p>
            ) : (
              <p className="text-[12.5px] text-default-400 mt-2.5 italic">
                Paste codes above — they&apos;ll be hashed and added when you save.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Section 4 — Scoring window & limits ──────────────────────────── */}
      <div className={cls.cardPad}>
        <label className={cls.label}>Scoring window &amp; limits</label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div>
            <label className={cls.label}>Interval (hours)</label>
            <input
              className={cls.input}
              inputMode="numeric"
              value={perPlayerIntervalHours}
              onChange={(e) => setPerPlayerIntervalHours(e.target.value)}
            />
            <p className="text-[12.5px] text-default-500 mt-1.5">
              Min hours between a player&apos;s scoring solves
            </p>
          </div>
          <div>
            <label className={cls.label}>Per-player max</label>
            <input
              className={cls.input}
              inputMode="numeric"
              value={perPlayerMax}
              onChange={(e) => setPerPlayerMax(e.target.value)}
            />
            <p className="text-[12.5px] text-default-500 mt-1.5">
              Max scoring solves per player
            </p>
          </div>
          <div>
            <label className={cls.label}>Global max</label>
            <input
              className={cls.input}
              inputMode="numeric"
              value={globalMax}
              onChange={(e) => setGlobalMax(e.target.value)}
            />
            <p className="text-[12.5px] text-default-500 mt-1.5">
              Hard global cutoff — flag stops scoring for everyone after this many
              solves. Blank / 0 = unlimited. (Different from Max solves, which is the
              scoring-curve denominator.)
            </p>
          </div>
        </div>

        <p className="text-[12.5px] text-default-500 mt-3">
          This flag awards points once per scoring window. Repeatable flags (Rotating
          OTP, or per-player max &gt; 1) score again after the interval; one-award flags
          score once ever.
        </p>

        {/* Day/time/tz scoring window (CTFT-11). Off ⇒ no scoreWindow persisted
            (always-open). A closed window is enforced SILENTLY in the judge — there
            is deliberately no player-facing "come back later" surface. */}
        <div className="mt-3.5 rounded-lg border border-divider bg-content2 p-3">
          <label className="flex gap-2 items-center text-sm">
            <input
              type="checkbox"
              checked={windowEnabled}
              onChange={(e) => setWindowEnabled(e.target.checked)}
            />
            <span className={windowEnabled ? "text-primary font-semibold" : ""}>
              Restrict scoring to a time window
            </span>
          </label>
          <p className="text-[12.5px] text-default-500 mt-2">
            Only credit solves during this window. Outside it, a correct answer silently
            doesn&apos;t score — players can&apos;t tell the window is closed.
          </p>

          {windowEnabled ? (
            <div className="mt-3 flex flex-col gap-3.5">
              {/* Quick set — DEF CON run hours (accent, presets stay editable) */}
              <div>
                <button
                  type="button"
                  className={cls.btnPrimary}
                  onClick={applyDefconRunHours}
                >
                  DEF CON run hours
                </button>
                <p className="text-[12.5px] text-default-500 mt-1.5">Thu–Sun, 6–8 AM PT</p>
              </div>

              {/* Weekday multi-select (0=Sun..6=Sat) */}
              <div>
                <label className={cls.label}>Days</label>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Scoring days">
                  {WEEKDAY_LABELS.map((lbl, day) => {
                    const active = windowDays.includes(day);
                    return (
                      <button
                        key={lbl}
                        type="button"
                        role="switch"
                        aria-checked={active}
                        aria-label={lbl}
                        className={`${cls.segment} ${active ? cls.segmentActive : cls.segmentIdle}`}
                        onClick={() => toggleWindowDay(day)}
                      >
                        {lbl}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Opens / Closes wall-clock times + timezone */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className={cls.label} htmlFor="sw-opens">
                    Opens
                  </label>
                  <input
                    id="sw-opens"
                    type="time"
                    className={cls.input}
                    value={windowFrom}
                    onChange={(e) => setWindowFrom(e.target.value)}
                  />
                </div>
                <div>
                  <label className={cls.label} htmlFor="sw-closes">
                    Closes
                  </label>
                  <input
                    id="sw-closes"
                    type="time"
                    className={cls.input}
                    value={windowTo}
                    onChange={(e) => setWindowTo(e.target.value)}
                  />
                </div>
                <div>
                  <label className={cls.label} htmlFor="sw-tz">
                    Timezone
                  </label>
                  <select
                    id="sw-tz"
                    className={cls.select}
                    value={windowTzLabel}
                    onChange={(e) => setWindowTzLabel(e.target.value)}
                  >
                    {/* WR-02: a stored zone outside PT/ET/UTC keeps an empty label —
                        surface it as a transient option so the operator SEES the
                        preserved zone (and can consciously switch) instead of it
                        silently coercing to UTC. */}
                    {windowTzLabel === "" && windowTz ? (
                      <option value="">{windowTz} (stored)</option>
                    ) : null}
                    {TZ_OPTIONS.map((o) => (
                      <option key={o.label} value={o.label}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="text-[12.5px] text-default-500 -mt-1">
                Times use this timezone; daylight saving is handled automatically.
              </p>
            </div>
          ) : (
            <p className="text-[12.5px] text-default-500 mt-2 italic">Scorable any time.</p>
          )}
        </div>
      </div>

      {/* ── Section 5 — Unlock & chaining ────────────────────────────────── */}
      <div className={cls.cardPad}>
        <label className={cls.label}>Unlock &amp; chaining</label>
        <label className={cls.label}>Hidden until flag</label>
        <input
          className={cls.input}
          value={unlockAfter}
          onChange={(e) => setUnlockAfter(e.target.value)}
          placeholder="another-flag-name"
        />
        <p className="text-[12.5px] text-default-500 mt-2">
          This flag stays hidden and non-scoring until the player has scored the named
          flag. Renaming that flag breaks the chain — update both together.
        </p>
      </div>

      {/* ── Section 6 — Advanced (always editable, collapsible) ──────────── */}
      <div className={cls.card}>
        <button
          type="button"
          className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left"
          onClick={() => setAdvancedOpen((v) => !v)}
          aria-expanded={advancedOpen}
        >
          <span>
            <span className={cls.h2}>Advanced</span>
            <span className="block text-[12.5px] text-default-500 mt-0.5">
              Raw scoring curve, tiers, anti-spam, and effect JSON. Presets pre-fill
              these; edit freely.
            </span>
          </span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 transition-transform ${
              advancedOpen ? "rotate-180" : ""
            }`}
          />
        </button>
        {advancedOpen ? (
          <div className="bg-content2 border-t border-divider p-4 flex flex-col gap-4">
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
        <p className="text-[12.5px] text-default-500 mt-2.5">
          Most a solve is worth while this window is active — replaces Point max.
        </p>
      </div>

      <div className={cls.cardPad}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
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
            <p className="text-[12.5px] text-default-500 mt-1.5">
              N wrong guesses per X seconds — not a solve limit.
            </p>
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
          placeholder={
            isEdit && initial?.hasEffect
              ? "leave blank to keep the configured effect"
              : '{ "kind": "confetti", "intensity": 11 }'
          }
        />
        {isEdit && initial?.hasEffect ? (
          <p className="text-[12.5px] text-default-500 mt-2">
            An effect is already configured. Leave blank to keep it; paste new JSON only
            to replace it.
          </p>
        ) : null}
      </div>
          </div>
        ) : null}
      </div>

      {/* ── Section 7 — Live scoring preview ─────────────────────────────── */}
      <div className={cls.cardPad}>
        <label className={cls.label}>Live scoring preview</label>
        <p className="text-[12.5px] text-default-500 mb-3">
          Mirrors the judge&apos;s computePoints for the current form values.
        </p>
        {windowEnabled ? (
          <div className="mb-3 inline-flex items-center gap-1.5">
            <span className={cls.chip}>window-gated</span>
            <span className="text-[12px] text-default-500">
              scores only inside the set window — the point value is unchanged
            </span>
          </div>
        ) : null}
        {(() => {
          const previewConfig = {
            pointMax,
            pointFloor,
            maxSolves,
            firstBloodBonus,
            timeTiers: tiers.map((t) => ({
              from: t.from,
              to: t.to,
              ceiling: t.ceiling,
            })),
          };
          const nMax = numOrUndef(maxSolves) ?? 1;
          const firstSolve = previewPoints(previewConfig, 1);
          const lastSolve = previewPoints(previewConfig, Math.max(nMax, 1));
          return (
            <div className="flex flex-wrap gap-6">
              <div>
                <span className={cls.label}>First solve (n=1)</span>
                <span className="block font-mono text-[28px] font-semibold tracking-wide text-primary">
                  {firstSolve}
                </span>
              </div>
              {nMax > 1 ? (
                <div>
                  <span className={cls.label}>Last solve (n={nMax})</span>
                  <span className="block font-mono text-[28px] font-semibold tracking-wide text-primary">
                    {lastSolve}
                  </span>
                </div>
              ) : null}
            </div>
          );
        })()}
      </div>

      {/* ── Actions ──────────────────────────────────────────────────────── */}
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
