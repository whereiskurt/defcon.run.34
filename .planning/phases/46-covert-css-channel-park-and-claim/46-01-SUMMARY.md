---
phase: 46-covert-css-channel-park-and-claim
plan: 01
subsystem: run.human / CTF covert channel
tags: [ctf, covert-channel, codec, css, pure-logic]
requires: []
provides:
  - ctf-covert-codec (encodeFlag/decodeFlag)
  - ctf-covert-css (buildDecoySheet/buildWinSheet/AWARD_PROP)
affects:
  - 46-02 (covert route handler — consumes both modules)
  - 46-04 (egg client — encodes v, reads AWARD_PROP back)
tech-stack:
  added: []
  patterns: [pure-module, BigInt-codec, presence-only-marker, size-plausible-decoy]
key-files:
  created:
    - apps/run.human/webapp/src/lib/ctf-covert-codec.ts
    - apps/run.human/webapp/src/lib/ctf-covert-css.ts
    - apps/run.human/webapp/src/lib/__tests__/ctf-covert-codec.test.ts
    - apps/run.human/webapp/src/lib/__tests__/ctf-covert-css.test.ts
  modified: []
decisions:
  - "Codec = length-prefixed UTF-8 payload -> BigInt -> decimal with mod-97 checksum folded into low 2 digits; 0x01 marker byte preserves leading-zero bytes across BigInt<->bytes."
  - "AWARD_PROP = --accent-ramp (presence-only theme token; value = credited points)."
  - "SIZE_TOLERANCE = 8; decoy uses same-length --accent-fill filler so bodies stay byte-plausible."
  - "Used BigInt() constructor form (not 0n literals) because tsconfig target is ES2017."
metrics:
  duration: ~10m
  completed: 2026-07-14
status: complete
---

# Phase 46 Plan 01: Covert-channel primitives (flag codec + CSS-ack builder) Summary

Two PURE, dependency-free modules that make every covert-channel invisibility
invariant unit-checkable before any route or client exists: a reversible+total
flag codec (CTF-07) and a byte-plausible CSS-ack sheet builder whose only
observable difference across outcomes is one innocuous theme custom property (CTF-08).

## What was built

**`ctf-covert-codec.ts`**
- `encodeFlag(challenge: string, guess: string): string`
- `decodeFlag(v: string): { challenge: string; guess: string } | null`
- Scheme: payload bytes `[0x01 marker][cLen hi][cLen lo][challenge UTF-8][guess UTF-8]`
  → BigInt `n` → checksum `n mod 97` folded into low 2 decimal digits →
  `v = (n*100 + check).toString()`. The 0x01 marker keeps the high byte non-zero so
  BigInt↔bytes round-trips leading zero bytes; `cLen` (16-bit BE) splits challenge/guess.
- `decodeFlag` is TOTAL: rejects (→ null) anything not `/^[0-9]+$/`, any checksum
  mismatch, and any structural/bounds failure — wrapped in a guard so it NEVER throws
  (null is the endpoint's decoy trigger). No flag registry; guess bytes are encoded
  directly (no server-side flag material). No logging.

**`ctf-covert-css.ts`**
- `AWARD_PROP = "--accent-ramp"` — the single theme-token contract shared with the
  route (46-02) and egg client (46-04).
- `buildWinSheet(points: number): string` — base theme sheet + `:root { --accent-ramp: <points>; }`.
- `buildDecoySheet(): string` — same base + a same-length filler `:root { --accent-fill: 000; }`;
  never contains `AWARD_PROP`.
- `SIZE_TOLERANCE = 8` — decoy vs. win body sizes stay within this delta across the
  representative point range (real spread ≤ 2, driven only by digit count).
- No logging; emitted bytes contain no win/auth/flag/ctf wording.

## Verification results

- Both vitest suites green on Node 23.6.0: **12 tests passed** (6 codec + 6 css).
  - Round-trip: `decodeFlag(encodeFlag(c,g))` deep-equals `{challenge,guess}` over a
    table of ascii / unicode / digit / space / empty pairs.
  - Total / never-throws: malformed inputs (`""`, `abc`, `-5`, `12.5`, `1e5`, Arabic
    digits, 5000-digit string, etc.) → null, and a `.not.toThrow()` sweep over hostile input.
  - Decoy-null-rate: over 2000 random decimal strings, null rate > 0.9 (checksum ≈99% reject).
  - Shape: `encodeFlag` output matches `/^[0-9]+$/`.
  - Size invariant: `|len(decoy) - len(win)| <= 8` for points {1, 42, 734, 99999}.
  - Marker: win sheet contains `--accent-ramp: <points>`; decoy never contains `--accent-ramp`.
- `tsc --noEmit`: **no new errors** on the covert files. Baseline of 5 pre-existing
  error-lines (dropdown-user.tsx SVG import + 4 in checkin.test.ts) unchanged.
- Manual sanity (matches plan verification):
  - `encodeFlag("dc34-egg","1337")` → `519296175226138321203898751668715963` (pure decimal).
  - `decodeFlag(^)` → `{"challenge":"dc34-egg","guess":"1337"}`.
  - `decodeFlag("20260806")` → `null` (build-date number fails checksum).
  - `buildWinSheet(734)` and `buildDecoySheet()` both 224 bytes (diff 0).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] BigInt literals rejected by ES2017 tsc target**
- **Found during:** Task 2 (tsc verification of Task 1 output)
- **Issue:** BigInt literal syntax (`0n`, `97n`, …) produced 10 `TS2737` errors because
  `tsconfig.json` targets ES2017 (< ES2020). Runtime (Node 23 / vitest) was fine; only tsc flagged it.
- **Fix:** Refactored `ctf-covert-codec.ts` to use the `BigInt()` constructor form
  (`const B97 = BigInt(97)`, etc.) instead of `n` literals. No project-config change.
- **Files modified:** apps/run.human/webapp/src/lib/ctf-covert-codec.ts
- **Commit:** c96ed99a

## TDD Gate Compliance

Both tasks followed RED → GREEN: the test suite was written and confirmed failing
(module-not-found / no tests) before each implementation module was created. RED+GREEN
were folded into a single per-task `feat` commit to keep task commits atomic (verified
RED locally before writing implementation).

## Commits

- `10202ba5` feat(46-01): reversible+total flag codec (encodeFlag/decodeFlag)
- `c96ed99a` feat(46-01): CSS-ack sheet builder (presence-only marker, size-plausible)

## Known Stubs

None — both modules are fully wired pure logic. No stubs, no placeholder data.

## Self-Check: PASSED
- FOUND: apps/run.human/webapp/src/lib/ctf-covert-codec.ts
- FOUND: apps/run.human/webapp/src/lib/ctf-covert-css.ts
- FOUND: apps/run.human/webapp/src/lib/__tests__/ctf-covert-codec.test.ts
- FOUND: apps/run.human/webapp/src/lib/__tests__/ctf-covert-css.test.ts
- FOUND commit: 10202ba5
- FOUND commit: c96ed99a
