# Runner Social QR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the four-layer runner social QR feature (short q.defcon.run links, mutual scan awards, percentile rank flair, DC-jack egg) per `docs/superpowers/specs/2026-07-22-runner-social-qr-design.md`, then PR → merge → release run.human + run.bib → prod data ops → live verify.

**Architecture:** All new logic lives in run.human webapp as pure, store-injectable libs (`social-scan`, `social-rank`) mirroring the `ctf-judge` seam pattern, with thin API routes on top. New ElectroDB entities on run-human-electro (no Terraform). The resolver is untouched — the `r` Qr row (minted post-deploy) uses the existing `appendParam` mechanism. Flair is a client component wrapping the existing `StyledRunnerQr`, driven by fields added to `/api/user`.

**Tech Stack:** Next.js 16 / React 19 / ElectroDB / vitest (run.human via `npx vitest run`, Node 23.6.0; run.bib `npm test`, Node 22.12.0 + `@rolldown/binding-darwin-arm64` locally).

## Global Constraints

- ElectroDB entities: `service: "run"`, `version: "1"`, table `ELECTRO_TABLE`, client `electroClient` from `./client` — follow `src/entities/qr.ts` shape exactly.
- Session: `const session = await auth()` (`@auth`); user id = `session.user.id`; lockout check = `assertNotLockedLive(session.user.authUserId)` → 403 (`src/lib/live-lockout.ts`).
- Day bucket: fixed PT offset `-7h` (August 2026 is all PDT; matches run.gpx `con-days.ts` convention): `new Date(nowMs - 7*3600_000).toISOString().slice(0,10)`.
- Awards: scan = +1 `socialScore` +1 `ctfScore` each party; egg = +10/+25, once ever. Pair dedup = unordered pair per PT day. Scanner cap 50/day (only scanner charged).
- Short URL: `https://q.${SITE_DOMAIN}/r/${hash.slice(0,16)}`. Legacy `?h=<sha256>` must keep working.
- CMS copy via `copyOr(key, fallback)` pattern; no copy leaks the egg mechanic.
- Scanline overlay ≤18px @ 300px card, translucent (EC-H budget).
- Commit after every task; suite green before each commit.

---

### Task 1: PT day helper + RunnerToken entity/lib

**Files:**
- Create: `apps/run.human/webapp/src/lib/social-day.ts`
- Create: `apps/run.human/webapp/src/entities/runner-token.ts`
- Test: `apps/run.human/webapp/src/lib/__tests__/social-day.test.ts`, `src/entities/__tests__/runner-token.test.ts`

**Interfaces (Produces):**
- `socialDay(nowMs: number): string` — `YYYY-MM-DD` PT(-7).
- `shortTokenFromHash(hash: string): string` — `hash.slice(0, 16)`, throws on non-64-hex input.
- `RunnerToken` entity: primary pk `["token"]`, sk `[]`; attrs `token`, `userId`, `hash`, `createdAt`.
- `ensureRunnerToken(userId: string, hash: string): Promise<string>` — conditional-create (ignore "already exists"), returns token.
- `getUserIdByToken(token: string): Promise<{userId: string, hash: string} | null>`.

Tests: day boundary (`2026-08-06T06:59Z` → `2026-08-05`; `07:00Z` → `2026-08-06`); token derivation + rejection of short/non-hex; RunnerToken `.create(...).params()` key shape snapshot (`pk: "$run#token_<t>"`, `sk: "$runnertoken_1"`).

### Task 2: SocialBoard histogram + rank bands (`social-rank.ts`)

**Files:**
- Create: `apps/run.human/webapp/src/lib/social-rank.ts` (+ `SocialBoard` entity inside `src/entities/social.ts` with `SocialPair`, `SocialQuota`, `SocialEgg`)
- Test: `src/lib/__tests__/social-rank.test.ts`, `src/entities/__tests__/social-entities.test.ts`

