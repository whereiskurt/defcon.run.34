# Design — Phase 72: Bot Hardening (clickable one-time awards, fail-closed guardrails, delivery)

**Date:** 2026-07-31
**Status:** Approved (design), pending planning
**Owner:** Kurt (whereiskurt@gmail.com)
**Phase:** 72 (swept — all 21 worktrees max out at 71; 71 is planned-but-unexecuted heat-map)

## Goal

Make every mesh bot award a **short, clickable, genuinely single-use URL**, and
close the two hardening gaps that sit next to that mechanic: guardrails that
currently fail **open**, and a lyric stream where only the last line is
delivered reliably.

The user-facing shape mimics the payphone awards — call a phone, get texted a
tappable link — but with a single-use nonce instead of a rotating TOTP, so a
forwarded link awards at most once.

## Current state (verified in code, 2026-07-31)

| Bot | Award today | Clickable? | One-time? |
|-----|-------------|-----------|-----------|
| 8 persona ghosts (goldstein, mudge, condor, sharp, ladyada, hopper, turing, gibson) | 2 reliable DMs: `👻 You found a flag!` + `https://run.defcon.run/use1/ctf/claim?nonce=<uuid>` (79 chars) | yes | yes (15-min TTL) |
| ricky | final lyric line is the literal text `59: /qr/rick_astley_loves_desert_running` | **no** | **no** |
| dt | none (hint-only bot) | — | — |
| payphones (×4) | external system texts `…/ctf/claim?c=didhtp<n>&v=<TOTP>` | yes | no (window-bounded) |

Ricky's `/qr/…` path resolves to a **hand-uploaded static S3 interstitial** at
`defcon.run/qr/rick_astley_loves_desert_running` (474 bytes, `<title>never gonna
give you up</title>`) that meta-refreshes to `…/ctf/claim?c=ricky&v=<fixed code>`.
That code is **static forever and freely shareable** — anyone who ever saw the
page can claim ricky's 100 points daily, indefinitely. This is NOT the q.defcon.run
resolver; the `Qr` row from `scripts/setup-ricky-flag.mts` does not resolve there
(`q.defcon.run/rick_astley_loves_desert_running` → 404).

### Hardening gaps confirmed by reading source

1. **Guardrails fail OPEN by default** — `guard.go:30`,
   `failClosed := os.Getenv("MESHTK_GUARDRAIL_FAILMODE") == "closed"`. An
   unreachable sidecar means every jailbreak / toxicity / PII check silently
   passes and the DM goes straight to Bedrock.
2. **Full-table scan per flag mint** — `qr-admin.ts:230`,
   `Ctf.scan.go({ pages: "all" })`, executed on every persona flag reveal today.
3. **No backpressure on lyric performances** — the cooldown at `cmd.go:583` is
   per-**requester** (10 min), so N distinct radios start N concurrent songs,
   each its own goroutine, with no global cap.
4. **Only the final lyric line is reliable** — `cmd.go:1099`. Line 01 drops are
   observed live and root-caused *downstream of MQTT* (iOS proxy → BLE), not to
   a QoS0 reconnect gap.
5. **One shared internal secret mints any flag** — `mint/route.ts:33`. Not
   addressed in this phase (see Out of Scope).

### Scale analysis (asked during design)

Per-message cost is curve25519 + MQTT publish; pubkey resolution is a warm
in-memory keycache (`crypto.go:126`), **not** a DDB read per message.

| talkers | concurrent songs | DMs in 3m34s | aggregate |
|---|---|---|---|
| 10 | 10 | 590 | ~2.8/s |
| 50 | 50 | 2,950 | ~13.8/s |

Per-radio load is unchanged (1 msg / 3.6s) — the exposure is **RF-only**
listeners, where ~14 msg/s of 200-char packets collapses a LoRa channel well
before that. The new mint adds ≤1 HTTP call per radio per 10 min (cooldown-bound):
at 50 talkers that is ≤5 mints/min ≈ 0.08 rps — negligible, **provided** it uses
GetItem rather than the existing table scan.

