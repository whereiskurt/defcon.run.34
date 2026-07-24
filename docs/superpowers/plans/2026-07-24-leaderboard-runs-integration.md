# Leaderboard ↔ Runs Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Con-day-assigned gpx/Strava runs become self-healing leaderboard accomplishments (create AND delete), the drill-down shows social-scan rollups and named CTF captures, and admins get a per-user Recalculate — all without adding per-view DynamoDB reads.

**Architecture:** run.gpx owns run truth and pushes a full per-user reconcile (diff-first, polylines only for missing rows) to run.human's secret-gated internal API on every run mutation. run.human owns scoring: the reconcile endpoint diffs/deletes/creates Accomplishments through the existing single-writer rollup; the drill API joins social/CTF ledgers at read time behind a per-user 60s cache. Spec: `docs/superpowers/specs/2026-07-24-leaderboard-runs-integration-design.md`.

**Tech Stack:** Next.js 16 API routes, ElectroDB/DynamoDB, vitest, Svelte 5 (gpx-studio), Terragrunt env wiring.

## Global Constraints

- A run earns a leaderboard entry **iff** it is an active, non-GLOBAL GpxFile with a `conDay` assigned. 1 point per run (`POINTS.gpx` / `POINTS.strava` = 1).
- Reconcile from user-facing routes is **best-effort**: any failure is swallowed; a leaderboard miss must never break a save/delete (existing T-50-06 contract).
- `updateRunUserActivityCounts` stays the SOLE writer of `activityScore`/`activityCounts`/`latestActivityAt`; reconcile only goes through `createAccomplishment`/`deleteAccomplishment`.
- Reconcile never touches `source: "checkin"` accomplishments.
- Internal endpoints gate on `x-internal-secret` BEFORE body parse; secrets never logged. Admin routes: every denial is a bare 404 (non-disclosure); `revalidateAdmin` takes `session.user.authUserId`, NOT `session.user.id`.
- Board list stays one `RunUser` scan per task per 60s; drill responses cached per-user 60s in-memory (LRU cap 500); viewing never writes. Cache masking rule: cache stores UNMASKED data; covert masking is applied per-request after cache read.
- Covert CTF lines: real challenge name only for the row's owner or an admin; others see "Covert flag".
- Copy string (exact): `Counts as a DEF CON accomplishment on the leaderboard`.
- Tests: run.human = `npx vitest run` + `npm run build` from `apps/run.human/webapp`. run.gpx = `source ~/.nvm/nvm.sh && nvm use 22.12.0 && npx vitest run` INLINE in one shell from `apps/run.gpx/webapp` (env does not persist between Bash calls).
- Work on branch `leaderboard-runs-sync`. Conventional commits. Never bare `git stash`; use `/bin/rm` not `rm`.
- New wire contracts (source of truth for every task):
  - `PUT /api/internal/accomplishment/reconcile` (run.human) body `{ oidcSub: string, runs: ReconcileRun[] }` where `ReconcileRun = { gpxFileId: string, source: "gpx"|"strava", stravaActivityId?: string }` → `{ ok: true, deleted: number, missing: string[] }` (missing = gpxFileIds needing a full POST).
  - `POST /api/internal/accomplishment` (run.human, existing) body gains optional `source: "gpx"|"strava"` (default "gpx"; if "strava", `stravaActivityId` required) and keeps optional `conDay`.
  - `POST /api/gpx/internal/reconcile` (run.gpx, new) body `{ sub: string }` → `{ ok: true, created: number, deleted: number }`.
  - Expected accomplishment id for a run: `strava#${stravaActivityId}` when `source==="strava"` and `stravaActivityId` is set, else `gpx#${gpxFileId}`.
  - Drill response (run.human) becomes `{ accomplishments: [...as today], social: { days: {day,count,points}[], egg: {points,at}|null }, ctf: {challenge,name,points,channel,at}[] }`.

---

### Task 1: run.human — `strava` joins the activity rollup + chips

