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
 */
export async function createPending(
  challenge: string,
  guess: string,
  deps: PendingDeps = {},
): Promise<{ nonce: string }> {
  const store = deps.store ?? defaultPendingStore;
  const now = deps.now ?? Date.now();
  const nonce = deps.newNonce ? deps.newNonce() : crypto.randomUUID();
  const ttl = Math.floor(now / 1000) + PENDING_TTL_SECONDS;
  await store.putPending({
    nonce,
    challenge: normalizeChallenge(challenge),
    submittedFlagHash: hashAnswer(guess),
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