## Confirmed decisions

| Decision | Value | Rationale |
|---|---|---|
| Award mechanic | single-use nonce (not TOTP) | genuinely one-time; forwarded link awards at most once |
| URL shape | `https://q.defcon.run/a/<nonce>` (35 chars) | shortest option; 79 → 35 |
| Reserved letter | **`a`** (award) | `/c/` was the first choice but `q.defcon.run/c` is a LIVE short code resolving to `didhtp1`; `a` probed free (404) |
| Nonce | 12 chars, Crockford base32 lowercase (60 bits) | brute force infeasible against a single-use 60-min token |
| TTL | 3600s, env `BOT_CLAIM_LINK_TTL_SECONDS` | survives a dead zone / late sign-in; single-use bounds sharing |
| Scope of new URL | ricky **and** all 8 personas | one mechanic for every bot |
| Ricky finale | song ends on the real closing lyric + 2 reliable award DMs | the `/qr/` LRC entry is dropped entirely |
| Old static ricky code | **rotated dead**, new code unpublished, used only as mint-failure fallback | makes "one-time" actually true |
| Performance cap | semaphore, `MESHTK_LYRICS_MAX_CONCURRENT` default 12 | bounds aggregate to ~3.3 msg/s regardless of crowd size |
| Guardrails | `MESHTK_GUARDRAIL_FAILMODE=closed` + alarm | fail-closed at a hacker con |
| Line 01 | promoted to reliable | observed drops; bounded at 3 reliable sites of 58 |

## Architecture

### Workstream A — Award integrity

**A1. New reserved `/a/<nonce>` namespace in the q resolver.**

`apps/run.qr/lambda/resolver/lib/parse-path.mjs` gains a fifth kind, intercepted
**before** the redirect branch exactly like `ctf` / `_flush` / `_og`, so no `Qr`
code can shadow it:

```js
// Reserved: single-use award claim. nonce = 2nd segment, verbatim (case kept).
if (first === "a") {
  if (segments.length < 2) return { kind: "empty", query };
  return { kind: "award", nonce: segments[1], query };
}
```

`respond.mjs` gains `buildClaimHandoff({ nonce })` — a sibling of the existing
`buildCtfHandoff`, same `no-store` 302:

```
https://run.defcon.run/use1/ctf/claim?nonce=<nonce>
```

`resolve.mjs` wires the branch. **No DynamoDB read** — this is a pure lexical
rewrite, so it cannot fail, throttle, or add latency. The nonce is never logged
(mirrors `ctfHandoffLog`, which structurally cannot carry the submitted value).

**A2. Shorter nonce.** `createPending` currently uses `crypto.randomUUID()`
(36 chars). Add an injectable generator producing 12 Crockford-base32 lowercase
chars. Lowercase-only alphabet + a lowercasing normalize on the claim-page lookup
makes the link resilient to case-mangling by a client. `CtfPending` is keyed by
the nonce string, so old UUID rows coexist and TTL out naturally.

**A3. Mint-by-challenge.** `POST /api/internal/ctf/mint` accepts
`{ challenge: "ricky" }` in addition to the existing `{ ghost: "ghost.goldstein" }`:

- resolve via `getCtf(challenge)` — a single **GetItem** (`qr-admin.ts:252`)
- `createPending()` gains a `flagHash` option that bypasses `hashAnswer(guess)`
  and stores the row's own `answerHash` directly as `submittedFlagHash`

No raw flag code needs to exist anywhere for this path. It works because
`judgeSolve` compares `verifyAnswerHash(guessHash, ctf.answerHash)` for
`answerType: "static"` (`ctf-judge.ts:449`).

**A4. Kill the scan on the persona path.** The flag-challenge blob gains an
optional explicit `challenge` field per ghost. When present, mint uses GetItem;
when absent it falls back to the existing answerHash-match over `listCtf()`.
This is why the scan exists at all — persona challenge names don't uniformly
derive from fleet ids (`grace-hopper` ↔ `ghost.hopper`).

