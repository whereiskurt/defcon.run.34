# Runner Social QR — short q.defcon.run links, mutual scan awards, rank flair, DC-jack egg

Date: 2026-07-22 · Status: APPROVED (Kurt) · Branch: `feat/runner-social-qr`
Sketches: `.planning/sketches/001-003` (winners: 001-B HUD Ring, 002-A Pin Rail, 003-D Reactor Tuned)

## Summary

Four layers, one PR:

1. **Short, region-agnostic runner QR** — `https://q.defcon.run/r/<token16>` replaces
   `https://run.defcon.run/use1/r?h=<sha256>` in every runner QR (whoami, header
   dropdown, share cards, bib PDF). Region handling moves entirely to the resolver.
   QR drops from version 9 (53×53) to version 5 (37×37) at EC-H.
2. **Mutual scan award (DC33 port, modernized)** — scanning another runner's QR while
   signed in awards **both** parties 1 CTF point + 1 social point, once per unordered
   pair per Pacific day, scanner capped at 50 successful scans/day.
3. **Rank flair ("Reactor Tuned")** — the whoami QR levels up with **relative social
   rank** (percentile of the field, decays as others out-scan you): reactor ring,
   neon tube, fat fuzzy scanline, rank-reactive badge rail, gold ♛ LEADER №1 state,
   visible flair from TOP 50% with "NEXT //" unlock teasers.
4. **DC-jack easter egg** — hold (1.5s, glow-up cue from 200ms) or triple-tap the
   DC jack logo at the QR center → once-ever +10 social / +25 CTF.

## Layer 1 — Short QR via q.defcon.run

### Token
- `shortToken = hash.slice(0, 16)` of the existing per-user `RunUser.hash`
  (sha256 hex). Deterministic: site and bib can never disagree.
- New **`RunnerToken`** ElectroDB entity in run-human-electro (service `run`):
  pk `$run#token_<token>` sk `$runnertoken_1`, attrs `{ token, userId, hash }`.
  No GSI, no Terraform. Conditional-create; a 16-hex prefix collision fails loudly.
- Created: (a) at user creation alongside `eqr`; (b) **lazily ensured** whenever the
  internal user endpoint or whoami needs the token; (c) one-off backfill script for
  existing users (idempotent conditional puts, prod-write care per
  `project_bib_runhuman_identity_backfill` landmines).

### Resolver wiring (zero resolver code changes)
- Mint Qr row `code=r` (stored lowercase): `destination=https://run.defcon.run/r`,
  `appendParam=p`, `enabled=true`. Resolver already: uppercases path segment →
  pk lookup lowercased → `/r/<token>` resolves with `param=<token>` → enrich adds
  `?p=<token>` → `withRegion()` splices `/use1`. Net:
  `q.defcon.run/r/abc123…` → 302 `run.defcon.run/use1/r?p=abc123…`.
- **Protect the row**: run.human qr-admin `normalizeCode` additionally rejects `R`
  (create/delete via admin) so the code every printed bib depends on can't be
  clobbered; row managed by this feature only.
- Region control stays live-editable from `/admin/qr` (change destination host any
  time) — the QR itself never encodes region again.

### Payload switch (all QR emitters)
- `run.human buildQrPayload.ts` → `https://q.defcon.run/r/${token}` (+ parity test
  update; eqr template in `run-user.ts` for NEW users; existing stored `eqr` PNGs
  keep working via legacy `?h=`).
- `run.human /api/internal/user/[oidcSub]` → returns `shortToken` (lazily ensuring
  the RunnerToken row), keeps returning `hash`.
- `run.bib social-qr.ts` → builds the short URL from the endpoint's `shortToken`.
- `run.human admin-report runnerQrUrl()` → short URL.

## Layer 2 — Scan route + mutual award

### Route
- `(protected)/r/page.tsx` — accepts `?p=<token16>` (new) **and** `?h=<sha256>`
  (legacy: every stored eqr PNG and any pre-switch link). Anonymous visitors ride
  the existing protected-group signin bounce with callback back to `/r?...`.
- Server: `POST /api/social-scan` (session required; `assertNotLockedLive` with
  sub=`authUserId` per write-boundary convention). Validation order (DC33 order,
  DC34 rules):
  1. session → 401; missing/malformed token → 400
  2. resolve owner: RunnerToken.get(token) or RunUser byHash(h) → 404 unknown
  3. self-scan → 400 "You cannot scan your own QR code!" (🐰❌🐰)
  4. **pair-day dedup**: `SocialPair` row, pk unordered `pair_<minUserId>_<maxUserId>`,
     sk `day_<YYYY-MM-DD>` (**Pacific** midnight, matching strava_sync convention),
     conditional create → already exists = 409 "already connected today"
  5. **scanner daily cap**: `SocialQuota` pk user sk day, ADD count, >50 → 429
- On success (both parties): `socialScore +1`, `ctfScore +1` (+ CtfScoreEvent ledger
  row, challenge `social-scan`, bucket `<day>#<pairkey>` — visible in /admin
  leaderboard tooling), histogram update (Layer 3). Only the scanner consumes quota.
- UX: success card "Connected with <displayName>! 🐰🤝🐰 +1 point each", remaining
  daily scans, link to leaderboard; distinct friendly errors (self/dupe/cap), DC33
  copy as floor. CMS copy keys with code-default floor (copyOr pattern).

### Ordering note
Award writes are: conditional-create pair row (the idempotency gate) → then best-effort
apply both parties' score patches + ledger rows + histogram. Partial failure after the
gate logs loudly but does not roll back (con-scale pragmatism; scores are additive).

## Layer 3 — Social rank + Reactor Tuned flair

