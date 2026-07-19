import { Qr, Ctf, Qrstat } from "@/entities/qr";
import { CtfSolve, CtfScoreEvent, CtfCode } from "@/entities/ctf";
import { hashAnswer } from "@/lib/ctf-hash";
import { QrValidationError } from "@/lib/qr-errors";
import { codeKeyCandidates } from "@/lib/qr-code-normalize";
import {
  assertAnswerTypeTransition,
  mergeFlagTypeNextState,
} from "@/lib/ctf-flag-types";
import { validateScoreWindow } from "@/lib/ctf-score-window";
import {
  buildOtpauth,
  DEFAULT_DIGITS,
  DEFAULT_PERIOD,
  DEFAULT_ALGORITHM,
} from "@/lib/ctf-otp-core";
import { compileScheduleToRules } from "@/lib/qr-schedule";

// Re-export so existing `import { QrValidationError } from "@/lib/qr-admin"`
// call sites (route.ts, tests) keep working after the extraction to qr-errors.ts.
export { QrValidationError };

/**
 * QR / CTF admin data + validation layer (run.human, Phase-4 admin CRUD).
 *
 * SERVER-ONLY: this imports the electro client (AWS creds from env). Only import
 * it from server components / route handlers — never a "use client" module — so
 * it is never bundled to the browser (repo convention; mirrors lib/admin-report.ts).
 *
 * All writes go through here so validation is enforced in ONE place: the API
 * route (src/app/api/admin/qr/route.ts) is the only caller. Pure validators
 * (normalizeCode / normalizeChallenge / validateDestination) throw
 * QrValidationError BEFORE any DynamoDB call, so the route can map them to 400s
 * and the DB never sees a bad value.
 *
 * See src/entities/qr.ts for the load-bearing casing/parity contract.
 * (QrValidationError now lives in ./qr-errors and is re-exported above.)
 */

// Short-code grammar: 1–64 chars, starts alphanumeric, then alnum/_/- .
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

// Reserved: ctf/_flush are resolver namespaces (a code there is unreachable);
// new is the admin create-route sentinel (/admin/qr/new). Compared lowercase.
const RESERVED_CODES = new Set(["ctf", "_flush", "new"]);

/**
 * Normalize + validate a QR code. Trims and LOWERCASES for a clean, canonical
 * short link (q.defcon.run/rick). Case is cosmetic for lookups: ElectroDB
 * lowercases the pk composite on both write and the resolver's read, and the
 * resolver uppercases the scanned path before Qr.get — so any case scans the
 * same code. Lowercase is just the canonical stored/display form. Throws on a
 * bad shape or a reserved name.
 */
export function normalizeCode(raw: string): string {
  const code = (raw ?? "").trim().toLowerCase();
  if (!CODE_RE.test(code)) {
    throw new QrValidationError(
      "Code must be 1–64 characters: start alphanumeric, then letters, digits, _ or -."
    );
  }
  if (RESERVED_CODES.has(code)) {
    throw new QrValidationError(`"${code}" is a reserved code.`);
  }
  return code;
}

/**
 * Normalize + validate a CTF challenge name. Trims and LOWERCASES — the
 * forward contract with the Phase-5 judge (the resolver forwards the challenge
 * verbatim; the judge must lowercase to match this). Rejects the `new` sentinel.
 */
export function normalizeChallenge(raw: string): string {
  const challenge = (raw ?? "").trim().toLowerCase();
  if (!challenge) {
    throw new QrValidationError("Challenge is required.");
  }
  if (challenge.length > 64) {
    throw new QrValidationError("Challenge must be 64 characters or fewer.");
  }
  if (challenge === "new") {
    throw new QrValidationError('"new" is a reserved challenge name.');
  }
  return challenge;
}

/**
 * A destination MUST be an absolute https:// URL. Blocks javascript:/data:/
 * http:/relative — an open-redirect off q.defcon.run is a phishing vector even
 * though only gated admins can write. Applied to `destination` AND every
 * `rules[].dest`.
 */
