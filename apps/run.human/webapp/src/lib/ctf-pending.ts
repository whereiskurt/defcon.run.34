import { CtfPending } from "@/entities/ctf";
import { normalizeChallenge } from "@/lib/qr-admin";
import { hashAnswer } from "@/lib/ctf-hash";
import { judgeSolve, type JudgeResult } from "@/lib/ctf-judge";

/**
 * Park-and-claim data helpers (CTF-06) — the shared seam an UNAUTHENTICATED QR
 * scan uses to park a flag, and the later signed-in visit uses to redeem it,
 * crediting EXACTLY ONCE through the single Phase-44 `judgeSolve` flow. Phase 46
 * (covert channel) reuses these verbatim — hence the injectable `deps` seam and
 * channel-agnostic design.
 *
 * SERVER-ONLY: `defaultPendingStore` and `judgeSolve` import the electro client
 * (AWS creds from env). Only import this from server components / route handlers
 * — never a "use client" module (mirrors ctf-judge.ts / qr-admin.ts).
 *
 * HYGIENE (T-45-01): the RAW guess is NEVER stored or logged. `createPending`
 * persists only `submittedFlagHash = hashAnswer(guess)`, and the claim validates
 * that parked hash directly via `judgeSolve({ guessHash })` — the raw guess is
 * discarded the moment it is hashed.
 *
 * IDEMPOTENCY (T-45-02): credit routes ONLY through `judgeSolve` (conditional-put
 * CtfSolve). `claimPending` deletes the pending row on claim, so a re-presented
 * nonce finds nothing and no-ops; even if a delete were lost, judgeSolve's own
 * conditional-put backstops (a re-claim returns the prior award, never re-scores).
 */

/** Time-to-live for a parked flag: 30 days in epoch SECONDS (DynamoDB TTL). */
const PENDING_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * TTL for a ghost claim-link nonce (minted by /api/internal/ctf/mint): short
 * enough to blunt link sharing, long enough to walk to a phone and sign in.
 *
 * LEGACY (Phase 72): the 15-minute constant, superseded by AWARD_LINK_TTL_SECONDS
 * for bot-minted award links. Kept exported and unchanged so no current importer
 * breaks.
 */
export const CLAIM_LINK_TTL_SECONDS = 15 * 60;

/** Fallback award-link TTL when BOT_CLAIM_LINK_TTL_SECONDS is absent or garbage. */
const DEFAULT_AWARD_LINK_TTL_SECONDS = 60 * 60;

/**
 * TTL for a bot-minted award link (Phase 72), read once at module load from
 * BOT_CLAIM_LINK_TTL_SECONDS and defaulting to 3600s. Anything non-numeric or
 * non-positive clamps back to the default — a typo in the env must never mint an
 * award that is already expired. Applies to ricky AND all 8 persona ghosts.
 */
function readAwardLinkTtlSeconds(): number {
  const raw = process.env.BOT_CLAIM_LINK_TTL_SECONDS;
  if (!raw) return DEFAULT_AWARD_LINK_TTL_SECONDS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_AWARD_LINK_TTL_SECONDS;
}

export const AWARD_LINK_TTL_SECONDS = readAwardLinkTtlSeconds();

/** Crockford base32, lowercase — 32 symbols with `i`, `l`, `o` and `u` removed. */
const AWARD_NONCE_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
/** 12 symbols over a 32-symbol alphabet = 60 bits. */
const AWARD_NONCE_LENGTH = 12;

/**
 * A short award nonce for a bot-delivered claim link (`q.defcon.run/a/<nonce>`).
 *
 * 12 Crockford base32 lowercase symbols — 60 bits, which is infeasible to
 * brute-force against a token that is single-use AND dead within the hour. The
 * excluded glyphs (`i`, `l`, `o`, `u`) mean a player reading the link off a radio
 * screen cannot land on an ambiguous character.
 *
 * Randomness comes from crypto.getRandomValues. Because 256 is an exact multiple
 * of the 32-symbol alphabet, masking the low five bits of each byte is already a
 * uniform mapping — there is no modulo skew here and therefore no need for
 * reject-sampling.
 */
export function newAwardNonce(): string {
  const bytes = new Uint8Array(AWARD_NONCE_LENGTH);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += AWARD_NONCE_ALPHABET[byte & 31];
  return out;
}

