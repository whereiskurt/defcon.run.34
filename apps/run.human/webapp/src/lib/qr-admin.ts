import { Qr, Ctf, Qrstat } from "@/entities/qr";
import { hashAnswer } from "@/lib/ctf-hash";

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
 */

/** Thrown for any user-correctable bad input. Route maps it to HTTP 400. */
export class QrValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QrValidationError";
  }
}

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

export interface QrInput {
  code: string;
  type?: string;
  destination?: string;
  rules?: QrRuleInput[];
  enrich?: QrEnrichInput;
  enabled?: boolean;
  owner?: string;
  notes?: string;
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
  enabled?: boolean;
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

/** One QR code by (normalized) code, or null. */
export async function getQr(code: string) {
  const result = await Qr.get({ code: normalizeCode(code) }).go();
  return result.data ?? null;
}

/** One CTF challenge by (normalized) challenge, or null. */
export async function getCtf(challenge: string) {
  const result = await Ctf.get({ challenge: normalizeChallenge(challenge) }).go();
  return result.data ?? null;
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
  const c = normalizeCode(code);
  const result = await Qrstat.query.primary({ code: c }).go({ pages: "all" });
  const view: QrStatsView = { total: 0, days: [], params: [], ctf: [] };
  for (const row of result.data) {
    const bucket = row.bucket;
    const count = row.count ?? 0;
    if (bucket === "total") view.total = count;
    else if (bucket.startsWith("day#")) view.days.push({ date: bucket.slice(4), count });
    else if (bucket.startsWith("param#")) view.params.push({ value: bucket.slice(6), count });
    else if (bucket.startsWith("ctf#")) view.ctf.push({ challenge: bucket.slice(4), count });
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
function qrAttributes(input: QrInput) {
  if (input.destination) validateDestination(input.destination);
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
  return {
    type: input.type || "redirect",
    destination: input.destination ?? "",
    rules,
    enrich: input.enrich ?? {},
    enabled: input.enabled ?? true,
    owner: input.owner ?? "",
    notes: input.notes ?? "",
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

/** Delete a QR code by (normalized) code. Idempotent. */
export async function deleteQr(code: string): Promise<void> {
  await Qr.delete({ code: normalizeCode(code) }).go();
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
    enabled: input.enabled ?? true,
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
    await Ctf.patch({ challenge }).set(attrs).go();
  } else {
    await Ctf.create({ challenge, ...attrs }).go();
  }
  return challenge;
}

/** Delete a CTF challenge by (normalized) challenge. Idempotent. */
export async function deleteCtf(challenge: string): Promise<void> {
  await Ctf.delete({ challenge: normalizeChallenge(challenge) }).go();
}