export function validateDestination(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new QrValidationError(
      "Destination must be an absolute URL (e.g. https://run.defcon.run/…)."
    );
  }
  if (parsed.protocol !== "https:") {
    throw new QrValidationError("Destination must use https://.");
  }
}

// ---------------------------------------------------------------------------
// Shapes (what the forms POST and the pages render)
// ---------------------------------------------------------------------------

export interface QrRuleInput {
  kind: "time" | "param";
  from?: string;
  to?: string;
  match?: string;
  dest?: string;
}

export interface QrEnrichInput {
  preserveQuery?: boolean;
  appendParam?: boolean;
  utm?: { source?: string; medium?: string; campaign?: string };
}

/**
 * One switch-point of a dynamic scheduled code: from `startsAt` (UTC ISO) the
 * code redirects to `dest` until the next switch-point. See lib/qr-schedule.ts.
 */
export interface QrScheduleEntryInput {
  startsAt: string;
  dest: string;
  label?: string;
}

export interface QrInput {
  code: string;
  type?: string;
  destination?: string;
  rules?: QrRuleInput[];
  /**
   * Dynamic scheduled code: ordered switch-points. When present and non-empty
   * this is the source of truth and OVERRIDES `rules` — the schedule is compiled
   * into time-rules on save (see qrAttributes / compileScheduleToRules).
   */
  schedule?: QrScheduleEntryInput[];
  enrich?: QrEnrichInput;
  enabled?: boolean;
  owner?: string;
  notes?: string;
  /** Opt-in social-preview theme (e.g. "cherries"); empty → plain 302. */
  unfurl?: string;
}

