/**
 * ctf-form-model — the pure, client-safe LOGIC seam the redesigned `CtfForm`
 * (Plan 54-04) and the server edit page bind to. NO "use client" directive: this
 * module is imported from BOTH the client form and the server edit page, so it
 * must stay React-free, I/O-free, and node-free.
 *
 * It contains four obligations, each proven at the pure-function level (this repo
 * has no jsdom/testing-library, so component DOM tests are unavailable):
 *   1. presetToAdvanced — challenge-type preset → concrete Advanced scoring knobs.
 *   2. previewPoints     — a thin adapter that DELEGATES to the judge's real
 *                          `computePoints` so the live preview === the judge for
 *                          identical inputs (parity, never a re-implementation).
 *   3. inferAnswerType / inferChallengeType — edit-mode recovery of the segmented
 *                          selections from a stored record.
 *   4. redactCtfSecrets  — the write-only-secret boundary (see below).
 *
 * IMPORT RULE (guarded by a grep in the plan's acceptance criteria): import
 * `computePoints` ONLY from `@/lib/ctf-scoring` — the pure, client-safe scorer.
 * NEVER import from the judge module, which pulls the ElectroDB client and would
 * poison the client bundle.
 */

import { computePoints, type ScoringConfig, type TimeTier } from "@/lib/ctf-scoring";
import { parseOtpauth } from "@/lib/ctf-otp-core";
import { TZ_OPTIONS, type ScoreWindow } from "@/lib/ctf-score-window";

// ---------------------------------------------------------------------------
// Rotating-OTP answer field (CR-01)
// ---------------------------------------------------------------------------

/** The OTP answer payload the server stores — the base32 secret + its params. */
export interface OtpAnswerField {
  secret: string;
  digits: number;
  period: number;
}

/**
 * Parse the admin-entered `otpauth://totp/...` URL for a Rotating-OTP answer into
 * the payload the server persists: the extracted base32 `secret` plus `digits`
 * and `period`.
 *
 * WHY (CR-01): the Rotating-OTP field asks the admin to paste a full `otpauth://`
 * URL, but the judge runs `base32Decode(otp.secret)` on whatever is stored — an
 * `otpauth://` string contains `:` and `/`, which base32Decode rejects, so a flag
 * saved with the raw URL could NEVER be solved. Parsing here extracts the same
 * base32 secret the reward side (`asOtpEnrollEffect` / `CtfOtpEnroll`) enrolls, so
 * a seed pasted as the OTP answer decodes to the same secret the reward hands out.
 * It also preserves the URL's digits/period instead of silently defaulting them.
 *
 * Throws on non-otpauth or otherwise unparseable input (via `parseOtpauth`) so the
 * form can surface an inline error rather than persist an unsolvable flag.
 */
export function buildOtpAnswerField(input: string): OtpAnswerField {
  const cfg = parseOtpauth(input);
  return { secret: cfg.secret, digits: cfg.digits, period: cfg.period };
}

// ---------------------------------------------------------------------------
// Challenge-type presets
// ---------------------------------------------------------------------------

/**
 * The five challenge-type preset ids. A single source of truth so the form's
 * segmented control and the tests iterate the SAME list (no drift). `custom` is
 * the no-op preset that never overwrites the admin's manual knobs.
 */
export const PRESET_IDS = [
  "flat-points",
  "first-blood-race",
  "timed-drop",
  "easter-egg",
  "custom",
] as const;

export type ChallengeTypePreset = (typeof PRESET_IDS)[number];

/**
 * The numeric scoring subset a preset pre-fills. All optional so a preset can set
 * only the knobs it cares about; the form spreads the partial over its current
 * state, leaving unset knobs untouched.
 */
export interface AdvancedKnobs {
  pointMax: number;
  pointFloor: number;
  maxSolves: number;
  firstBloodBonus: number;
  maxAttempts: number;
  rateLimitWindow: number;
  timeTiers: TimeTier[];
}

/**
 * Map a challenge-type preset to a concrete partial of Advanced scoring knobs.
 * The values embody the UI-SPEC preset semantics (Claude's discretion within the
 * design's intent — documented inline):
 *
 *  - flat-points      → a near-flat curve (pointMax ≈ pointFloor, low decline),
 *                       high solve cap, no first-blood bonus. Everyone earns
 *                       roughly the same.
 *  - first-blood-race → a steep curve with a LARGE first-blood bonus so the race
 *                       to be first dominates the reward.
 *  - timed-drop       → a tall ceiling that declines fast over few solves (the
 *                       "drops" the earlier you solve within the window). Pairs
 *                       naturally with an admin-set time tier.
 *  - easter-egg       → a small fixed single-award (maxSolves 1, pointMax ==
 *                       pointFloor), no bonus.
 *  - custom           → {} no-op: NEVER overwrites the admin's manual knobs.
 *
 * The four non-custom presets are intentionally distinct in their
 * (pointMax, pointFloor, maxSolves, firstBloodBonus) tuples so `inferChallengeType`
 * can round-trip a stored record back to its preset unambiguously.
 */