const NON_SOLVE: JudgeResult = {
  solved: false,
  points: 0,
  ordinal: null,
  firstBlood: false,
  capped: false,
};

/** A parked flag: only the hash is stored, never the raw guess. */
export interface PendingRow {
  nonce: string;
  challenge: string;
  submittedFlagHash: string;
  ttl: number;
}

/** The data-layer seam — fakeable so tests/Phase-46 run with NO DynamoDB. */
export interface PendingStore {
  putPending(row: PendingRow): Promise<void>;
  getPending(nonce: string): Promise<PendingRow | null>;
  deletePending(nonce: string): Promise<void>;
}

/** Injectable deps mirroring judgeSolve's DI style. All optional (prod defaults). */
export interface PendingDeps {
  store?: PendingStore;
  judge?: typeof judgeSolve;
  now?: number;
  newNonce?: () => string;
  /** TTL override in seconds (default: 30 days). */
  ttlSeconds?: number;
  /**
   * A pre-computed answer hash to park VERBATIM, bypassing `hashAnswer(guess)`.
   *
   * Lets the mint-by-challenge path park a `Ctf` row's OWN stored `answerHash`,
   * so no raw flag code has to exist anywhere for that flow. This stays inside
   * the T-45-01 hygiene invariant: a hash goes in, a hash is stored, and no raw
   * guess is ever retained. Redemption still works because `judgeSolve` compares
   * `verifyAnswerHash(guessHash, ctf.answerHash)` for `answerType: "static"`.
   */
  flagHash?: string;
}

/** Electro-backed PendingStore on the CtfPending entity (keyed by nonce). */
export const defaultPendingStore: PendingStore = {
  async putPending({ nonce, challenge, submittedFlagHash, ttl }) {
    await CtfPending.create({ nonce, challenge, submittedFlagHash, ttl }).go();
  },
  async getPending(nonce) {
    const res = await CtfPending.get({ nonce }).go();
    const d = res.data;
    if (!d || !d.challenge || !d.submittedFlagHash) return null;
    return {
      nonce: d.nonce,
      challenge: d.challenge,
      submittedFlagHash: d.submittedFlagHash,
      ttl: d.ttl ?? 0,
    };
  },
  async deletePending(nonce) {
    await CtfPending.delete({ nonce }).go();
  },
};

/**
 * Park an anon scan: hash the guess, store `{ nonce, challenge, submittedFlagHash,
 * ttl }`, and return the nonce (persisted client-side for the later claim). The
 * raw guess is discarded after hashing — it is never stored or logged.
 *
 * `deps.flagHash` parks a caller-supplied hash verbatim instead (the bot mint
 * path); the guess argument is then never hashed at all.
 */
export async function createPending(
  challenge: string,
  guess: string,
  deps: PendingDeps = {},
): Promise<{ nonce: string }> {
  const store = deps.store ?? defaultPendingStore;
  const now = deps.now ?? Date.now();
  const nonce = deps.newNonce ? deps.newNonce() : crypto.randomUUID();
  const ttl = Math.floor(now / 1000) + (deps.ttlSeconds ?? PENDING_TTL_SECONDS);
  await store.putPending({
    nonce,
    challenge: normalizeChallenge(challenge),
    submittedFlagHash: deps.flagHash ?? hashAnswer(guess),
    ttl,
  });
  return { nonce };
}

/**
 * Redeem a parked flag for a signed-in user. Loads the pending row; a missing /
 * already-claimed nonce is an idempotent no-op (returns NON_SOLVE). A present row
 * credits through judgeSolve (channel "qr") using the parked hash, then deletes
 * the row so the nonce can never double-credit.
 */
export async function claimPending(
  nonce: string,
  user: string,
  deps: PendingDeps = {},
): Promise<JudgeResult> {
  const store = deps.store ?? defaultPendingStore;
  const judge = deps.judge ?? judgeSolve;
  const row = await store.getPending(nonce);
  if (!row) return NON_SOLVE;
  const result = await judge({
    user,
    challenge: row.challenge,
    guessHash: row.submittedFlagHash,
    channel: "qr",
  });
  await store.deletePending(nonce);
  return result;
}