**Interfaces (Produces):**
- Entities (`src/entities/social.ts`): `SocialPair` pk `["pairKey"]` sk `["day"]`; `SocialQuota` pk `["userId"]` sk `["day"]` attr `count:number`; `SocialEgg` pk `["userId"]` sk `[]`; `SocialBoard` pk `["boardId"]` sk `[]` attrs `hist: Record<string,number>` (score→count map, stored as `any` map), `total:number`, `max:number`.
- `pairKey(a: string, b: string): string` — `[a,b].sort().join("_")`.
- Pure: `computeBand(score: number, board: {hist, total, max} | null): Band` where `Band = { tier: 'none'|'entered'|'top50'|'top25'|'top10'|'top5'|'leader', label: string, total: number, pct: number|null }`. Percentile = share of scored users with score ≤ mine. LEADER ⇔ `score === max && score > 0`. Null/empty board + score>0 → `entered`.
- `applyScoreDelta(userId, oldScore, newScore): Promise<void>` — atomic ADDs on `SocialBoard` item (`hist.<old> -1` when oldScore>0, `hist.<new> +1`, `total +1` only when oldScore===0), recompute `max` opportunistically (SET if newScore>stored max). Board pk fixed `boardId:"social"`. Best-effort: catch + console.error, never throw to caller.
- `getBoardCached(): Promise<Board|null>` — module-level 60s cache, fail-null.

Tests: band math table (empty board, single user, ties at max ⇒ both leader, top50/25/10/5 boundaries with a 100-user synthetic hist), pairKey ordering, entity key shapes.

### Task 3: Scan judge engine (`social-scan.ts`)

**Files:**
- Create: `apps/run.human/webapp/src/lib/social-scan.ts`
- Test: `src/lib/__tests__/social-scan.test.ts`

**Interfaces:**
- Consumes: Task 1 (`socialDay`, token lookup), Task 2 (`pairKey`, `applyScoreDelta`).
- Produces:
```ts
export type ScanStore = {
  resolveOwnerByToken(token: string): Promise<{userId: string; displayName?: string; socialScore?: number} | null>;
  resolveOwnerByHash(hash: string): Promise<same | null>;
  getScanner(userId: string): Promise<{userId: string; displayName?: string; socialScore?: number} | null>;
  claimPairDay(pk: string, day: string): Promise<boolean>;      // conditional create; false = exists
  bumpQuota(userId: string, day: string): Promise<number>;      // ADD count 1, return new count
  award(userId: string, social: number, ctf: number): Promise<void>; // RunUser.patch add socialScore/ctfScore
  ledger(challenge: string, user: string, bucket: string, points: number): Promise<void>; // CtfScoreEvent.create, swallow dupes
  scoreDelta(userId: string, oldScore: number, newScore: number): Promise<void>;
};
export const DAILY_SCAN_CAP = 50;
export type ScanResult =
  | { ok: true; ownerName: string; remainingToday: number }
  | { ok: false; code: 'bad_token'|'not_found'|'self'|'already_today'|'cap'; };
export async function judgeScan(
  input: { scannerId: string; token?: string; hash?: string; nowMs: number },
  store: ScanStore,
): Promise<ScanResult>;
export const defaultScanStore: ScanStore;  // ElectroDB impl
```
- Order: validate token/hash form → resolve owner (`not_found`) → self → `claimPairDay` (`already_today`) → `bumpQuota` (>50 ⇒ `cap`; pair row already burned — acceptable, prevents cap-probing) → award both (+1/+1), ledger rows challenge `social-scan` bucket `<day>#<pairKey>`, scoreDelta both. Award failures post-claim: log, still return ok.

Tests (fake in-memory store): happy path both parties credited; self; same pair same day (either direction) blocked; next day allowed; 51st scan `cap`; legacy hash path; malformed token; ledger bucket format.

### Task 4: API routes `/api/social-scan` + `/api/social-egg`

**Files:**
- Create: `apps/run.human/webapp/src/app/api/social-scan/route.ts`, `src/app/api/social-egg/route.ts`
- Modify: `src/lib/social-scan.ts` (export egg helper `claimEgg(userId, store)` reusing store seam; +10/+25, `SocialEgg` conditional create, ledger `jack-egg` bucket `once`)
- Test: extend `social-scan.test.ts` (egg idempotency).