export interface CtfInput {
  challenge: string;
  // Plaintext answer as typed by the admin. It is HASHED on the write path (see
  // ctfAttributes) and never persisted as plaintext. `answerHash` is deliberately
  // NOT an input — the server owns hashing; the client never supplies a hash.
  answer?: string;
  points?: number;
  // Scoring curve (Phase 44, CTF-01). Passed through numeric when provided.
  pointMax?: number;
  pointFloor?: number;
  maxSolves?: number;
  firstBloodBonus?: number;
  // Active-window ceilings. Each tier { from, to, ceiling } is validated in
  // ctfAttributes (from < to, numeric ceiling) before any DB write.
  timeTiers?: Array<{ from?: string; to?: string; ceiling?: number }>;
  effect?: unknown;
  maxAttempts?: number;
  rateLimitWindow?: number;
  // Collectible "CTF Cards" board art slug (→ /ctf-cards/<slug>.(webp|svg)).
  // `undefined` (absent) = no-clobber on partial edits; explicit `null` = clear
  // the stored slug (applied as an attribute REMOVE in upsertCtf, like scoreWindow).
  cardImage?: string | null;
  enabled?: boolean;
  // --- Flag-types framework (Slice 1a, CTFT-01) — additive optional passthrough --
  // All pass through numeric/string/map as provided (no hash/transform). An
  // omitted field never clobbers the stored value (see ctfAttributes no-clobber).
  answerType?: "static" | "otp" | "wordlist";
  // Wordlist one-time codes (Slice 3, CTFT-14) — WRITE-ONLY plaintext lines the
  // admin bulk-loads. They are HASHED (via the same hashAnswer seam answers use)
  // and appended to the CtfCode pool on the write path (see upsertCtf/loadCtfCodes);
  // plaintext is NEVER persisted and NEVER round-tripped back to the client. The
  // load is ADD-ONLY: re-saving appends new hashes and skips duplicates, never
  // overwriting a claim. Not part of the ctfAttributes .set() payload (it is a
  // separate CtfCode write), so it never lands on the Ctf row.
  codes?: string[];
  otp?: {
    secret?: string;
    digits?: number;
    period?: number;
    algorithm?: string;
    skew?: number;
    // First-come single-use (Phase 65, CTFT-18). Non-secret; carried verbatim by
    // the existing whole-`otp`-map passthrough (no separate emit/transform) onto
    // the Ctf row, where the judge (65-02) reads it. Absent/false ⇒ shared.
    singleUse?: boolean;
  };
  unlockAfter?: string;
  perPlayerIntervalHours?: number;
  perPlayerMax?: number;
  globalMax?: number;
  // Additive Slice-2 day/time/tz scoring window (CTFT-11). No transform; no-clobber
  // (emitted only when provided). NOT a flag-type field — it does not participate in
  // the CTFT-06 static↔repeatable flip guard, so a window-only edit of a solved flag
  // is never rejected.
  //
  // Tri-state (CR-01): `undefined` ⇒ no-clobber (leave the stored window untouched);
  // a value ⇒ set it; explicit `null` ⇒ CLEAR the stored window (an attribute REMOVE,
  // so toggling the window OFF on edit makes the flag always-open again — an omitted
  // key alone would silently preserve the old window and keep gating the flag).
  scoreWindow?: { days?: number[]; from?: string; to?: string; tz?: string } | null;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** All QR codes (admin list). Full-table entity scan; the code count is small. */
export async function listQrCodes() {
  const result = await Qr.scan.go({ pages: "all" });
  return result.data;
}

/** All CTF challenges (admin list). */
export async function listCtf() {
  const result = await Ctf.scan.go({ pages: "all" });
  return result.data;
}

/**
 * One QR code by code, or null. Uses the LENIENT key (trim+lowercase, no
 * CODE_RE throw) so rows created outside upsertQr — e.g. emoji/percent-encoded
 * codes — load instead of crashing the edit page. Strict validation is a
 * write-time concern (see upsertQr / normalizeCode).
 */
export async function getQr(code: string) {
  // Try both the literal key and its percent-decoded form: some rows (the ☎ CTF
  // codes) have a pk composed from the DECODED value but a percent-encoded `code`
  // attribute, so a lookup by the attribute alone misses. See codeKeyCandidates.
  for (const key of codeKeyCandidates(code)) {
    const result = await Qr.get({ code: key }).go();
    if (result.data) return result.data;
  }
  return null;
}

/** One CTF challenge by (normalized) challenge, or null. */
export async function getCtf(challenge: string) {
  const result = await Ctf.get({ challenge: normalizeChallenge(challenge) }).go();
  return result.data ?? null;
}

/** The plaintext OTP secret + reconstructed enrollment URL for a challenge. */
export interface RevealedOtp {
  secret: string;
  otpauth: string;
  digits: number;
  period: number;
  algorithm: string;
}

/**
 * Reveal an existing rotating-OTP flag's shared secret + a rebuilt `otpauth://`
 * enrollment URL, for the admin "Reveal secret" affordance (read-only). Returns
 * null when the challenge is missing or carries no OTP secret — the route maps
 * that to a 404 so the surface stays non-disclosing. This deliberately pierces
 * the `redactCtfSecrets` boundary, so it MUST only be reached behind the same
 * admin gate as every other mutation on /api/admin/qr. The rebuilt URL uses the
 * challenge name as the authenticator account label (the stored `otp` map carries
 * no label/issuer) — cosmetic only; the codes depend solely on
 * secret/digits/period/algorithm.
 */
export async function revealCtfOtp(challenge: string): Promise<RevealedOtp | null> {
  const row = await getCtf(challenge);
  if (!row?.otp?.secret) return null;
  // Captured on the guard-narrowed path (the ElectroDB map re-widens `secret`
  // to `string | undefined` once aliased, so read it here where it's `string`).
  const secret = row.otp.secret;
  const otp = row.otp;

  const digits = otp.digits ?? DEFAULT_DIGITS;
  const period = otp.period ?? DEFAULT_PERIOD;
  const algorithm = otp.algorithm ?? DEFAULT_ALGORITHM;
  const otpauth = buildOtpauth({ secret, digits, period, algorithm, label: row.challenge });
  return { secret, otpauth, digits, period, algorithm };
}

/**
 * Reveal a challenge's stored `effect` payload (admin read-only), or null when the
 * challenge is missing or has no effect. The effect is the other recoverable
 * secret-bearing field: a Static-answer reward stores an `otpauth://` enrollment
 * here verbatim (same secret class as an OTP-answer secret). The raw payload is
 * returned as-is; the client narrows it (a valid otpauth-enroll → QR, otherwise
 * shown as JSON). Like {@link revealCtfOtp} this pierces `redactCtfSecrets`, so it
 * MUST stay behind the /api/admin/qr admin gate.
 */
export async function revealCtfEffect(challenge: string): Promise<{ effect: unknown } | null> {
  const row = await getCtf(challenge);
  if (row?.effect === undefined) return null;
  return { effect: row.effect };
}

/**
 * code → total-scans map for the admin list, from ONE Qrstat scan (the `total`
 * bucket rows). Avoids an N+1 per-code query when rendering the list. Skips the
 * reserved `_meta` watermark row.
 */
export async function listQrTotals(): Promise<Record<string, number>> {
  const result = await Qrstat.scan.go({ pages: "all" });
  const totals: Record<string, number> = {};
  for (const row of result.data) {
    if (row.bucket === "total" && row.code !== "_meta") {
      totals[row.code] = row.count ?? 0;
    }
  }
  return totals;
}

export interface QrStatsView {
  total: number;
  days: Array<{ date: string; count: number }>;
  params: Array<{ value: string; count: number }>;
  ctf: Array<{ challenge: string; count: number }>;
}

/**
 * Read-only scan analytics for one code: split the Qrstat bucket rows into
 * total / per-day (`day#*`) / per-param (`param#*`) / per-ctf (`ctf#*`). The
 * rollup Lambda owns the writes; this only reads. Days are returned newest-first.
 */
export async function getQrStats(code: string): Promise<QrStatsView> {
  const view: QrStatsView = { total: 0, days: [], params: [], ctf: [] };
  // Match getQr's key resolution: build from the first candidate key with rows.
  for (const key of codeKeyCandidates(code)) {
    const result = await Qrstat.query.primary({ code: key }).go({ pages: "all" });
    if (!result.data.length) continue;
    for (const row of result.data) {
      const bucket = row.bucket;
      const count = row.count ?? 0;
      if (bucket === "total") view.total = count;
      else if (bucket.startsWith("day#")) view.days.push({ date: bucket.slice(4), count });
      else if (bucket.startsWith("param#")) view.params.push({ value: bucket.slice(6), count });
      else if (bucket.startsWith("ctf#")) view.ctf.push({ challenge: bucket.slice(4), count });
    }
    break;
  }
  view.days.sort((a, b) => b.date.localeCompare(a.date));
  view.params.sort((a, b) => b.count - a.count);
  view.ctf.sort((a, b) => b.count - a.count);
  return view;
}

// ---------------------------------------------------------------------------
// Writes (validate first, then create-or-patch to preserve createdAt on edit)
// ---------------------------------------------------------------------------

/**
 * Build the validated attribute payload for a Qr write (no key work).
 *
 * Every rule MUST carry a usable https destination and its condition fields —
 * a rule with a blank dest would match at the resolver but produce a redirect
 * with no Location, which the ALB turns into a 502 (the RICK incident). We
 * reject such rules here so the bad shape can never reach the table.
 */
export function qrAttributes(input: QrInput) {
  if (input.destination) validateDestination(input.destination);
  // A dynamic schedule is the source of truth: validate each switch-point (https
  // dest + parseable start) and compile into time-rules, ignoring any raw `rules`
  // for this write. A blank/empty schedule leaves the raw-rules path in charge.
  const hasSchedule = Array.isArray(input.schedule) && input.schedule.length > 0;
  const scheduleEntries = hasSchedule
    ? input.schedule!.map((e, i) => {
        const where = `Switch-point ${i + 1}`;
        if (!e.dest || e.dest.trim() === "") {
          throw new QrValidationError(`${where} needs a destination.`);
        }
        validateDestination(e.dest); // absolute https only
        if (!e.startsAt || Number.isNaN(Date.parse(e.startsAt))) {
          throw new QrValidationError(`${where} has an invalid start time.`);
        }
        return {
          startsAt: e.startsAt,
          dest: e.dest,
          ...(e.label ? { label: e.label } : {}),
        };
      })
    : [];
  const rules = (input.rules ?? []).map((r, i) => {
    const where = `Rule ${i + 1}`;
    if (!r.dest || r.dest.trim() === "") {
      throw new QrValidationError(`${where} needs a destination.`);
    }
    validateDestination(r.dest); // absolute https only
    if (r.kind === "time") {
      if (!r.from || !r.to) {
        throw new QrValidationError(`${where} (time) needs both a From and a To.`);
      }
      if (Number.isNaN(Date.parse(r.from)) || Number.isNaN(Date.parse(r.to))) {
        throw new QrValidationError(`${where} (time) has an invalid date.`);
      }
    } else if (r.kind === "param") {
      if (!r.match || r.match.trim() === "") {
        throw new QrValidationError(`${where} (param) needs a match value (use * for any).`);
      }
    }
    return {
      kind: r.kind,
      ...(r.from !== undefined ? { from: r.from } : {}),
      ...(r.to !== undefined ? { to: r.to } : {}),
      ...(r.match !== undefined ? { match: r.match } : {}),
      dest: r.dest,
    };
  });
  // When a schedule is present it OWNS `rules` (compiled from switch-points);
  // otherwise the raw-rules path above applies. `schedule` is persisted as the
  // authoring source of truth (empty list clears any prior schedule on patch).
  const derivedRules = hasSchedule ? compileScheduleToRules(scheduleEntries) : rules;
  return {
    type: input.type || "redirect",
    destination: input.destination ?? "",
    rules: derivedRules,
    schedule: scheduleEntries,
    enrich: input.enrich ?? {},
    enabled: input.enabled ?? true,
    owner: input.owner ?? "",
    notes: input.notes ?? "",
    unfurl: (input.unfurl ?? "").trim().toLowerCase(),
  };
}

/**
 * Create or update a QR code. Validates code + destination(s) first (throws
 * QrValidationError before any DB write). Uses create-if-absent / patch-if-
 * present so `createdAt` survives an edit (a blind `.put()` would reset it).
 * Returns the normalized code.
 */
export async function upsertQr(input: QrInput): Promise<string> {
  const code = normalizeCode(input.code);
  const attrs = qrAttributes(input);
  const existing = await Qr.get({ code }).go();
  if (existing.data) {
    await Qr.patch({ code }).set(attrs).go();
  } else {
    await Qr.create({ code, ...attrs }).go();
  }
  return code;
}

/** Delete a QR code. Idempotent. Deletes every candidate key form (literal +
 * percent-decoded) so it removes the row whichever way its pk was composed —
 * lets the admin clean up rows created outside upsertQr (e.g. the ☎ codes). */
export async function deleteQr(code: string): Promise<void> {
  for (const key of codeKeyCandidates(code)) {
    await Qr.delete({ code: key }).go();
  }
}

/**
 * Build the validated attribute payload for a Ctf write.
 *
 * No-plaintext invariant: the admin-typed answer is NEVER persisted verbatim.
 * A non-empty answer is stored ONLY as its salted hash (answerHash via the
 * hashAnswer seam); the write payload carries no plaintext answer key.
 *
 * No-clobber invariant: when the answer field is blank / whitespace / undefined
 * the answerHash key is omitted ENTIRELY. Because upsertCtf edits via
 * Ctf.patch().set(attrs), an omitted key leaves the stored hash untouched — so
 * editing a challenge without re-typing the answer preserves the existing
 * answerHash rather than erasing it.
 *
 * timeTiers are validated here (from < to, numeric ceiling) so a malformed tier
 * throws QrValidationError BEFORE any DynamoDB call (mirrors the qrAttributes
 * rule guard).
 */
export function ctfAttributes(input: CtfInput) {
  const answer = (input.answer ?? "").trim();
  const tiers = (input.timeTiers ?? []).map((t, i) => {
    const where = `Time tier ${i + 1}`;
    if (
      !t.from ||
      !t.to ||
      Number.isNaN(Date.parse(t.from)) ||
      Number.isNaN(Date.parse(t.to)) ||
      Date.parse(t.from) >= Date.parse(t.to)
    ) {
      throw new QrValidationError(`${where} needs From < To.`);
    }
    if (!Number.isFinite(t.ceiling)) {
      throw new QrValidationError(`${where} needs a numeric ceiling.`);
    }
    return { from: t.from, to: t.to, ceiling: t.ceiling as number };
  });
  // WR-01: reject a degenerate / never-scoring window at the write boundary (mirrors
  // the timeTiers guard above). A window with no days, malformed HH:MM, or to<=from
  // can never satisfy the half-open same-day predicate, so it would silently never
  // score. Fail loudly with QrValidationError instead of persisting a dead flag. A
  // `null` clear (CR-01) and an absent window skip validation.
  if (input.scoreWindow != null) {
    const sw = input.scoreWindow;
    const err = validateScoreWindow({
      days: sw.days ?? [],
      from: sw.from ?? "",
      to: sw.to ?? "",
      tz: sw.tz ?? "",
    });
    if (err) throw new QrValidationError(err);
  }
  return {
    // Hash-on-save only when a real answer was entered; omit the key otherwise
    // (no-clobber). See invariant above.
    ...(answer !== "" ? { answerHash: hashAnswer(input.answer as string) } : {}),
    ...(input.points !== undefined ? { points: input.points } : {}),
    ...(input.pointMax !== undefined ? { pointMax: input.pointMax } : {}),
    ...(input.pointFloor !== undefined ? { pointFloor: input.pointFloor } : {}),
    ...(input.maxSolves !== undefined ? { maxSolves: input.maxSolves } : {}),
    ...(input.firstBloodBonus !== undefined
      ? { firstBloodBonus: input.firstBloodBonus }
      : {}),
    ...(tiers.length ? { timeTiers: tiers } : {}),
    ...(input.effect !== undefined ? { effect: input.effect } : {}),
    ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {}),
    ...(input.rateLimitWindow !== undefined
      ? { rateLimitWindow: input.rateLimitWindow }
      : {}),
    // Flag-types passthrough (Slice 1a) — each emitted only when provided so an
    // omitted field leaves the stored value untouched on patch (no-clobber).
    ...(input.answerType !== undefined ? { answerType: input.answerType } : {}),
    ...(input.otp !== undefined ? { otp: input.otp } : {}),
    ...(input.unlockAfter !== undefined ? { unlockAfter: input.unlockAfter } : {}),
    ...(input.perPlayerIntervalHours !== undefined
      ? { perPlayerIntervalHours: input.perPlayerIntervalHours }
      : {}),
    ...(input.perPlayerMax !== undefined ? { perPlayerMax: input.perPlayerMax } : {}),
    ...(input.globalMax !== undefined ? { globalMax: input.globalMax } : {}),
    // Slice-2 day/time/tz window (CTFT-11) — additive passthrough, verbatim, no
    // transform. Emitted only for a real value: `undefined` (no-clobber on partial
    // edits) AND explicit `null` (CR-01 clear) both OMIT the key from the .set()
    // payload — the null-clear is applied as an attribute REMOVE in upsertCtf, never
    // as a `.set(null)`.
    ...(input.scoreWindow != null ? { scoreWindow: input.scoreWindow } : {}),
    // Card slug (cards board): trimmed; a blank field omits the key (no-clobber on edit).
    ...((input.cardImage ?? "").trim() !== ""
      ? { cardImage: (input.cardImage as string).trim() }
      : {}),
    enabled: input.enabled ?? true,
  };
}

