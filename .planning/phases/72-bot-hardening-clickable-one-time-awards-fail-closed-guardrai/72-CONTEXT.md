# Phase 72: Bot Hardening — Clickable One-Time Awards, Fail-Closed Guardrails, Lyric Delivery - Context

**Gathered:** 2026-07-31
**Status:** Ready for planning
**Source:** PRD Express Path (`docs/superpowers/specs/2026-07-31-bot-hardening-design.md`, commit `e0ff5643`)

<domain>
## Phase Boundary

Every mesh bot award becomes a **short, clickable, genuinely single-use URL**, and the
two hardening gaps sitting next to that mechanic are closed: guardrails that currently
fail **open**, and a lyric stream where only the last line is delivered reliably.

The user-facing shape mimics the payphone awards — call a phone, get texted a tappable
link — but with a single-use nonce instead of a rotating TOTP, so a forwarded link
awards at most once.

**In scope:** the q.defcon.run resolver Lambda, run.human's mint/pending/claim seam,
meshtk's lyric + guardrail paths, `meshtk.dc34.yaml`, the run.mqtt ghosts container env,
and one operator rotation script.

**Not in scope:** the payphone lines (they stay on TOTP; Kurt's external phone system is
untouched), LLM rate limiting, per-bot mint-secret scoping, cac1 deployment.
</domain>

<decisions>
## Implementation Decisions

All of the following are LOCKED — confirmed by Kurt during design.

### Award mechanic
- Single-use **nonce**, not a rotating TOTP. A forwarded link awards at most once.
- URL shape: `https://q.defcon.run/a/<nonce>` (35 chars, down from 79).
- Reserved letter is **`a`** (award). ⭐ `/c/` was the original choice and was REJECTED:
  `q.defcon.run/c` is a LIVE short code resolving to `didhtp1`. Letters
  `b c d f g h p r` are all taken; `a e i j k l m n o q s t u v w x y z` were free
  as of 2026-07-31.
- Nonce: 12 chars, Crockford base32 **lowercase** (60 bits). Claim-page lookup must
  lowercase before matching so a case-mangling client still resolves.
- The `/a/` branch is a PURE LEXICAL REWRITE — it performs **no** DynamoDB read. This is
  load-bearing: it cannot fail, throttle, or add latency.
- Reserved namespaces are intercepted BEFORE the redirect branch (same as
  `_flush` / `_og` / `ctf`) so no `Qr` code can ever shadow `/a/`.

### Mint
- `POST /api/internal/ctf/mint` accepts `{ challenge }` in addition to `{ ghost }`.
- Challenge path resolves via `getCtf()` — a single **GetItem**. It MUST NOT use
  `listCtf()`, which is `Ctf.scan.go({ pages: "all" })`, a full-table scan currently
  running on every persona flag reveal.
- `createPending()` gains a `flagHash` option that bypasses `hashAnswer(guess)` and
  stores the row's own `answerHash` directly as `submittedFlagHash`. No raw flag code
  need exist anywhere. This works because `judgeSolve` compares
  `verifyAnswerHash(guessHash, ctf.answerHash)` for `answerType: "static"`.
- The persona path keeps its answerHash-match fallback but gains an OPTIONAL explicit
  `challenge` in the flag-challenge blob; when present it is a GetItem. The scan exists
  because persona challenge names don't uniformly derive from fleet ids
  (`grace-hopper` ↔ `ghost.hopper`) — do not "simplify" that away.
- TTL: env-tunable `BOT_CLAIM_LINK_TTL_SECONDS` = 3600 (60 min), applied to ricky AND
  all 8 persona ghosts.

### Ricky
- Mint happens at **song end**, inside the playback goroutine, immediately before the
  award sends.
- Result is cached on the `LyricsResponded` entry — widened from `map[uint32]time.Time`
  to a small struct carrying `at` + `url`. The access pattern
  `LyricsResponded[fleet][key]` MUST be preserved (asserted by `reply_retry_test.go`).
- With the 10-min per-requester cooldown that caps minting at ≤1 per radio per 10 min.
- Mint failure falls back to `MESHTK_RICKY_FALLBACK_URL` — a player is never left
  empty-handed.