Routes (thin): `auth()` → 401; `assertNotLockedLive(session.user.authUserId)` → 403; parse body `{p?, h?}` / `{}`; call engine with `session.user.id`; map ScanResult codes → 400/404/409/429 + friendly `message`; success 200 `{ownerName, remainingToday}` / `{social:10, ctf:25}`.

### Task 5: Short payload switch (run.human emitters)

**Files:**
- Modify: `src/components/qr/buildQrPayload.ts` — `buildQrPayload(hash)` → `` `https://q.${SITE_DOMAIN}/r/${shortTokenFromHash(hash)}` `` (keep signature; import from `social-day`? no — token helper lives in `src/lib/short-token.ts`? Keep in `social-day.ts`? → put `shortTokenFromHash` in its own tiny `src/lib/short-token.ts` in Task 1 if client-import concerns arise; it is pure string code, safe for client bundles).
- Modify: `src/entities/run-user.ts:223` eqr template → same short URL; add `ensureRunnerToken(userId, hash)` call after `RunUser.create` in `getUserOrNew`.
- Modify: `src/lib/admin-report.ts` `runnerQrUrl()` → short URL.
- Modify tests: `buildQrPayload.test.ts` byte-parity now asserts `https://q.defcon.run/r/<first16>`; `renderStyledQr.test.ts`/`composeCards` untouched (payload-agnostic).

### Task 6: Internal endpoint + run.bib

**Files:**
- Modify: `src/app/api/internal/user/[oidcSub]/route.ts` — response adds `shortToken` (via `ensureRunnerToken(user.userId, user.hash)` lazy, try/catch → omit on failure).
- Modify: `apps/run.bib/webapp/src/lib/social-qr.ts` — `getSocialQrHash` also reads `shortToken`; `buildSocialQrUrl({hash, shortToken})` → `https://q.${domain}/r/${shortToken ?? hash.slice(0,16)}`; update callers + `src/__tests__/social-qr.test.ts` expectations.
- Run run.bib suite (`npm test`, Node 22.12).

### Task 7: `/api/user` social fields + qr-admin `r` protection

**Files:**
- Modify: `src/app/api/user/route.ts` GET — add `social: { score, band, total, badges: {bibHolder, egg}, remainingToday }` using `getRunUser` (socialScore attr — add `socialScore {type:"number", default:()=>0}` to RunUser attributes), `computeBand(score, await getBoardCached())`, `getRunnerCode(...) !== null`, `SocialEgg` existence, quota count for today.
- Modify: `src/lib/qr-admin.ts` — `RESERVED_CODES` adds `"r"` (protects the resolver row).
- Tests: qr-admin reserved test; band integration smoke via mocked entities if pattern exists, else rely on lib tests.

### Task 8: `/r` scan page

**Files:**
- Create: `src/app/(social)/layout.tsx` (minimal: providers/session wrapper copied from `(ctf)` group layout, NO bounce) and `src/app/(social)/r/page.tsx` + `src/app/(social)/r/ScanClient.tsx`.

`ScanClient` ('use client'): reads `p`/`h` from `useSearchParams`; `useSession()`:
- `unauthenticated` → card "Sign in to connect 🐰" + auto `signIn("run.defcon.run", { callbackUrl: currentUrl })` (mirror `(ctf)/ctf/claim/ClaimClient.tsx:63` pattern, incl. region-prefixed callback).
- `authenticated` → one-shot POST `/api/social-scan` (`claimAttemptRef` guard, DC33 pattern); render success card ("Connected with <name>! 🐰🤝🐰 +1 point each", remaining scans, leaderboard link) or per-code errors (self 🐰❌🐰 / already_today "Already connected today — find new rabbits!" / cap 🚫 / not_found). Copy via `copyOr('socialqr.*', fallback)`.

### Task 9: SocialQrFlair (Reactor Tuned) + egg interaction + whoami integration