/**
 * Pure bulk-hash of admin-pasted wordlist codes (Slice 3, CTFT-14).
 *
 * Trims each line, drops blanks, and hashes each surviving line with `hashAnswer`
 * — the SAME salted seam the judge (56-02) claims a submitted guess against, so a
 * loaded code and a later guess of that code hash IDENTICALLY. De-dups WITHIN the
 * batch by codeHash (a repeated line counts toward `duplicates`, not `added`), so
 * a paste with accidental repeats loads each distinct code exactly once.
 *
 * Returns the DISTINCT `codeHashes`, `added = codeHashes.length`, and
 * `duplicates = survivingLines - added`. Plaintext never appears in the output —
 * only salted hashes cross this boundary. PURE (no DB): the add-only write lives
 * in `loadCtfCodes` / `upsertCtf`, keeping this unit-testable like `ctfAttributes`.
 */
export function hashCodeBatch(lines: string[]): {
  codeHashes: string[];
  added: number;
  duplicates: number;
} {
  const seen = new Set<string>();
  const codeHashes: string[] = [];
  let surviving = 0;
  for (const raw of lines) {
    const line = (raw ?? "").trim();
    if (line === "") continue; // drop blank lines
    surviving++;
    const codeHash = hashAnswer(line);
    if (seen.has(codeHash)) continue; // in-batch de-dup (counts as a duplicate)
    seen.add(codeHash);
    codeHashes.push(codeHash);
  }
  return { codeHashes, added: codeHashes.length, duplicates: surviving - codeHashes.length };
}