**Files:**
- Modify: `apps/run.human/webapp/src/entities/run-user.ts` (~:133 activityCounts attr, :364 activityDelta, :395 updateRunUserActivityCounts, :459 RunUserItem)
- Modify: `apps/run.human/webapp/src/entities/accomplishment.ts` (:339, :385 rollup branches)
- Modify: `apps/run.human/webapp/src/lib/leaderboard-scoring.ts` (:30 ScorableUser, :52 totalCount)
- Modify: `apps/run.human/webapp/src/lib/leaderboard-data.ts` (:37/:56 counts shapes, :111 projection — add strava + socialScore)
- Modify: `apps/run.human/webapp/src/lib/leaderboard-ui.ts` (deriveCountChips)
- Tests: existing `run-user-activity.test.ts`, `leaderboard-scoring/…data/…ui` test files (extend in place)

**Interfaces:**
- Produces: `ActivitySource = "checkin"|"gpx"|"strava"` accepted end-to-end by `activityDelta`/`updateRunUserActivityCounts`; `activityCounts: {checkin,gpx,strava}`; `LeaderboardRow.socialScore: number`; `deriveCountChips` returns `[activity, social, ctf]` where `social = {key:"social", count: row.socialScore ?? 0, color:"secondary"}`.

- [ ] **Step 1: failing tests.** In `run-user-activity.test.ts` add: `activityDelta("strava", 1, true)` → `{scoreDelta:1,countKey:"strava",countDelta:1}`; decrement floors at 0 for strava. In the leaderboard-scoring test: `totalCount({activityCounts:{checkin:1,gpx:2,strava:3}})` → 6 (+ ctfSolves). In leaderboard-ui test: `deriveCountChips({activityCounts:{checkin:1,gpx:1,strava:2}, ctfSolves:1, socialScore:4})` → 3 chips `[{key:"activity",count:4,color:"success"},{key:"social",count:4,color:"secondary"},{key:"ctf",count:1,color:"warning"}]`. Run: `npx vitest run src/entities/run-user-activity.test.ts src/lib/leaderboard-ui.test.ts` — expect FAIL (type + assertion errors).
- [ ] **Step 2: implement.**
  - `run-user.ts`: activityCounts map gains `strava: { type: "number", default: () => 0 }` and default `() => ({ checkin: 0, gpx: 0, strava: 0 })`. Widen `activityDelta`/`updateRunUserActivityCounts` source type to `"checkin" | "gpx" | "strava"`; in the mutator, `nextCounts` spreads all three (`strava: currentCounts.strava ?? 0` before the `[countKey]` override). Widen `RunUserItem.activityCounts` and add nothing else.
  - `accomplishment.ts`: change both rollup guards `if (source === "checkin" || source === "gpx")` / `if (row.source === "checkin" || row.source === "gpx")` to always run (drop the guard — the enum already restricts to the three sources). Update the two block comments (strava is now wired).
  - `leaderboard-scoring.ts`: `ScorableUser.activityCounts` gains `strava?: number`; `totalCount` adds it.
  - `leaderboard-data.ts`: `LeaderboardUser` gains `socialScore?: number` and `activityCounts.strava?`; `LeaderboardRow` gains `socialScore: number` and `activityCounts.strava: number`; projection adds `strava: u.activityCounts?.strava ?? 0` and `socialScore: u.socialScore ?? 0`.
  - `leaderboard-ui.ts`: `CountChipColor = "success" | "secondary" | "warning"`; `CountChip.key = "activity" | "social" | "ctf"`; `CountChipSource` gains `strava?` + `socialScore?`; return `[activity(+strava), social, ctf]`.
- [ ] **Step 3: run the touched test files** — PASS. Then full `npx vitest run` from `apps/run.human/webapp`; fix any leaderboard-data/table snapshot fallout (chips render generically in `LeaderboardTable.tsx:367` — no component change needed here; if a test pins 2 chips, update it to 3).
- [ ] **Step 4: commit** `feat(human): strava runs join the activity rollup; social count chip`

### Task 2: run.human — create endpoint accepts `source: strava` + conDay

**Files:**
- Modify: `apps/run.human/webapp/src/lib/gpx-accomplishment-input.ts`
- Modify: `apps/run.human/webapp/src/app/api/internal/accomplishment/route.ts` (comment only — builder does the work)
- Test: `apps/run.human/webapp/src/lib/gpx-accomplishment-input.test.ts` (exists — extend)