export function presetToAdvanced(preset: ChallengeTypePreset): Partial<AdvancedKnobs> {
  switch (preset) {
    case "flat-points":
      return { pointMax: 500, pointFloor: 450, maxSolves: 100, firstBloodBonus: 0 };
    case "first-blood-race":
      return { pointMax: 500, pointFloor: 100, maxSolves: 10, firstBloodBonus: 1000 };
    case "timed-drop":
      return { pointMax: 1000, pointFloor: 100, maxSolves: 20, firstBloodBonus: 0 };
    case "easter-egg":
      return { pointMax: 100, pointFloor: 100, maxSolves: 1, firstBloodBonus: 0 };
    case "custom":
    default:
      return {};
  }
}

// ---------------------------------------------------------------------------
// Live scoring preview — parity with the judge
// ---------------------------------------------------------------------------

/**
 * Coerce a form field (which may be a numeric string, a number, blank, or
 * undefined) to a finite number, mirroring the form's `numOrUndef`. Blank / NaN
 * ⇒ undefined, which the ScoringConfig mapping treats as 0.
 */
function toNum(v: number | string | undefined | null): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  const t = v.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * The scoring shape the form holds — numeric fields may still be strings while
 * the admin is typing. `previewPoints` coerces them at the boundary.
 */
export interface PreviewConfig {
  pointMax?: number | string;
  pointFloor?: number | string;
  maxSolves?: number | string;
  firstBloodBonus?: number | string;
  timeTiers?: Array<{ from?: string; to?: string; ceiling?: number | string }>;
}

/**
 * Points the n-th solver would earn for the CURRENT form values. A THIN adapter:
 * it maps the form's may-be-string fields to a numeric `ScoringConfig` and then
 * calls the judge's real `computePoints`. It does NOT re-derive the curve, so
 * `previewPoints(config, n, now) === computePoints(n, config, now)` for identical
 * inputs — parity is structural, not coincidental (guards T-54-01-02).
 */
export function previewPoints(
  config: PreviewConfig,
  n: number,
  now?: Date | number,
): number {
  const scoring: ScoringConfig = {
    pointMax: toNum(config.pointMax) ?? 0,
    pointFloor: toNum(config.pointFloor) ?? 0,
    maxSolves: toNum(config.maxSolves) ?? 0,
    firstBloodBonus: toNum(config.firstBloodBonus) ?? 0,
    ...(config.timeTiers
      ? {
          timeTiers: config.timeTiers.map((t) => ({
            from: t.from ?? "",
            to: t.to ?? "",
            ceiling: toNum(t.ceiling) ?? 0,
          })),
        }
      : {}),
  };
  return computePoints(n, scoring, now);
}

// ---------------------------------------------------------------------------
// Edit-mode inference
// ---------------------------------------------------------------------------

/**
 * The subset of a loaded record the inference helpers read. Intentionally loose
 * (all optional) so both the raw Ctf row and a redacted record satisfy it.
 */
export interface InferSource {
  answerType?: string;
  pointMax?: number;
  pointFloor?: number;
  maxSolves?: number;
  firstBloodBonus?: number;
}

/**
 * Recover the answer-type segment from a stored record. `otp` / `wordlist` iff the
 * record explicitly stores that value; everything else (including absent or an
 * unknown value) ⇒ `static`, matching the backend's narrowCtf default.
 */
export function inferAnswerType(record: InferSource): "static" | "otp" | "wordlist" {
  if (record.answerType === "otp") return "otp";
  if (record.answerType === "wordlist") return "wordlist";
  return "static";
}

/**
 * Recover the challenge-type segment from a stored record: return the preset
 * whose `presetToAdvanced` output matches the record's stored scoring tuple,
 * else `custom` when nothing matches (the admin hand-tuned the knobs).
 */
export function inferChallengeType(record: InferSource): ChallengeTypePreset {
  for (const id of PRESET_IDS) {
    if (id === "custom") continue;
    const knobs = presetToAdvanced(id);
    if (
      knobs.pointMax === record.pointMax &&
      knobs.pointFloor === record.pointFloor &&
      knobs.maxSolves === record.maxSolves &&
      knobs.firstBloodBonus === record.firstBloodBonus
    ) {
      return id;
    }
  }
  return "custom";
}