/**
 * Add-only bulk load of wordlist codes into the CtfCode pool (Slice 3, CTFT-14).
 *
 * Hashes the plaintext lines (via `hashCodeBatch`) and `CtfCode.create`s one row
 * per distinct codeHash. The create is guarded so a codeHash ALREADY in the pool
 * is a no-op — never a `.set()`/overwrite of an existing `claimedBy` (add-only,
 * so a re-save can never un-claim or reveal a loaded code). NEVER logs the
 * plaintext lines. Returns the batch stats for a non-blocking admin confirmation.
 *
 * WR-01 accuracy contract: `added` counts ONLY the rows this call actually
 * persisted (a successful `create`); it is NOT the pre-loop `hashCodeBatch.added`
 * (which would over-count both cross-save duplicates and transient failures as
 * "loaded"). A create collision on the key's `attribute_not_exists` existence
 * condition means the codeHash is ALREADY in the pool ⇒ count it as a duplicate
 * (add-only no-op). Any OTHER error (a genuine transient DynamoDB throttle /
 * network fault) is RETHROWN so the admin never sees a code reported as loaded
 * when it was silently dropped. We distinguish the two by re-reading the row —
 * the SAME classification discipline `claimSolve` / `claimCode` use in
 * ctf-judge.ts (collision ⇒ row is present; anything else ⇒ rethrow). Never logs
 * the plaintext line or the codeHash. The `hashCodeBatch` within-batch duplicates
 * are folded into the returned `duplicates`.
 */