**Interfaces:**
- Produces: `buildGpxAccomplishmentInput(body, userId)` where body may carry `source: "strava"`, `stravaActivityId: string`, `conDay: string`. For strava: `input.source="strava"`, `input.stravaActivityId` set, `points: POINTS.strava`, AND `input.gpxFileId` still recorded (metadata backpointer). Any other/absent source → exactly today's gpx behavior. Binding: `conDay` stays accepted-and-ignored on this endpoint (it already arrives in the wire payload for future use) — do not invent storage or a description for it.

- [ ] **Step 1: failing tests.** `buildGpxAccomplishmentInput({gpxFileId:"f1", name:"Run", completedAt:1, source:"strava", stravaActivityId:"987"}, "u1")` → `{source:"strava", points:1, stravaActivityId:"987", gpxFileId:"f1", …}`; same body WITHOUT stravaActivityId → throws `/stravaActivityId/`; `source:"ctf"` → treated as gpx (server-fix holds, LDBR-12); no source → gpx. Run the file — FAIL.
- [ ] **Step 2: implement** in the builder: `const source = body.source === "strava" ? "strava" : "gpx";` (add `source?: unknown; stravaActivityId?: unknown;` to `GpxAccomplishmentBody`); when strava, require a non-empty string `stravaActivityId` (throw otherwise), set `input.source`, `input.stravaActivityId`, `points: POINTS[source]`. `createAccomplishment` already keys the id off `stravaActivityId` for strava via `EXTERNAL_ID_FIELD` — no entity change.
- [ ] **Step 3: run file → PASS; commit** `feat(human): internal accomplishment endpoint accepts strava source`

### Task 3: run.human — reconcile diff lib, drill cache module, reconcile endpoint

**Files:**
- Create: `apps/run.human/webapp/src/lib/accomplishment-reconcile.ts` + `.test.ts`
- Create: `apps/run.human/webapp/src/lib/leaderboard-drill-cache.ts` + `.test.ts`
- Create: `apps/run.human/webapp/src/app/api/internal/accomplishment/reconcile/route.ts` + `route.test.ts`

**Interfaces:**
- Produces:
```ts
// accomplishment-reconcile.ts (PURE)
export type ReconcileRun = { gpxFileId: string; source: "gpx" | "strava"; stravaActivityId?: string };
export function expectedAccomplishmentId(run: ReconcileRun): string; // strava#sid | gpx#fid
export function diffAccomplishments(
  existing: { accomplishmentId: string; source: string }[],
  runs: ReconcileRun[]
): { orphanIds: string[]; missingFileIds: string[] };
// leaderboard-drill-cache.ts
export async function getCachedDrill<T>(userId: string, loader: () => Promise<T>): Promise<T>;
export function bustDrillCache(userId: string): void;
export function __resetDrillCache(): void;
export const DRILL_CACHE_TTL_MS = 60_000; export const DRILL_CACHE_MAX = 500;
```
- Consumes: `getAdapterUserIdBySub`, `getAccomplishmentsByUser`, `deleteAccomplishment`, `config.auth.internalSecret` (mirror `api/internal/accomplishment/route.ts` exactly for the gate/benign-drop).