### Rotation (destructive, prod)
- Operator script, DRY-RUN by default, `--confirm` to write. Modeled on
  `scripts/setup-ricky-flag.mts`.
- Writes a fresh `answerHash` to the `ricky` `Ctf` row, PRESERVING `solveCount`,
  `createdAt`, and `enabled` — never reset the ordinal allocator.
- Deletes the `Qr` row `$run#code_rick_astley_loves_desert_running`.
- Deletes the static S3 interstitial behind
  `defcon.run/qr/rick_astley_loves_desert_running`.
- Prints the new claim URL ONCE for the operator to place in SOPS as
  `MESHTK_RICKY_FALLBACK_URL`. Never logged, never committed.

### Delivery
- Drop the `/qr/` LRC entry from `meshtk.dc34.yaml`. The song then ends at **58**
  numbered lines on the real closing lyric ("Never gonna tell a lie and hurt you"),
  followed by two reliable award DMs.
- Promote **line 01** to `sendPKIReplyReliable` (drops observed live, root-caused
  downstream of MQTT — iOS proxy → BLE, NOT a QoS0 reconnect gap).
- `reply_retry_test.go` moves from exactly-1 to **exactly-3** reliable sites. This is a
  DELIBERATE guard-test change, not an accident. Lyric body stays single-shot —
  retrying ~60 lines would drown the channel.
- `MESHTK_LYRICS_MAX_CONCURRENT` semaphore, default 12. Over-cap replies
  "🎤 Stage is full — catch the next set in a few." — never a silent blackhole.
  Bounds worst case to ~3.3 msg/s (12 × 58 / 214s).

### Guardrails
- Flip `MESHTK_GUARDRAIL_FAILMODE` to `closed` in the ghosts container env.
- Replace the fail-closed silent drop with a graceful in-persona line.
- Add a CloudWatch alarm on guardrail-sidecar health.