export async function loadCtfCodes(
  challenge: string,
  lines: string[]
): Promise<{ added: number; duplicates: number }> {
  const { codeHashes, duplicates: batchDuplicates } = hashCodeBatch(lines);
  let added = 0;
  let duplicates = batchDuplicates;
  for (const codeHash of codeHashes) {
    try {
      await CtfCode.create({ challenge, codeHash }).go();
      added++;
    } catch (err) {
      // A create collision means the codeHash is ALREADY in the pool — the
      // add-only no-op. Confirm by re-reading (mirrors claimSolve/claimCode in
      // ctf-judge.ts): if the row IS present it was a genuine duplicate ⇒ count
      // it as a duplicate. If NO row exists the create did NOT fail on the
      // existence condition — it was a genuine transient error (throttle /
      // network) ⇒ RETHROW so the admin never believes a code loaded when it did
      // not. Never log the plaintext line or the codeHash.
      const existing = await CtfCode.get({ challenge, codeHash }).go();
      if (!existing.data) throw err;
      duplicates++;
    }
  }
  return { added, duplicates };
}

/**
 * Wordlist pool status for the admin edit view (Slice 3, CTFT-14). Read-only:
 * counts the CtfCode rows for a challenge and how many remain unclaimed. Only
 * aggregate counts leave the server — a plaintext code is NEVER read back (the
 * entity has no plaintext attribute; `claimedBy` presence is the claimed flag).
 */