- [ ] **Step 1: failing tests — diff lib.** Cases: (1) orphan gpx row `gpx#a` with runs=[] → `orphanIds:["gpx#a"]`; (2) checkin rows NEVER orphaned; (3) run `{gpxFileId:"f",source:"strava",stravaActivityId:"9"}` with no rows → `missingFileIds:["f"]` (id `strava#9`); (4) matched strava row → empty diff; (5) strava run with NO stravaActivityId falls back to `gpx#f`; (6) idempotent: diff of matched set = both empty.
- [ ] **Step 2: implement diff lib** (build a Set of expected ids; orphans = existing rows with `source==="gpx"||source==="strava"` whose id ∉ set; missing = runs whose expected id has no existing row, returning `gpxFileId`). Run → PASS.
- [ ] **Step 3: failing tests — drill cache.** Mirror `leaderboard-cache.test.ts` style with `vi.useFakeTimers()`: fresh-loads once per userId; second call within TTL returns cached WITHOUT calling loader; past TTL reloads; `bustDrillCache(u)` forces reload for u only; inserting 501 users evicts the oldest (LRU on Map insertion order: delete+re-set on read).
- [ ] **Step 4: implement drill cache** — module-level `Map<string,{data:unknown,fetchedAt:number}>`; on get: hit+fresh → refresh recency (delete/re-set) and return; else await loader, set, and if `size > DRILL_CACHE_MAX` delete `map.keys().next().value`. (Simple TTL, not SWR — a drill is small; blocking one request per user per minute is fine.) Run → PASS.
- [ ] **Step 5: failing tests — reconcile route.** Mock `@/entities/auth-user`, `@/entities/accomplishment`, `@/lib/leaderboard-drill-cache`. Cases: no/wrong secret → 403 before body read; unknown sub → 200 `{dropped:true}`; happy path: existing rows `[gpx#dead (gpx), checkin#c1 (checkin)]`, runs `[{gpxFileId:"live",source:"gpx"}]` → `deleteAccomplishment` called ONCE with `(userId,"gpx#dead")`, `bustDrillCache(userId)` called, response `{ok:true,deleted:1,missing:["live"]}`; malformed runs (not array / entry missing gpxFileId) → 400.
- [ ] **Step 6: implement route** (PUT export; validate each run: string gpxFileId, source coerced `"strava"|"gpx"`, optional string stravaActivityId; loop orphans sequentially through `deleteAccomplishment`; log counts only). Run route tests + full suite → PASS.
- [ ] **Step 7: commit** `feat(human): internal reconcile endpoint diffs gpx/strava accomplishments`

### Task 4: run.gpx — reconcile client lib, internal endpoint, all triggers

**Files:**
- Create: `apps/run.gpx/webapp/src/lib/gpx-reconcile.ts` + `.test.ts`
- Modify: `apps/run.gpx/webapp/src/lib/gpx-accomplishment.ts` (payload gains `source`/`stravaActivityId`)
- Create: `apps/run.gpx/webapp/src/app/api/gpx/internal/reconcile/route.ts` + `route.test.ts`
- Modify triggers: `api/gpx/files/[id]/confirm/route.ts` (:146-180 replace notify block), `api/gpx/files/[id]/route.ts` (PUT after :300 update + DELETE after :409), `api/gpx/strava/import/route.ts` (after successful import), `api/gpx/strava/sync-now` route (after sync), `lib/strava-sync.ts` `runStravaSync` (per user after `syncUserToConDay`).

**Interfaces:**
- Produces:
```ts
// gpx-reconcile.ts
export function conDayCompletedAt(conDay: string): number; // Date.parse(conDay + "T12:00:00-07:00")
export async function reconcileAccomplishments(oidcSub: string, deps?: {
  fetchImpl?: typeof fetch;                        // both HTTP calls
  listFiles?: (sub: string) => Promise<GpxFileRow[]>; // default: GpxFile.query.primary({userId:sub}).go({pages:"all"})
  loadGpx?: (bucket: string, key: string) => Promise<string>; // default: S3 GetObject→transformToString
}): Promise<{ deleted: number; created: number }>;
export function reconcileBestEffort(oidcSub: string): void; // void fire-and-forget, swallows everything, logs one line with sub-less fileId counts
```
- Consumes: `parseTrack`, `buildAccomplishmentPayload`, `notifyAccomplishment` (gpx-accomplishment.ts), `humanBaseUrl` pattern (export a `humanInternalUrl(path)` helper from gpx-accomplishment.ts instead of duplicating), `GpxFile` entity, `s3Client/BUCKET`.
- `buildAccomplishmentPayload` args gain optional `source?: "gpx"|"strava"` and `stravaActivityId?: string`, threaded into the payload verbatim (omitted when absent, same style as conDay). `AccomplishmentPayload` type updated to match.