**A5. Ricky's mint** happens at song end, inside the playback goroutine, immediately
before the award sends. Result is cached on the `LyricsResponded` entry — widened
from `map[uint32]time.Time` to `map[uint32]*lyricsSession{ at time.Time; url string }`.
The access pattern `LyricsResponded[fleet][key]` is preserved (asserted by
`reply_retry_test.go:270`). Combined with the 10-min cooldown: ≤1 mint per radio
per 10 min. A mint failure falls back to `MESHTK_RICKY_FALLBACK_URL` — a player is
never left empty-handed.

**A6. Rotation.** An operator script (modeled on `setup-ricky-flag.mts`, DRY-RUN
by default, `--confirm` to write):

1. generate a fresh unguessable code, write its `answerHash` to the `ricky` `Ctf`
   row (preserving `solveCount` / `createdAt` / `enabled` — never reset the
   ordinal allocator)
2. delete the `Qr` row `$run#code_rick_astley_loves_desert_running`
3. delete the static S3 interstitial object behind `defcon.run/qr/rick_astley_loves_desert_running`
4. print the new claim URL **once** for the operator to place in SOPS as
   `MESHTK_RICKY_FALLBACK_URL` (never logged, never committed)

The old `v=nggyu-…` code goes dead the moment step 1 lands.

### Workstream B — Delivery reliability

**B1. Drop the `/qr/` LRC entry.** The base64 LRC in `meshtk.dc34.yaml` has 59
entries; index 58 is `[03:30.34]/qr/rick_astley_loves_desert_running`. Removing it
leaves 58 numbered lines ending on the true closing lyric:

```
57: Never gonna say goodbye
58: Never gonna tell a lie and hurt you

🏆 You got rickrolled. Here's your award:
https://q.defcon.run/a/k7m3q9x2wr4t
```

⭐ Any `meshtk.dc34.yaml` edit requires re-running
`node scripts/sync-meshtk-fleet.mjs` or the run.human byte-parity test
(`mesh-ghosts.test.ts`) goes red.

**B2. Reliable-send sites go 1 → 3.** `reply_retry_test.go:204` currently asserts
**exactly 1** `sendPKIReplyReliable` call site in `handleLyricsChat` (retrying ~60
lines would drown the channel). Updated deliberately to assert **exactly 3**:

| | today | after |
|---|---|---|
| line 01 | single-shot (drops observed live) | **reliable** |
| lines 02–58 | single-shot | single-shot (unchanged) |
| award message ×2 | — | **reliable** |

The lyric body stays single-shot; the flag no longer rides a lyric line, so the
final lyric does not need the reliable path.

**B3. Performance semaphore.** A buffered channel sized by
`MESHTK_LYRICS_MAX_CONCURRENT` (default 12) gates the playback goroutine. Over
cap the requester gets a single-shot reply in the same style as the existing
encore notice — never a silent blackhole:

```
🎤 Stage is full — catch the next set in a few.
```

Worst-case aggregate is bounded to ~3.3 msg/s (12 × 58 msgs / 214s) regardless
of crowd size.

### Workstream C — Guardrail fail-closed

**C1.** Confirm the currently-deployed `MESHTK_GUARDRAIL_FAILMODE` value in the
run.mqtt ghosts container **before** changing anything (the code default is
`open`; the deployed value has not been read).

**C2.** Set `MESHTK_GUARDRAIL_FAILMODE=closed` in the ghosts container env
(`apps/run.mqtt/.../service.hcl`).

**C3.** Replace the fail-closed silent drop with a graceful in-persona line, so a
sidecar outage degrades visibly rather than mysteriously:

```
👻 static on the line — say again?
```

**C4.** CloudWatch alarm on guardrail-sidecar health. The task already declares
`depends_on` HEALTHY; this adds the alerting so fail-closed is observable.

## Security / hygiene