export async function getCtfCodeCounts(
  challenge: string
): Promise<{ loaded: number; unclaimed: number }> {
  const c = normalizeChallenge(challenge);
  const result = await CtfCode.query.primary({ challenge: c }).go({ pages: "all" });
  const rows = result.data;
  return {
    loaded: rows.length,
    unclaimed: rows.filter((r) => !r.claimedBy).length,
  };
}

/**
 * Create or update a CTF challenge. Challenge name is lowercase-normalized.
 * Same create-or-patch semantics as upsertQr. Returns the normalized challenge.
 */
export async function upsertCtf(input: CtfInput): Promise<string> {
  const challenge = normalizeChallenge(input.challenge);
  const attrs = ctfAttributes(input);
  const existing = await Ctf.get({ challenge }).go();
  if (existing.data) {
    // CTFT-06 (D-07): reject a static <-> repeatable flip once any scoring
    // history exists (it would split across CtfSolve + CtfScoreEvent). Bounded
    // existence read — a single-item query on each entity's challenge partition;
    // the pure repeatable-ness comparison lives in ctf-flag-types.
    const hasSolves = await challengeHasSolves(challenge);
    // Compare against the MERGED next-state, not the raw partial `input`.
    // `ctfAttributes` is no-clobber (an omitted flag-type field preserves the
    // stored value), so a partial edit that never touches the repeatable-defining
    // fields must NOT read as a flip. `mergeFlagTypeNextState` mirrors that
    // no-clobber overlay; a genuine flip still sets one of the fields and is still
    // rejected. (Passing raw `input` here is CR-01 — its omitted fields read as
    // non-repeatable and wrongly reject partial edits of solved repeatable flags.)
    const nextFlagType = mergeFlagTypeNextState(existing.data, input);
    assertAnswerTypeTransition(existing.data, nextFlagType, hasSolves);
    // CR-01: an explicit `null` scoreWindow means "clear the stored window". A plain
    // `.set(attrs)` omits the key (no-clobber), which would leave the old window in
    // place and keep the flag silently gated while the UI reads "Scorable any time."
    // Apply a real attribute REMOVE so toggling the window OFF actually re-opens it.
    const patch = Ctf.patch({ challenge }).set(attrs);
    // Explicit `null` means "clear this attribute" — a plain `.set(attrs)` omits
    // the key (no-clobber), so toggling a windowed/carded field OFF needs a real
    // attribute REMOVE. `ctfAttributes` already omits both from the set payload.
    const toRemove: Array<"scoreWindow" | "cardImage"> = [];
    if (input.scoreWindow === null) toRemove.push("scoreWindow");
    if (input.cardImage === null) toRemove.push("cardImage");
    if (toRemove.length) patch.remove(toRemove);
    await patch.go();
  } else {
    await Ctf.create({ challenge, ...attrs }).go();
  }
  // Wordlist bulk load (Slice 3, CTFT-14): after the Ctf row is written, append
  // any pasted one-time codes to the CtfCode pool — ADD-ONLY (existing codes are
  // never overwritten or un-claimed), hashed server-side, plaintext never stored.
  // Runs for both create and edit; an omitted/empty `codes` is a no-op.
  if (input.codes?.length) {
    await loadCtfCodes(challenge, input.codes);
  }
  return challenge;
}

/**
 * Bounded existence check: does ANY scoring history exist for this challenge
 * across either ledger (CtfSolve for static one-award flags, CtfScoreEvent for
 * repeatable flags)? Uses a limit-1 query on each entity's challenge partition —
 * no full scan — and short-circuits on the first hit.
 */
async function challengeHasSolves(challenge: string): Promise<boolean> {
  const solve = await CtfSolve.query.primary({ challenge }).go({ limit: 1 });
  if (solve.data.length > 0) return true;
  const event = await CtfScoreEvent.query.primary({ challenge }).go({ limit: 1 });
  return event.data.length > 0;
}

/** Delete a CTF challenge by (normalized) challenge. Idempotent. */
export async function deleteCtf(challenge: string): Promise<void> {
  await Ctf.delete({ challenge: normalizeChallenge(challenge) }).go();
}