- [ ] **Step 1: failing tests — gpx-reconcile with injected deps.** Fixture files: active+conDay gpx file f1; active+conDay strava file f2 (`stravaActivityId:"9"`); active NO-conDay f3; pending+conDay f4; GLOBAL-owned excluded by query shape (not a case). Mock fetchImpl: PUT returns `{ok:true,deleted:1,missing:["f2"]}`; assert PUT body runs = ONLY `[f1,f2]` summaries with correct source/stravaActivityId; assert exactly one `loadGpx` (for f2) and one POST whose payload has `source:"strava"`, `stravaActivityId:"9"`, `gpxFileId:"f2"`, `completedAt === conDayCompletedAt(conDay)`, decimated polyline; returns `{deleted:1,created:1}`. Second test: missing=[] → zero loadGpx/POST. Third: PUT non-2xx → returns `{deleted:0,created:0}` without throwing (caller-visible soft-fail), and `reconcileBestEffort` never rejects even when reconcile throws synchronously.
- [ ] **Step 2: implement** gpx-reconcile.ts per the interface (runs list: `files.filter(f => f.status === "active" && f.conDay && f.userId !== "GLOBAL")`; POST loop over `missing` looking each file up from the same list; skip a missing id whose file/gpx-text fails to load — count only successful POSTs). Extend `buildAccomplishmentPayload`/`AccomplishmentPayload` first. Run → PASS.
- [ ] **Step 3: failing tests — internal reconcile route.** Secret gate identical to `api/gpx/internal/strava-sync/route.ts:22-25` (INTERNAL_SYNC_SECRET ?? AUTH_INTERNAL_SECRET fallback — copy the comment); 403 wrong secret; 400 missing/non-string `sub`; happy path mocks `reconcileAccomplishments` → 200 `{ok:true,created:2,deleted:1}`; reconcile throw → 500.
- [ ] **Step 4: implement route + wire ALL five triggers.** Confirm route: DELETE the whole `if (targetUserId !== "GLOBAL") { … }` notify block (:151-180) and its now-unused imports, replace with `if (targetUserId !== "GLOBAL") reconcileBestEffort(file.data.userId);`. files/[id] PUT: after the final `GpxFile.update … all_new` (:300), `if (updates.conDay !== undefined && targetUserId !== "GLOBAL") reconcileBestEffort(session.user.id);`. DELETE: after :409 `GpxFile.delete`, `if (targetUserId !== "GLOBAL") reconcileBestEffort(targetUserId);`. Strava import route + sync-now route: `reconcileBestEffort(session.user.id)` after a successful import/sync (locate the success return; fire before returning). `runStravaSync`: after each user's `syncUserToConDay` resolves with `imported > 0`, `reconcileBestEffort(user.userId)`.
- [ ] **Step 5: full run.gpx suite** (`source ~/.nvm/nvm.sh && nvm use 22.12.0 && npx vitest run` in `apps/run.gpx/webapp`) — PASS (update any confirm-route test that asserted the old notify).
- [ ] **Step 6: commit** `feat(gpx): full-recalc accomplishment reconcile on every run mutation`

### Task 5: run.human — drill API: social rollup + named CTF lines + caching

**Files:**
- Create: `apps/run.human/webapp/src/lib/leaderboard-drill.ts` + `.test.ts`
- Modify: `apps/run.human/webapp/src/app/api/leaderboard/[userId]/accomplishments/route.ts`
- Modify: `apps/run.human/webapp/src/app/api/leaderboard/route.ts` (response header only: `Cache-Control: private, max-age=30`)