- The nonce and the derived/rotated flag codes are **never logged** — at the
  resolver (`logline.mjs` structurally cannot carry a submitted value), in the
  mint route, or in meshtk (`claimlink.go` documents this rule already).
- The rotated ricky code exists in exactly two places: the `Ctf` row's
  `answerHash` (a salted hash, not the code) and SOPS→SSM as the fallback URL.
  It is never published on any page.
- `/a/` is reserved lexically **before** code lookup, so an operator can never
  mint a short link that shadows the award namespace.
- Award links stay single-use via `claimPending`'s delete, backstopped by
  `judgeSolve`'s conditional-put `CtfSolve` — even a lost delete cannot
  double-credit.

## Verification plan

1. **Unit — resolver:** new `parse-path` kind (`/a/<nonce>`, missing nonce → empty,
   `/a` alone → empty); `buildClaimHandoff` location + `no-store`; `resolve` wiring;
   assert the award branch performs **no** `getQr` call.
2. **Unit — run.human:** mint-by-challenge returns a `/a/<nonce>` URL and performs
   **zero** scans; `createPending({flagHash})` stores the row's `answerHash`
   verbatim; short-nonce generator alphabet + length; claim-page nonce lowercasing.
3. **Unit — meshtk (Go):** exactly 3 `sendPKIReplyReliable` sites in
   `handleLyricsChat`; semaphore admits ≤ N and the over-cap path **replies**;
   mint cached once per requester per cooldown; mint failure falls back to
   `MESHTK_RICKY_FALLBACK_URL`.
4. **Byte-parity:** `mesh-ghosts.test.ts` green after `sync-meshtk-fleet.mjs`.
5. **Prod probe (post-deploy):** `q.defcon.run/a/probe` → 302 to
   `…/ctf/claim?nonce=probe`; the 8 already-live short codes `b c d f g h p r`
   still 302 to their existing destinations (**regression guard** — this is how
   the `/c/` collision was caught).
6. **UAT (Kurt, hardware):** DM ricky → song plays 58 numbered lines → award DM
   arrives tappable → tap while signed in awards 100 → second tap no-ops → the
   old `defcon.run/qr/rick_astley_loves_desert_running` link is dead.

## Pre-flight checks (must run before implementation)

- [ ] Read the **deployed** `MESHTK_GUARDRAIL_FAILMODE` value (C1) — do not assume.
- [ ] Confirm no `Qr` row exists with code `A` (probed 404 on 2026-07-31; re-probe
      at implementation time, since codes are minted continuously).
- [ ] Confirm ricky's live `Ctf` row `challenge` slug is exactly `ricky`
      (`ctf-seed-rows-dc34.ts:28` warns the slug was unconfirmed at seed time).

## Out of scope (deliberate)

- **LLM rate limiting / Bedrock cost ceiling.** `llm.go` has no limiter of any
  kind; the only throttle anywhere is the 30s `requestDedupWindow`, which only
  collapses byte-identical repeats. Every unlocked DM is a Bedrock Converse call
  with no per-radio budget and no global concurrency cap — **abuse and spend are
  both unbounded**. Raised during design and consciously deferred by Kurt.
  → follow-up todo.
- **Per-bot scoping of the mint internal secret** (`mint/route.ts:33`).
  → follow-up todo.
- **cac1 deployment.** The bots remain single-region (use1). → follow-up todo.
- The payphone lines are unchanged — they stay on TOTP, and Kurt's external
  phone system is not touched.

## Deploy notes

- meshtk changes go to `~/working/meshtk` upstream first; the monorepo
  `apps/run.mqtt/meshtk` tree is a **tracked overlay** that build.sh applies over
  a fresh GitHub clone — untracked files are silently discarded by CI.
- Release via `buildpub.yml` (preferred; auto-merges the Release PR). The local
  `build.sh meshtk` path is known-broken.
- Resolver Lambda ships via its own terragrunt unit — not the run.mqtt release.
- Deploy is **always** GitHub Actions (`deploy.yml`); never local `terragrunt apply`.