// ---------------------------------------------------------------------------
// Scoring-window form-state bridge (Slice 2, CTFT-09/11)
// ---------------------------------------------------------------------------
//
// The picker's local state uses a PT/ET/UTC LABEL (what the admin sees); the row
// persists the IANA `tz` id. These two pure helpers are the ONLY place that maps
// between them, via the shared `TZ_OPTIONS` source of truth — so save (label→IANA)
// and edit-mode rehydrate (IANA→label) can never drift. `ctf-score-window` gives us
// only the type + the constant list — no judge, no electro — keeping this module
// client-safe.

/** The picker's local state: a toggle, the day set, wall-clock bounds, and a label. */
export interface ScoreWindowFormState {
  enabled: boolean;
  days: number[];
  from: string;
  to: string;
  /**
   * A PT/ET/UTC label from TZ_OPTIONS (NOT the IANA id — that is derived on save).
   * Empty string `""` when the stored zone is OUTSIDE the three options (WR-02) —
   * the raw id is then carried on `tz` and round-tripped unchanged.
   */
  tzLabel: string;
  /**
   * The raw stored IANA id (WR-02). Preserved so a seeded/imported zone outside
   * PT/ET/UTC survives an edit losslessly instead of being silently rewritten to
   * UTC. On save it is used ONLY when `tzLabel` does not resolve to a known option.
   */
  tz?: string;
}

/**
 * Form state → the `ScoreWindow` the row persists, or `undefined` when the toggle
 * is off. Off ⇒ nothing persisted (matching the UI-SPEC's "toggling off clears the
 * payload"), which the judge reads as always-open. On ⇒ resolve `tzLabel` to its
 * IANA id via `TZ_OPTIONS`; when the label does not resolve to a known option
 * (WR-02: the stored zone was outside PT/ET/UTC) fall back to the carried raw
 * `state.tz` so the original zone round-trips UNCHANGED, and only then to UTC.
 */
export function formStateToScoreWindow(state: ScoreWindowFormState): ScoreWindow | undefined {
  if (!state.enabled) return undefined;
  const tz = TZ_OPTIONS.find((o) => o.label === state.tzLabel)?.tz ?? state.tz ?? "UTC";
  return { days: state.days, from: state.from, to: state.to, tz };
}

/**
 * Persisted `ScoreWindow` → the picker's form state. Absent window ⇒ the disabled
 * default (`enabled:false`, empty fields, PT label ready for a first edit). Present
 * ⇒ rehydrate enabled, mapping the stored IANA id BACK to its PT/ET/UTC label via
 * `TZ_OPTIONS`; an unknown/unmapped IANA id keeps an EMPTY label but carries the raw
 * id on `tz` (WR-02) so it round-trips losslessly instead of being coerced to UTC.
 */
export function scoreWindowToFormState(w: ScoreWindow | undefined): ScoreWindowFormState {
  if (!w) return { enabled: false, days: [], from: "", to: "", tzLabel: "PT" };
  const tzLabel = TZ_OPTIONS.find((o) => o.tz === w.tz)?.label ?? "";
  return { enabled: true, days: w.days, from: w.from, to: w.to, tzLabel, tz: w.tz };
}

// ---------------------------------------------------------------------------
// Write-only-secret boundary (SC-2 / T-54-01-01)
// ---------------------------------------------------------------------------
//
// ⚠️ SECURITY BOUNDARY. A loaded `Ctf` row (server) is about to be serialized as
// a prop to the "use client" CtfForm — everything on it crosses to the browser.
// `redactCtfSecrets` is the ONE place that strips the write-only secrets before a
// record can become a client prop, so the design's "secrets are never
// round-tripped to the client" invariant holds. It runs on the SERVER (the edit
// page) but is pure and node-free, so it lives here and is unit-tested here.
// 54-04 wires the edit page through it.