### Score & rank model
- `RunUser.socialScore` (number, default 0): +1 per scan award (each side), +10 egg.
  (This is award events, not strictly unique connects — pairs can re-connect daily.)
- **Rank = percentile of socialScore among users with socialScore > 0**, so flair
  *decays* relatively as the field climbs. Bands: LEADER (max score) · TOP 5% ·
  TOP 10% · TOP 25% · TOP 50% · entered (>0) · unranked (0).
- **Histogram aggregate** (no infra, no scans): single `SocialBoard` item
  (pk `$run#board_social`), map attr `h` of score-bucket → count, plus `total` and
  `max`. Award path does atomic ADDs (decrement old-score bucket, increment new).
  Percentile computed from the histogram; LEADER = holders of `max` (ties share it).
  Read path caches the item in-process ~60s. Fallback: if the item is missing or
  corrupt, rank renders as "entered" (flair floor) — never blocks the page.
- Sketch's fictional "1,204 field / RANK #n" readout maps to: `SOCIAL SCORE n ·
  TOP x% OF <total>` + trend is out of scope v1 (no history kept) — teaser line
  ("NEXT // …") ships, trend arrow deferred.

### Flair (whoami "Your Social QR" only, v1)
- New `SocialQrFlair` client component wrapping `StyledRunnerQr` — CSS port of
  sketch 003-D: reactor conic ring (faster spin per band), blurred neon-tube
  progress ring with level ticks, halo bloom, 18px blur(4px) translucent scanline
  (10/14px at lower bands; hard cap — inside EC-H budget with the ~6% knockout),
  readout + "NEXT // <band>: <unlock>" teaser, gold shift + ♛ SOCIAL LEADER chip
  at LEADER. Flair starts at TOP 50% (early gratification); >0 score = "entered"
  shows the rail + teaser only.
- **Badge rail** (002-A): hex pins under the QR — amber `BIB HOLDER` starter
  (bib purchasers, from existing bib-holder signal via internal bib lookup already
  used for print-names; if unavailable server-side, omit gracefully), earned
  milestone pins at **1 / 15 / 30 / 60 / 100 socialScore** (FIRST CONTACT /
  SOCIAL ENGINEER / MESH NODE / GHOST PROTOCOL / RABBIT LEGEND), ⚑ EGG badge,
  locked slots dashed. Badge glow escalates with band (drop-shadow on a wrapper —
  clip-path swallows box-shadow), breathes gold at LEADER.
- Header dropdown QR, wallpaper/share cards, bib PDF: **plain QR, no flair** (v1).

## Layer 4 — DC-jack easter egg

- Invisible ~84px circular hotspot over the center dcjack knockout in
  `SocialQrFlair`. Triggers: **hold 1.5s** (green charge ring appears at 200ms,
  swells until claim) or **triple-tap** (3 taps in 900ms). Both ship.
- `POST /api/social-egg`: session required, `EggClaim`-style conditional-create
  (pk user, once ever) → `socialScore +10`, `ctfScore +25` (+ ledger row, challenge
  `jack-egg`), histogram update. Repeat → "COVERT CHANNEL ALREADY DRAINED".
- Client: radial burst + toast "⚑ COVERT CHANNEL FOUND // +10 SOCIAL · +25 CTF",
  gold ⚑ EGG badge pops onto the rail. No visual cue before discovery, no CMS copy
  leak of the mechanic (per gpx-egg no-flag-leak convention).

## Entities (all run-human-electro, service `run`, no Terraform)

| Entity | pk | sk | purpose |
|---|---|---|---|
| RunnerToken | `$run#token_<t16>` | `$runnertoken_1` | token → userId |
| SocialPair | `$run#pair_<minId>_<maxId>` | `$socialpair_1#day_<d>` | pair-day dedup |
| SocialQuota | `$run#squota_<userId>` | `$socialquota_1#day_<d>` | 50/day scanner cap |
| SocialBoard | `$run#board_social` | `$socialboard_1` | score histogram, total, max |
| SocialEgg | `$run#segg_<userId>` | `$socialegg_1` | once-ever egg claim |

(Exact key shapes finalized against `entities/qr.ts` conventions during build;
`RunUser` gains `socialScore` attribute, default 0.)

## Testing & verification

- Vitest: token derivation/parity, scan judge (self/dupe-day/cap/PT-boundary/legacy-h
  vs p), histogram math (percentile, decrement/increment, LEADER ties), egg
  idempotency, qr-admin `r`-protection. Byte-parity guard updated for new payload.
- Playwright (local, cue-store style recipe): flair renders per band; egg hold +
  triple-tap + already-drained; jsQR decode of rendered flaired QR (scanline overlay
  present) at 220/640px — decode must MATCH.
- Live verify after deploy: `q.defcon.run/r/<mytoken>` (with `x-qr-test` header,
  token from SSM) → 302 `run.defcon.run/use1/r?p=…`; signed-out scan bounces
  through signin; two-account mutual award in prod (Kurt UAT for the second body).

## Rollout (order matters)

1. Merge PR → buildpub **run.human** use1 → Release PR → `deploy.yml` (worktree CI
   recipe) — ships `/r` route first so the destination exists.
2. Mint `r` Qr row (idempotent script, prod creds; Qr entity shape from
   `entities/qr.ts`). Verify resolver 302 immediately (`x-qr-test`).
3. Backfill RunnerToken rows for existing users (idempotent script).
4. buildpub **run.bib** use1 → Release → deploy (bib PDFs pick up short URL).
5. Optionally seed Ctf display rows (`social-scan`, `jack-egg`) for admin surfaces.

## Out of scope (v1)
Trend arrows (rank history), flair on share cards/wallpaper/dropdown, printed-bib
flair zone, cac1 (use1-only like everything else), DC33 accomplishment-record port
(ledger rows serve that role).