**Interfaces:**
- Produces (PURE, in leaderboard-drill.ts):
```ts
export type SocialDayLine = { day: string; count: number; points: number };
export type CtfLine = { challenge: string; name: string; points: number; channel?: "qr"|"covert"; at?: string };
export function groupSocial(events: {challenge:string; bucket:string; points?:number; scoredAt?:string}[]):
  { days: SocialDayLine[]; egg: { points: number; at?: string } | null };
  // social-scan rows grouped by bucket.split("#")[0], days sorted desc; jack-egg → egg line
export function buildCtfLines(
  solves: {challenge:string; points?:number; channel?:"qr"|"covert"; solvedAt?:string}[],
  events: {challenge:string; points?:number; channel?:"qr"|"covert"; scoredAt?:string}[],
  names: Map<string,string>
): CtfLine[]; // excludes challenge social-scan/jack-egg from events; name = names.get(challenge) ?? challenge; sorted by at desc
export function maskCtfLines(lines: CtfLine[], viewer: {isOwner:boolean; isAdmin:boolean}): CtfLine[];
  // covert && !owner && !admin → name replaced with "Covert flag"
```
- Consumes: `CtfSolve.query.byUser({user:userId})`, `CtfScoreEvent.query.byUser({user:userId})` (both `.go({pages:"all"})`), `listCtf()` from `@/lib/qr-admin` (rows carry `challenge` + `name` — verify field names against `lib/ctf-leaderboard.ts:82`'s consumed shape and adapt the Map construction), `getCachedDrill`/`bustDrillCache` (Task 3), `getAccomplishmentsByUser`.

- [ ] **Step 1: failing tests — pure lib.** groupSocial: 3 scan rows across 2 days + 1 jack-egg → 2 day lines (counts/points summed, desc order) + egg `{points:25}`; empty → `{days:[],egg:null}`. buildCtfLines: solve + event union, social buckets excluded, unknown challenge falls back to slug, sort desc by at. maskCtfLines: covert masked unless owner/admin; qr never masked.
- [ ] **Step 2: implement lib → PASS.**
- [ ] **Step 3: route rewrite.** Keep gate verbatim. Replace body with: `const data = await getCachedDrill(userId, loader)` where `loader` fan-outs `Promise.all([getAccomplishmentsByUser, CtfSolve byUser, CtfScoreEvent byUser, listCtf-names])` and assembles `{ accomplishments: rows-as-today, social: groupSocial(events), ctf: buildCtfLines(...) }` UNMASKED. After cache read: `const isOwner = session.user.id === userId; const masked = { ...data, ctf: maskCtfLines(data.ctf, {isOwner, isAdmin:true-if-here-then-admin}) }` — NOTE the route is admin-gated today so isAdmin is always true; still call maskCtfLines so the launch-time gate relax can't forget it, and add a route test pinning that a covert name passes through for an admin viewer. Headers: `Cache-Control: private, max-age=60` (replace no-store). Keep `applyPrivacyFilter` where it is.
- [ ] **Step 4: route tests** (mock entities + qr-admin + auth/admin-gate per the existing pattern — remember to mock `@/lib/admin-gate` to dodge the next-auth import chain): 404 gate unchanged; response carries all three sections; second call same user does NOT re-hit mocked entities (cache); list route test asserts the new Cache-Control header. Full suite + `npm run build` → PASS.
- [ ] **Step 5: commit** `feat(human): leaderboard drill shows social-scan days and named CTF captures, cached per-user`

### Task 6: run.human — LeaderboardTable renders the new sections

**Files:**
- Modify: `apps/run.human/webapp/src/components/leaderboard/LeaderboardTable.tsx` (drill body :376-437, fetch/shape state, chips already generic)

**Interfaces:**
- Consumes Task 5's response shape; back-compat: treat missing `social`/`ctf` as empty (old cached JSON).

- [ ] **Step 1: implement.** State per user becomes `{accomplishments, social, ctf}`. Below the runs list (and above "No runs yet." fallback logic — show the fallback only when ALL three sections are empty), render:
  - Social block (when `social.days.length || social.egg`): heading `Social` (text-xs uppercase text-default-400); one line per day: `📇 Social scans ×{count}` + Chip `+{points} 🥕` + formatted day; egg line `🔌 DC Jack egg` + `+{points} 🥕`.
  - CTF block (when `ctf.length`): heading `CTF`; per line: `⚑ {name}` + Chip `+{points} 🥕` + date (`at` ISO → `formatDate(Date.parse(at))` guarded), covert lines get a `covert` micro-tag.
  Use existing Chip/typography idioms from the file; social chip color `secondary`, ctf `warning`.
- [ ] **Step 2: gate check.** No component test suite exists — `npm run build` + full vitest from `apps/run.human/webapp` → PASS.
- [ ] **Step 3: commit** `feat(human): drill-down sections for social scans and CTF captures`

### Task 7: run.human — admin per-user Recalculate

**Files:**
- Modify: `apps/run.human/webapp/src/entities/auth-user.ts` (add reverse lookup)
- Create: `apps/run.human/webapp/src/app/api/admin/users/[userId]/recalculate/route.ts` + `route.test.ts`
- Modify: `apps/run.human/webapp/src/app/(protected)/admin/AdminConsole.tsx` (drawer button near the ringtone control, :272-304 pattern)

**Interfaces:**
- Produces: `getSubByAdapterUserId(adapterUserId: string): Promise<string | null>` — DynamoDB Query on the authjs table: `KeyConditionExpression "pk = :pk AND begins_with(sk, :sk)"`, `:pk = USER#${adapterUserId}`, `:sk = ACCOUNT#${OIDC_PROVIDER}#`, return `Items[0]?.providerAccountId ?? null` (shape documented at auth-user.ts:84-95; mirror the module's existing client/table access).
- Route POST: admin gate exactly like `api/leaderboard/[userId]/accomplishments/route.ts:60-67` (404 non-disclosure, `revalidateAdmin(authUserId)`); resolve sub (404-style `{error:"no sub"}` 422 if none); `fetch(`${process.env.RUN_GPX_INTERNAL_URL ?? "http://localhost:3003"}/api/gpx/internal/reconcile`, {method:"POST", headers:{"Content-Type":"application/json","x-internal-secret":config.auth.internalSecret}, body:JSON.stringify({sub})})`; on ok: `bustDrillCache(userId)`, return upstream `{created,deleted}`; upstream failure → 502 `{error:"reconcile failed"}`.

- [ ] **Step 1: failing route tests** (mock auth-user, admin-gate, drill-cache, global fetch): non-admin 404; no-sub 422; happy 200 `{ok:true,created:1,deleted:2}` + bustDrillCache called; upstream 500 → 502.
- [ ] **Step 2: implement lookup + route → tests PASS.**
- [ ] **Step 3: AdminConsole button.** In the drawer next to the ringtone save control add a `Recalculate score` button following the `saveRingtone` fetch idiom: POST to `${apiBase}/api/admin/users/${selected.userId}/recalculate`, disabled while in-flight, result line `recalculated: +{created} / -{deleted}` or `failed (status)`. `npm run build` → PASS.
- [ ] **Step 4: commit** `feat(human): admin per-user leaderboard recalculate`

### Task 8: gpx-studio — "counts as accomplishment" affordance

**Files:**
- Modify: `apps/run.gpx/gpx-studio/website/src/lib/components/cloud/ConDaySaveDialog.svelte` (copy line)
- Modify: `apps/run.gpx/gpx-studio/website/src/lib/components/StravaStrip.svelte` (copy line in the day-assign overlay panel, under the "Which DEF CON day is this run for?" heading)
- Modify: `apps/run.gpx/gpx-studio/website/src/lib/components/map/run-popup.ts` (`dayChipHtml` null branch)
- Modify: `apps/run.gpx/gpx-studio/website/src/lib/components/map/gpx-layer/gpx-layer.ts` + `.../layer-control/LayerControl.svelte` (thread fileId; open dialog on event)

**Interfaces:**
- Popup→dialog bridge: the popup button carries `data-dc34-assign="<fileId>"`; a delegated document click listener (registered once in LayerControl.svelte alongside its existing map-load wiring) does `window.dispatchEvent(new CustomEvent("dc34-open-day-assign", { detail: { fileId } }))`; LayerControl handles the event by opening `ConDaySaveDialog` for that already-cloud-linked file (reuse however CloudStorage.svelte invokes the dialog for an existing file — read both call sites first and reuse the existing open mechanism rather than inventing one).

- [ ] **Step 1: copy lines.** Both dialogs get a muted single line under their heading: `Counts as a DEF CON accomplishment on the leaderboard` (text-xs / muted-foreground idiom used in each file).
- [ ] **Step 2: popup affordance.** `dayChipHtml(null-ish)` currently returns the "No day assigned" pill (run-popup.ts:52-55). Give `dayChipHtml` an optional `fileId?: string` param: when absent, keep today's pill; when present, return a `<button data-dc34-assign="${escapeHtml(fileId)}" …pill styles, pointer cursor, accent border…>☆ Add as accomplishment</button>`. Assigned days keep the colored chip but gain `title="Counts as a DEF CON accomplishment on the leaderboard"`. Thread the cloud fileId from the gpx-layer popup call site (gpx-layer.ts already knows the cloud link for the file it popped — pass it only for the signed-in own-file case).
- [ ] **Step 3: bridge + dialog open** per the interface above.
- [ ] **Step 4: verify.** `cd apps/run.gpx/gpx-studio/website && npx svelte-check --threshold error 2>&1 | tail -5` — no NEW errors beyond the ~30 pre-existing upstream ones (compare per-file: none in the four touched files). Local Playwright smoke (recipe in `docs/superpowers/plans/2026-07-23-*` sessions / memory): dev server `PUBLIC_MAPBOX_TOKEN=pk.dummy npm run dev -- --port 5199 --strictPort`, script in `apps/run.auth/e2e/`, stubs incl. `{usage:[...]}` wrapper; assert the strip overlay shows the copy line. (If the popup path is too deep to stub quickly, the copy-line assertions + svelte-check suffice; note it for UAT.)
- [ ] **Step 5: commit** `feat(gpx-studio): accomplishment copy + add-as-accomplishment popup action`

### Task 9: infra — `RUN_GPX_INTERNAL_URL` for run.human

**Files:**
- Modify: the run-human service definition under `infra/terraform/live/site/services/run-human/` (locate exact file via `grep -rn "RUN_HUMAN_INTERNAL_URL" infra/` — copy the reverse pattern from wherever run.gpx's service injects `RUN_HUMAN_INTERNAL_URL`, swapping service names: value `http://run-gpx.app-${region}-… .local:3000` with run.gpx's basePath if the existing pattern includes one).

- [ ] **Step 1:** grep, mirror, add the env var to run.human's container env in BOTH regions' shape (the service module is region-parameterized — one edit if it templates, matching however RUN_HUMAN_INTERNAL_URL is declared).
- [ ] **Step 2:** `cd infra/terraform/live/site && terragrunt plan` for the run-human service ONLY (plan/inspect — NEVER apply locally; the deploy workflow applies). Confirm the plan shows exactly the one env-var addition.
- [ ] **Step 3: commit** `feat(infra): RUN_GPX_INTERNAL_URL env for run.human admin recalc`

### Task 10: one-off sweep script (run post-deploy, dry-run default)

**Files:**
- Create: `apps/run.gpx/webapp/scripts/reconcile-leaderboard.mts`

**Interfaces:**
- Offline direct-DDB script (hand-mirrored low-level clients — the entity modules' ESM chains break tsx; follow the `seed-ctf-otp.mts` / backfill script pattern, incl. explicit `--apply` flag, per-user printed diff, and profile/region flags). Reads: `dc34-gpx` GpxFile rows (active, conDay, non-GLOBAL) via the gpx account profile; run.human table Accomplishment rows (`source` gpx|strava) + RunUser + authjs ACCOUNT# sub map via the run.human-side profile (same envs the prior offline backfills used — see memory `project_bib_runhuman_identity_backfill` landmines). Pure diff re-uses the same id rule (inline copy of `expectedAccomplishmentId` — scripts hand-mirror, do not import app code except PURE single-file helpers like parseTrack, which IS importable via relative path).
- Behavior per user: print `sub / adapterId: +N missing, -M orphans`; with `--apply`: delete orphan rows + apply the floor-at-0 rollup decrement (replicate `updateRunUserActivityCounts` read-modify-write exactly: activityScore, activityCounts.<source>, do NOT touch latestActivityAt on decrement-only sweeps); create missing rows with polyline from S3 (GetObject + parseTrack + decimatePolyline via relative import) and the matching rollup increment. Users whose sub has no adapter id: report and skip.

- [ ] **Step 1:** write the script; `npx tsx scripts/reconcile-leaderboard.mts --help` prints usage and exits 0 without touching AWS.
- [ ] **Step 2:** commit `chore(gpx): one-off leaderboard reconcile sweep script`. (Executing against prod happens AFTER deploy, dry-run first, results reported — an ops step, not a plan step.)

---

## Final gates (after all tasks)

1. run.human: `npx vitest run` + `npm run build` — green.
2. run.gpx: Node-22.12 `npx vitest run` — green; svelte-check no new errors.
3. Final whole-branch review (subagent-driven-development final reviewer).
4. PR → merge (admin) → `release-all.sh --apps run.human,run.gpx --regions use1 --pr` → deploy.yml (`pr_number=skip` after Release PR auto-merge, `invalidate_cache=true`) → ECS rollout COMPLETED both services → deployed-asset greps (drill sections string in run.human chunk; reconcile route in run.gpx) → prod smoke: delete a test run, confirm the accomplishment row disappears → sweep script dry-run → `--apply` → report.