/** The raw loaded fields this boundary reads (a structural subset of the Ctf row). */
export interface LoadedCtfRecord {
  challenge: string;
  points?: number;
  pointMax?: number;
  pointFloor?: number;
  maxSolves?: number;
  firstBloodBonus?: number;
  timeTiers?: Array<{ from?: string; to?: string; ceiling?: number }>;
  maxAttempts?: number;
  rateLimitWindow?: number;
  enabled?: boolean;
  answerType?: "static" | "otp" | "wordlist";
  unlockAfter?: string;
  perPlayerIntervalHours?: number;
  perPlayerMax?: number;
  globalMax?: number;
  // Additive day/time/tz scoring window (Slice 2). Carries no secret — preserved
  // through redaction so the edit page can rehydrate the picker.
  scoreWindow?: ScoreWindow;
  // Wordlist pool status (Slice 3, CTFT-14). NON-SECRET aggregate — the loaded /
  // unclaimed counts, NEVER a plaintext code. Preserved through redaction so the
  // edit page can render the "N codes loaded · M unclaimed" line. The edit page
  // attaches it from getCtfCodeCounts; there is no plaintext code field anywhere.
  codeCounts?: { loaded: number; unclaimed: number };
  // Collectible CTF Cards board art slug (→ /ctf-cards/<slug>.(webp|svg)).
  // Non-secret — preserved through redaction so the edit form rehydrates it.
  cardImage?: string;
  // Presence-only hint driver; carries no plaintext, so it is left as-is.
  answerHash?: string;
  // ⚠️ `secret` is write-only and MUST NOT survive redaction.
  otp?: { secret?: string; digits?: number; period?: number; algorithm?: string; skew?: number };
  // ⚠️ `effect` may carry an otpauth reward payload; dropped entirely.
  effect?: unknown;
}

/** What the client form actually receives — every secret field removed. */
export interface RedactedCtfRecord {
  challenge: string;
  points?: number;
  pointMax?: number;
  pointFloor?: number;
  maxSolves?: number;
  firstBloodBonus?: number;
  timeTiers?: Array<{ from?: string; to?: string; ceiling?: number }>;
  maxAttempts?: number;
  rateLimitWindow?: number;
  enabled?: boolean;
  answerType?: "static" | "otp" | "wordlist";
  unlockAfter?: string;
  perPlayerIntervalHours?: number;
  perPlayerMax?: number;
  globalMax?: number;
  /** Day/time/tz scoring window — non-secret, preserved so the picker rehydrates. */
  scoreWindow?: ScoreWindow;
  /**
   * Wordlist pool status (Slice 3, CTFT-14) — NON-SECRET aggregate loaded/unclaimed
   * counts, never a plaintext code. Preserved through redaction so the form can
   * render the count line without any code ever crossing to the client.
   */
  codeCounts?: { loaded: number; unclaimed: number };
  /** CTF Cards board art slug — non-secret, preserved so the form rehydrates it. */
  cardImage?: string;
  answerHash?: string;
  /** OTP summary for the read-only display — NEVER the secret. */
  otp?: { digits?: number; period?: number; algorithm?: string };
  /** true iff the loaded record had a non-empty otp.secret. */
  hasOtpSecret: boolean;
  /** true iff the loaded record had a defined effect. */
  hasEffect: boolean;
}

/**
 * Return a shallow clone of `record` with every write-only secret stripped:
 *   - `otp.secret` removed (digits/period/algorithm kept for the read-only summary),
 *   - `effect` removed entirely,
 * plus two derived booleans (`hasOtpSecret`, `hasEffect`) the form uses to render
 * its "already set — leave blank to keep" hints. Non-mutating: the input object
 * is never touched. `answerHash` is preserved (it drives only the keep-hint and
 * carries no plaintext).
 */
export function redactCtfSecrets(record: LoadedCtfRecord): RedactedCtfRecord {
  const hasOtpSecret = Boolean(record.otp?.secret);
  const hasEffect = record.effect !== undefined;

  const redacted: RedactedCtfRecord = {
    challenge: record.challenge,
    points: record.points,
    pointMax: record.pointMax,
    pointFloor: record.pointFloor,
    maxSolves: record.maxSolves,
    firstBloodBonus: record.firstBloodBonus,
    timeTiers: record.timeTiers,
    maxAttempts: record.maxAttempts,
    rateLimitWindow: record.rateLimitWindow,
    enabled: record.enabled,
    answerType: record.answerType,
    unlockAfter: record.unlockAfter,
    perPlayerIntervalHours: record.perPlayerIntervalHours,
    perPlayerMax: record.perPlayerMax,
    globalMax: record.globalMax,
    // Non-secret — preserved so the edit page can rehydrate the day/time/tz picker.
    scoreWindow: record.scoreWindow,
    // Non-secret aggregate wordlist counts — carried verbatim (like scoreWindow).
    // NEVER a plaintext code; drives only the "N loaded · M unclaimed" line.
    codeCounts: record.codeCounts,
    cardImage: record.cardImage,
    answerHash: record.answerHash,
    hasOtpSecret,
    hasEffect,
  };

  // Rebuild the OTP summary from ONLY the non-secret fields — never copy `secret`.
  if (record.otp) {
    redacted.otp = {
      digits: record.otp.digits,
      period: record.otp.period,
      algorithm: record.otp.algorithm,
    };
  }

  // `effect` is intentionally never copied.
  return redacted;
}