**Files:**
- Create: `src/components/qr/flairBands.ts` (pure: band → visual params {reactorOpacity, spinSecs, scanH, scanBlur, glowLevel, gold, teaser}) + test.
- Create: `src/components/qr/SocialQrFlair.tsx` ('use client') — CSS-module-free inline Tailwind + `<style jsx>`-less approach: a scoped `<style>` block ported from `.planning/sketches/003-hud-glow-leader-rank/index.html` variant D (reactor conic ring, neon-tube SVG ring w/ ticks, halo, scanline, leader chip, badge rail with `bglow` wrapper, readout + "NEXT //" teaser). Props: `{ hash, eqrFallback, social: {score, band, total, badges, eggClaimed}, copy }`. Egg: 84px circular hotspot over center; pointer hold 1.5s (cue at 200ms, press-ring anim 1.3s) OR 3 taps <900ms → POST `/api/social-egg` → burst + toast + EGG badge + local state; repeat → "ALREADY DRAINED". Gold shift via CSS var when `band.tier==='leader'`.
- Modify: `(protected)/whoami/page.tsx` — replace bare `StyledRunnerQr` block with `SocialQrFlair` fed from `userData.social` (UserData type + copy keys `socialqr.*`).
- Badge catalog: BIB HOLDER (amber, `badges.bibHolder`), milestones at socialScore 1/15/30/60/100 (FIRST CONTACT/SOCIAL ENGINEER/MESH NODE/GHOST PROTOCOL/RABBIT LEGEND), ⚑ EGG. Locked = dashed.
- Tests: `flairBands.test.ts` full band table; component compiles via existing tsc/lint gates (no RTL in repo).

### Task 10: Ops scripts

**Files:**
- Create: `apps/run.human/webapp/scripts/mint-r-qr.mts` — idempotent: `Qr.get({code:'r'})`; absent → `Qr.create({code:'r', type:'redirect', destination:'https://run.defcon.run/r', enrich:{appendParam:'p'}, enabled:true, owner:'system', notes:'runner social QR — DO NOT DELETE'})` (match Qr entity attr names exactly — inspect `enrich`/appendParam storage shape used by resolver `rules.mjs`/`enrich.mjs` and admin `QrForm` before writing; `--dry-run` prints params only).
- Create: `apps/run.human/webapp/scripts/backfill-runner-tokens.mts` — scan `RunUser` (paged), for each with `hash` → `ensureRunnerToken`; `--dry-run` counts; logs collisions loudly.
- Both use `AWS_PROFILE=dc34-application` ambient creds + `RUN_ELECTRO_DBNAME` env, tsx runner like `seed-ctf-otp.mts` precedent.

### Task 11: Quality gates + PR

- `npx vitest run` (human, Node 23.6) all green; `npm test` (bib, Node 22.12) green; `npm run lint` + `npx tsc --noEmit` + `npm run build` in both webapps.
- Push branch, `gh pr create` (spec + sketch summary in body), admin-merge per Kurt's pre-authorization (solo ruleset precedent PR #518).

### Task 12: Release + prod ops + live verify (worktree CI recipe)

1. buildpub run.human use1 → Release PR → `deploy.yml` us-east-1 `pr_number=<release PR>`; verify version live.
2. `mint-r-qr.mts` against prod; verify `curl -H "x-qr-test: $(aws ssm get-parameter --name /dc34/infra/use1/qr/test_token --with-decryption ...)" https://q.defcon.run/r/0123456789abcdef` → 302 `run.defcon.run/use1/r?p=0123456789abcdef`.
3. `backfill-runner-tokens.mts` (dry-run first, then live; count == user count).
4. buildpub run.bib use1 → Release → deploy.
5. Anonymous probe of `/use1/r` (redirect-to-signin behavior), signed-in UAT left to Kurt (mutual scan needs two humans).

## Self-review notes
- Spec coverage: L1→Tasks 1/5/6/10/12; L2→3/4/8; L3→2/7/9; L4→4/9. Rollout order preserved (human deploy before `r` mint before bib).
- `shortTokenFromHash` placement: `src/lib/short-token.ts` (client-safe, no node imports) — Task 1 owns it; Tasks 5/6 import it.
- RunUser gains `socialScore` attr in Task 7 but engine (Task 3) patches it — ElectroDB `.add` on undeclared attr fails ⇒ **add the attribute in Task 1** instead. (Fixed: Task 1 also modifies `run-user.ts` attributes with `socialScore {type:"number", default:()=>0}`.)