### Claude's Discretion
- Exact file/module decomposition within each workstream.
- Test structure and naming (must match each project's existing conventions).
- Wording of the in-persona guardrail degradation line.
- Alarm thresholds/period for the sidecar health alarm.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design contract
- `docs/superpowers/specs/2026-07-31-bot-hardening-design.md` — the approved spec.
  Authoritative for every locked decision above.

### q.defcon.run resolver (Workstream A)
- `apps/run.qr/lambda/resolver/lib/parse-path.mjs` — reserved-namespace parser; add the
  `award` kind here, before the redirect branch.
- `apps/run.qr/lambda/resolver/lib/respond.mjs` — `buildCtfHandoff` is the sibling to
  model `buildClaimHandoff` on; `DEFAULT_REGION = "use1"`, `withRegion` splices region.
- `apps/run.qr/lambda/resolver/lib/resolve.mjs` — the pure orchestration seam; NEVER
  THROWS and NO SIDE EFFECTS are load-bearing properties.
- `apps/run.qr/lambda/resolver/lib/logline.mjs` — log builders that structurally cannot
  carry a submitted value; the nonce must never be logged.
- `apps/run.qr/lambda/resolver/tests/` — existing test conventions (vitest).
- `infra/terraform/live/site/region/us-east-1/qr-resolver/` — the live terragrunt unit
  (the module README claiming no live unit exists is STALE).

### run.human mint / claim (Workstream A)
- `apps/run.human/webapp/src/app/api/internal/ctf/mint/route.ts` — the mint endpoint.
- `apps/run.human/webapp/src/lib/ctf-pending.ts` — `createPending` / `claimPending`,
  `CLAIM_LINK_TTL_SECONDS`, the hygiene + idempotency contracts.
- `apps/run.human/webapp/src/lib/qr-admin.ts` — `listCtf` (line ~229, the scan to avoid)
  and `getCtf` (line ~252, the GetItem to use).
- `apps/run.human/webapp/src/lib/ctf-judge.ts` — `verifyAnswerHash(guessHash, ctf.answerHash)`.
- `apps/run.human/webapp/src/app/(ctf)/ctf/claim/` — the claim page + OG route.
- `apps/run.human/webapp/scripts/setup-ricky-flag.mts` — the model for the rotation script
  (conditional puts, never clobber, never print raw codes).

### meshtk (Workstreams B + C)
- `apps/run.mqtt/meshtk/internal/app/fleet/cmd.go` — `handleLyricsChat`,
  `sendPKIReply`, `numberLyric`, `lyricsEncoreCooldown`, `requestDedupWindow`.
- `apps/run.mqtt/meshtk/internal/app/fleet/claimlink.go` — `mintClaimURL`,
  `getOrMintRevealURL`, `sendFlagReveal`; documents the never-log rule.
- `apps/run.mqtt/meshtk/internal/app/fleet/guard.go` — the failmode branch.
- `apps/run.mqtt/meshtk/internal/app/fleet/reply_retry_test.go` — the exactly-1 guard
  assertion to update deliberately.
- `apps/run.mqtt/meshtk/meshtk.dc34.yaml` — `ghost.ricky` fleet + base64 LRC blob.

### Infra
- `apps/run.mqtt/.../service.hcl` — ghosts container env (guardrail failmode lives here).
</canonical_refs>

<specifics>
## Specific Ideas

**Pre-flight checks — ALL PASSED 2026-07-31, re-verify before implementing:**
- prod `MESHTK_GUARDRAIL_FAILMODE = open` on task def `run-mqtt-use1-dc34:122`
  (container name is `run-mqtt-ghosts`, NOT `ghosts`).
- `Qr` code `A`/`a` absent — namespace free.
- ricky `Ctf` row: `challenge=ricky`, `static`, 100pts, 24h, enabled, **`solveCount=0`**
  (so rotation has zero blast radius — nobody has ever claimed it).
- `MESHTK_RUN_INTERNAL_URL = https://run.defcon.run/use1` is already wired.

**Regression guard (MANDATORY in the verification plan):** after any resolver change,
re-probe that `b c d f g h p r` still 302 to their existing destinations. This is
exactly how the `/c/` collision was caught.

**LRC facts:** the blob has 59 entries; index 58 is
`[03:30.34]/qr/rick_astley_loves_desert_running`. `numberLyric(i)` prints `i+1`.
Removing index 58 yields 58 numbered lines ending at `58: Never gonna tell a lie and hurt you`.

**Landmines carried from prior phases:**
- ANY `meshtk.dc34.yaml` edit requires `node scripts/sync-meshtk-fleet.mjs` or the
  run.human byte-parity test (`mesh-ghosts.test.ts`) goes red.
- meshtk code changes go UPSTREAM to `~/working/meshtk` first; the monorepo
  `apps/run.mqtt/meshtk` tree is a TRACKED overlay that build.sh applies over a fresh
  GitHub clone — untracked files are silently discarded by CI.
- `chatHardLimit = 200` (DATA_PAYLOAD_LEN 233); there is no length check in the send path.
- Release via `buildpub.yml` (auto-merges the Release PR); local `build.sh meshtk` is
  known-broken. Deploy is ALWAYS GitHub Actions, never local `terragrunt apply`.
- `env.local.sh` must exist at the worktree root before any release (already copied).
</specifics>

<deferred>
## Deferred Ideas

Explicitly OUT of this phase by Kurt's decision:

- **LLM rate limiting / Bedrock cost ceiling.** `llm.go` has no limiter of any kind; the
  only throttle anywhere is the 30s `requestDedupWindow`, which only collapses
  byte-identical repeats. Every unlocked DM is a Bedrock Converse call with no per-radio
  budget and no global concurrency cap — **abuse and spend are both unbounded.** Raised
  during design and consciously deferred. → follow-up todo.
- **Per-bot scoping of the mint internal secret** (`mint/route.ts` uses one shared
  secret that can mint any flag). → follow-up todo.
- **cac1 deployment.** Bots stay single-region (use1). → follow-up todo.
- The payphone lines stay on TOTP — unchanged.

</deferred>

---

*Phase: 72-bot-hardening-clickable-one-time-awards-fail-closed-guardrai*
*Context gathered: 2026-07-31 via PRD Express Path*
