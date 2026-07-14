/**
 * ctf-covert-codec — a REVERSIBLE + TOTAL flag codec (CTF-07).
 *
 * `encodeFlag(challenge, guess)` frames the pair into a single pure-decimal
 * string that reads as a build-date / cache-buster version stamp (the covert
 * `?v=` param). `decodeFlag(v)` reverses it, or returns `null` — and it NEVER
 * throws, because null is the covert endpoint's decoy trigger: any decode
 * failure yields the plain sheet. This is transport framing, not a secret
 * (T-46-03: forged `v` still routes through judgeSolve's hash compare).
 *
 * Scheme:
 *   payload bytes = [ 0x01 marker ][ cLen hi ][ cLen lo ][ challenge UTF-8 ][ guess UTF-8 ]
 *   The 0x01 marker keeps the high byte non-zero so BigInt<->bytes preserves
 *   leading zero bytes. `cLen` (16-bit big-endian) marks where challenge ends;
 *   everything after is the guess.
 *   n     = BigInt(payload bytes)
 *   check = n mod 97          (0..96, folded into the low 2 decimal digits)
 *   v     = (n * 100 + check).toString()
 *
 * decode rejects (→ null) anything not /^[0-9]+$/, any checksum mismatch, and
 * any structural/bounds failure. Pure module: no I/O, no logging.
 */

const MARKER = 1;

function bytesToBigint(bytes: Uint8Array): bigint {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}

function bigintToBytes(n: bigint): Uint8Array {
  const out: number[] = [];
  while (n > 0n) {
    out.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  return Uint8Array.from(out);
}

export function encodeFlag(challenge: string, guess: string): string {
  const cb = new TextEncoder().encode(challenge);
  const gb = new TextEncoder().encode(guess);
  const buf = Uint8Array.from([
    MARKER,
    (cb.length >> 8) & 0xff,
    cb.length & 0xff,
    ...cb,
    ...gb,
  ]);
  const n = bytesToBigint(buf);
  const check = n % 97n;
  return (n * 100n + check).toString();
}

export function decodeFlag(v: string): { challenge: string; guess: string } | null {
  if (typeof v !== "string" || !/^[0-9]+$/.test(v)) return null;
  try {
    const value = BigInt(v);
    const check = value % 100n;
    const n = value / 100n;
    if (n % 97n !== check) return null;
    const bytes = bigintToBytes(n);
    if (bytes.length < 3 || bytes[0] !== MARKER) return null;
    const cLen = (bytes[1] << 8) | bytes[2];
    if (3 + cLen > bytes.length) return null;
    const dec = new TextDecoder("utf-8", { fatal: false });
    return {
      challenge: dec.decode(bytes.slice(3, 3 + cLen)),
      guess: dec.decode(bytes.slice(3 + cLen)),
    };
  } catch {
    return null;
  }
}
