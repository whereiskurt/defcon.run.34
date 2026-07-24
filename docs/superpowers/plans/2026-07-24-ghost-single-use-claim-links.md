# Ghost flag-claim links (single-use tokens + jackpot unfurl) — Implementation Plan

> **For agentic workers:** this plan is written to be executed AUTONOMOUSLY from a fresh session (post `/clear`), zero conversation context. Everything you need is here or in the referenced memory files. REQUIRED SUB-SKILL: superpowers:executing-plans (inline; do NOT spawn subagents — the session forbids the Agent tool). Steps use `- [ ]` checkboxes.

**Goal:** When a player unlocks a ghost and raises the trigger topic, the bot sends **two mesh messages** — `👻 You found a flag!` then a **magic-link claim URL** that awards the CTF flag on click for the signed-in user. The link is a **single-use token** (minted per reveal, consumed on first claim), so a shared URL can be claimed at most once. The claim page shows a **777-jackpot OG unfurl** (code-generated, no image asset).

**Why this exists / what's already LIVE (do not rebuild):** The ghost CTF flow is already deployed live in **us-east-1** (see memory `project_ghost_bedrock_guardrails_flags.md`): OTP unlock → Bedrock-Haiku persona chat → trigger phrase (e.g. "hack the planet") → the bot currently reveals a **static derived code** (e.g. goldstein `hackers4evr`→`RJCC2TEC`). That static code is **shareable** — anyone with it can claim. THIS PLAN replaces the static-code reveal with a single-use magic link. Everything else (Bedrock, guardrail sidecar, OTP unlock, derivation, the CTF `answerHash` sync) stays exactly as-is.

---

## Design decisions (locked — rationale so you don't re-litigate)

1. **Single-use ⇒ dynamic URL.** A one-time token is unique per reveal, so the URL is dynamic. That makes a **static q.defcon.run short-link (didhtp1-style) Qr item impossible** (a Qr item has ONE static destination; it can't carry a per-reveal nonce). Therefore: the bot sends a **direct dynamic claim URL** and the unfurl lives on the **claim page** (Next.js), NOT on the q resolver. (A resolver `/f/<token>` prefix rule could preserve a short link, but it's more work + marginal gain; note as optional follow-up only.)
2. **The token is a `CtfPending` nonce.** run.human already has a single-use nonce store: `createPending(challenge, guess)` parks `{nonce, challenge, submittedFlagHash, ttl}`; `claimPending(nonce, user)` judges via the parked hash then **deletes the row** (single-use). We mint one at reveal with a SHORT ttl.
3. **The bot mints via a run.human internal endpoint** (`x-internal-secret` guarded), NOT by writing DynamoDB directly — keeps the ElectroDB/`hashAnswer` schema owned by run.human (avoids fragile Go↔electro coupling). The endpoint takes the ghost id and derives the code server-side (run.human already has `MESHTK_GHOST_KEY_SECRET` + `MESHTK_FLAG_CHALLENGES` + `deriveFlagCode`), so the raw code never travels bot→run.human.
4. **One token per chat.** The bot mints at most ONE token per radio per unlock session; a re-trigger re-sends the SAME cached link (never mints again). Prevents token-farming to share many links.
5. **Fail-safe.** If the mint HTTP call fails, the bot falls back to the current behaviour (send the derived code inline) so a reveal never silently dies.
6. **Identity gap (why not per-user):** the work is done by a mesh RADIO (node id); the claim is by a WEB account (`session.user.id`). The bot can't see the web user behind a radio, so per-user binding isn't feasible. Single-use is the pragmatic protection; residual "first-clicker-wins if shared" is acceptable and self-limiting (one claim per token, short ttl).

**Cross-impl identity note (memory `reference_auth_id_namespace_mismatch`):** the CTF player key is `session.user.id` (Auth.js adapter uuid), NOT `session.user.authUserId` (OIDC sub). The existing claim page already keys correctly — don't change it.

---

## Repos & working dirs

- **run.human** (Next.js/TS): `apps/run.human/webapp` in the defcon.run.34 worktree.
- **meshtk** (Go): `~/working/meshtk` — SEPARATE repo. CI clones it fresh from `github.com/whereiskurt/meshtk` main + overlays the dc34 config, so a merged meshtk PR ships via `buildpub` run.mqtt. (memory `feedback_meshtk_upstream`: meshtk code → `~/working/meshtk`, NOT `apps/run.mqtt/meshtk`.)
- **meshtk config overlay** (the challenge blob source of truth is SOPS, not the yaml): `infra/terraform/live/site/.secrets.sops.json` key `mqtt.flag-challenges`.

## Global constraints (memory `reference_worktree_release_deploy_ci`, AGENTS.md)

- **Deploy ONLY via GitHub Actions.** Never local `terragrunt apply`. Use `gh workflow run`.
- **Never commit to main directly** — branch + PR. User is repo admin; branch protection BLOCKS merges → use `gh pr merge --admin`. `gh pr create` sometimes 500s (transient) → retry, or `gh api -X POST /repos/whereiskurt/defcon.run.34/pulls`.
- **run.human tests need Node ≥ 22.12** (`nvm use 22.12.0`).
- **Worktree `node_modules` may be stale** — run `npm install` in `apps/run.human/webapp` before `npm run build` (jsqr etc. can be missing).
- **AWS:** `export AWS_PROFILE=dc34-application` (acct 427284555693). SSM/SOPS reads work with it.
- **SOPS `--set` for `mqtt.flag-challenges`:** `AWS_PROFILE=dc34-application sops --set '["mqtt"]["flag-challenges"] <json.dumps(blobstring)>' <file>` (KMS alias/sops). ⚠️**SSM rejects `{{}}` in values** — the reveal placeholder is `%CODE%` (already), keep it; never put `{{` in any SSM-bound value.
- **meshtk PR merge** may print "main already used by worktree" cosmetic errors — the remote squash-merge still succeeds; verify with `gh pr view <n> --json state`.

---

## Architecture (the new reveal flow)

```
unlocked DM, trigger matched (existing code in internal/app/fleet/cmd.go unlocked branch)
   │
   ├─ already minted a token for this radio+ghost this unlock? → re-send cached "found a flag!" + URL, return
   │
   ▼
POST https://run.defcon.run/use1/api/internal/ctf/mint   (x-internal-secret: $AUTH_INTERNAL_SECRET)
     body {"ghost":"ghost.goldstein"}
   │  200 {"nonce":"<uuid>","url":"https://run.defcon.run/use1/ctf/claim?nonce=<uuid>"}
   │  (run.human: derive code for ghost → createPending(challenge, code, SHORT_TTL) → nonce)
   │
   ├─ mint OK  → cache nonce+url per radio; send msg1 "👻 You found a flag!"; send msg2 <url>
   └─ mint FAIL→ fallback: send the existing renderReveal() (static code) so reveal still works
```

Claim: signed-in user opens `/use1/ctf/claim?nonce=<uuid>` → `claimPending(nonce, session.user.id)` → judge + award + delete row (single-use). Anon → park cookie + "sign in to claim". Crawler → jackpot OG card (code-generated).

---

## TASK GROUP A — run.human: short-ttl mint, claim `?nonce`, jackpot OG

### Task A1: short-ttl variant of `createPending`

**File:** Modify `apps/run.human/webapp/src/lib/ctf-pending.ts`

Current `createPending(challenge, guess, deps)` hardcodes `PENDING_TTL_SECONDS = 30d`. Add an optional `ttlSeconds` override.

- [ ] Add a `ttlSeconds?: number` field to `PendingDeps` (or a 4th arg). In `createPending`, use `const ttlSecs = deps.ttlSeconds ?? PENDING_TTL_SECONDS;` and `const ttl = Math.floor(now/1000) + ttlSecs;`.
- [ ] Export a const `CLAIM_LINK_TTL_SECONDS = 15 * 60;` (15 min — short enough to blunt sharing, long enough to walk to a phone and sign in).
- [ ] Unit test (`src/lib/__tests__/ctf-pending-ttl.test.ts`): `createPending("goldstein","X",{store:fake, now:0, ttlSeconds:900, newNonce:()=> "n1"})` puts a row with `ttl===900`.

### Task A2: internal mint endpoint

**File:** Create `apps/run.human/webapp/src/app/api/internal/ctf/mint/route.ts`

Mirror the guard in `src/app/api/internal/mesh-map/route.ts`:
```ts
const secret = req.headers.get("x-internal-secret");
if (!secret || secret !== config.auth.internalSecret) return 401
```
Then: parse `{ ghost }` (fleet id like `ghost.goldstein`). Resolve its committed code + challenge name from the challenge blob and derive the real code:
- Use `getMeshGhost(ghost)` (`@/lib/mesh-ghosts`) → `{ id, slug, flagCode(committed), triggers }` (flagCode is sourced from `MESHTK_FLAG_CHALLENGES`).
- `challenge = slug` (the static CTF challenge name, e.g. `goldstein` — VERIFY against `Ctf` rows; the rekey script maps persona→challenge 1:1).
- `serverSecret = process.env.MESHTK_GHOST_KEY_SECRET`; `code = deriveFlagCode(serverSecret, id, flagCode)` (`@/lib/mesh-otp-derive`).
- `const { nonce } = await createPending(challenge, code, { ttlSeconds: CLAIM_LINK_TTL_SECONDS });`
- Return `{ nonce, url: \`${RUN_PUBLIC}/ctf/claim?nonce=${nonce}\` }` where `RUN_PUBLIC` is `process.env.RUN_PUBLIC_URL` (already set on run.human) or built from region. `runtime = "nodejs"`, `dynamic = "force-dynamic"`, no logging of code/nonce beyond what createPending does (it logs nothing).
- Guard: if serverSecret unset or ghost/flagCode missing → 422 (bot falls back).

- [ ] Write the route + a test (`__tests__/route.test.ts`) covering: 401 without secret; 200 returns a nonce for a known ghost with the secret set (mock `createPending`/`getMeshGhost` or set env).

### Task A3: claim page `?nonce=` branch

**File:** Modify `apps/run.human/webapp/src/app/(ctf)/ctf/claim/page.tsx`

Currently params are `c`,`v`; nonce is read only from the `ctf_pending` cookie (branch B). Add `nonce` to `searchParams` and TWO branches BEFORE the existing ones:
- **signed-in + `?nonce`** → `const result = await claimPending(nonce, player); return <ClaimClient mode="result" result={result} clearNonce />;`
- **anon + `?nonce`** → set the `ctf_pending` cookie to `nonce` (so post-sign-in branch B claims it) → `return <ClaimClient mode="signin" nonce={nonce} />;`. (Match how ClaimClient/branch B set+read the cookie — likely ClaimClient writes the cookie client-side from the `nonce` prop; reuse that path.)

- [ ] Implement; keep the NO-LOGGING hygiene note intact. Add/extend a test asserting signed-in+nonce → claimPending called with (nonce, player).

### Task A4: jackpot OG unfurl on the claim page (code-generated)

**File:** Create `apps/run.human/webapp/src/app/(ctf)/ctf/claim/opengraph-image.tsx`

Use Next.js `ImageResponse` (`next/og`) to render a 1200×630 "🎰 777" card: dark casino-felt background, big `🎰 777`, headline "You found a flag!", sub "Tap in to claim your DEF CON 34 run CTF flag." (mirror the tone of the resolver's cherries copy in `apps/run.qr/lambda/resolver/lib/unfurl.mjs`). `export const runtime = "edge"` or nodejs per repo convention; `export const alt`, `size`, `contentType`.

- [ ] Verify `next/og` is available (check `package.json`); if not, add it OR fall back to a static `public/ctf-jackpot-og.png` referenced via `generateMetadata`. Add `generateMetadata` to `page.tsx` returning `openGraph`/`twitter` card pointing at the image, title "🎰 You found a flag!". NOTE: the claim page is `force-dynamic` + reads `searchParams`; ensure metadata renders for crawlers without triggering an award (crawlers are anon → they hit the anon branch which only parks a cookie; acceptable). Do NOT leak the code/nonce in OG text.

### Task A5: run.human quality gates + PR

- [ ] `cd apps/run.human/webapp && nvm use 22.12.0 && npm install && npx vitest run && npm run build` → all green.
- [ ] Commit on a branch `gsd/ghost-single-use-claim-links`, PR, `--admin` merge to main. (Do NOT deploy yet — build the meshtk side first so they land together.)

---

## TASK GROUP B — meshtk: mint-on-reveal + wiring

### Task B1: config — add `challenge` (optional) to FlagChallenge

**File:** `~/working/meshtk/pkg/config/flagchallenge.go`

The bot needs to tell run.human WHICH ghost to mint for — it already knows the fleet id, so no new field is strictly required (send the id). Keep the blob shape unchanged. (No change needed unless you prefer an explicit `challenge` — skip for simplicity.)

### Task B2: mint client + 2-message reveal

**Files:** Modify `~/working/meshtk/internal/app/fleet/cmd.go` (unlocked branch, ~the `matchesTrigger`→`renderReveal` block) and add a small `internal/app/fleet/claimlink.go`.

- [ ] `claimlink.go`: `func mintClaimURL(ctx, ghostId string) (string, error)` — POST `${MESHTK_RUN_INTERNAL_URL}/api/internal/ctf/mint` with header `x-internal-secret: ${MESHTK_INTERNAL_SECRET}`, body `{"ghost": ghostId}`, 5s timeout; parse `{url}`. Empty env → return error (caller falls back). NO logging of the url/nonce.
- [ ] Add per-radio mint cache to `FleetCmd`: `RevealLink []map[uint32]string` (per fleet index, radio→url) + mutex, OR reuse the `OTPUnlocks` record with an added `RevealURL` field. One mint per radio per unlock.
- [ ] In the unlocked branch, where the trigger matches and currently does `n.sendPKIReplyReliable(..., renderReveal(rt))`:
  ```
  if url, ok := cachedRevealURL(radio); ok {  // already minted this unlock
      send "👻 You found a flag!"; send url; return
  }
  url, err := mintClaimURL(ctx, fleetId)
  if err != nil || url == "" {
      // FAIL-SAFE: fall back to the existing static-code reveal
      n.sendPKIReplyReliable(..., renderReveal(rt)); return
  }
  cacheRevealURL(radio, url)
  n.sendPKIReplyReliable(..., "👻 You found a flag!")
  n.sendPKIReplyReliable(..., url)
  return
  ```
  Keep both sends on `sendPKIReplyReliable` (memory: the reply-retry structural test `TestOneShotReplyPathsUseReliableRetry` counts reliable calls in `FleetNodeHandler` — UPDATE its expected count to match the new number of `sendPKIReplyReliable` call sites, and update `request_dedup_test.go` if it enumerates callee names).
- [ ] Tests: mint client (httptest server → returns url; unset env → error→fallback path); cache (second trigger re-sends, no second mint).
- [ ] `cd ~/working/meshtk && go build ./... && go vet ./... && go test ./...` all green. `go mod vendor` if deps change (repo vendors; bedrockruntime already vendored).

### Task B3: meshtk PR → merge to meshtk main

- [ ] Branch `feat/ghost-claim-link-mint`, PR to `whereiskurt/meshtk` main, `--admin` merge (verify `gh pr view --json state` = MERGED; ignore local "worktree" cosmetic errors).

---

## TASK GROUP C — wire meshtk → run.human (terraform) + blob

### Task C1: meshtk env — internal URL + secret

**File:** `infra/terraform/live/site/services/run.mqtt/service.hcl` (the `run-mqtt-ghosts` container)

- [ ] Add env `{ name = "MESHTK_RUN_INTERNAL_URL", value = "https://run.{{SITE_DOMAIN}}/{{REGION_LABEL}}" }` (public HTTPS; meshtk already makes public HTTPS calls). (Optional: internal service-discovery URL if run.human exposes one — public is fine, guarded by the secret.)
- [ ] Add secret `{ name = "MESHTK_INTERNAL_SECRET", valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/jwt/internal_secret" }` (same param run.human uses for `AUTH_INTERNAL_SECRET` — verify the path via run.human service.hcl `AUTH_INTERNAL_SECRET` valueFrom; it is `/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/jwt/internal_secret`).
- [ ] `terragrunt hcl fmt --file <service.hcl> --check`. Commit to the same defcon PR branch as Group A (or a joined branch) so run.human + wiring land together.

### Task C2: (no blob change required)

The challenge blob stays as-is (reveal template `%CODE%` remains for the fail-safe path; triggers + committedCode unchanged). Nothing to re-key.

---

## TASK GROUP D — deploy (us-east-1 only; cac1 is skip_region, apse1 = run.human only)

Follow the exact sequence proven in the prior deploy (memory `project_ghost_bedrock_guardrails_flags.md`). Order matters.

1. [ ] **Merge** the defcon PR (Groups A + C1) and the meshtk PR (Group B) to their mains (`--admin`).
2. [ ] **No new SSM params/ECR/IAM** in this feature (mint uses the existing `jwt/internal_secret`; no new secret keys). So the `secrets`/`ecr`/`ecs-cluster` modules do NOT need applying. (If you added any secret key, apply `secrets` for us-east-1 first via `gh workflow run "🏗️ Infra: Terragrunt Apply" -f region=us-east-1 -f modules=secrets` and VERIFY the param exists — a "success" run can still have silently skipped a module on a state-lock; check with `aws ssm get-parameter`.)
3. [ ] **buildpub** (builds meshtk with new code + run.human app; opens a Release PR). Use **github-hosted, sequential** (EC2 runner AMI has too-old docker API 1.43<1.44; spot often unavailable):
   `gh workflow run "🚀 Deploy: Build & Publish" -f apps=run.mqtt,run.human -f regions=use1 -f runner=github-hosted -f parallel=false -f create_pr=true -f deploy=false`
   Watch to success; note the Release PR number.
4. [ ] **deploy** — `deploy.yml` only applies `ecs-task,ecs-service` (which is all this feature needs). Merge the Release PR first (its merge-job FAILS if already merged → if so, re-run with `pr_number=skip`):
   `gh workflow run "🚀 Deploy: Release" -f region=us-east-1 -f pr_number=<ReleasePR#> -f invalidate_cache=true` ; if the merge-job errors "PR not open (MERGED)", re-run with `-f pr_number=skip`.
5. [ ] The bot-opened Release PR's `terragrunt-plan` check "awaiting approval" is a non-blocker (bot-PR gate); ignore.

---

## TASK GROUP E — verify

- [ ] `export AWS_PROFILE=dc34-application`. run.mqtt task def new revision applied; containers RUNNING (meshtk HEALTHY, guardrails HEALTHY). run.human live version bumped: `curl -s https://run.defcon.run/use1/ | grep -oE 'v0\.0\.[0-9]+'`.
- [ ] Mint endpoint smoke (server-to-server): `curl -s -X POST https://run.defcon.run/use1/api/internal/ctf/mint -H "x-internal-secret: $(aws ssm get-parameter --with-decryption --name /dc34/secrets/use1/jwt/internal_secret --query Parameter.Value --output text)" -H 'content-type: application/json' -d '{"ghost":"ghost.goldstein"}'` → expect `{"nonce":"…","url":"https://run.defcon.run/use1/ctf/claim?nonce=…"}`. Then in a browser SIGNED IN, open that url once → awarded; open again → "already claimed" (single-use verified). Open it while signed out → "sign in to claim".
- [ ] Unfurl: paste the claim url (or the /ctf/claim path) into a link-preview tester / view-source for a crawler UA → 777 OG card renders, NO code/nonce leaked in the card text.
- [ ] LEFT for Kurt (real mesh UAT): message goldstein → unlock → "hack the planet" → receive TWO messages (found-a-flag + link) → tap link (signed in) → flag awarded once; a re-trigger re-sends the SAME link (one per chat).

---

## Self-review checklist (run before declaring done)
- Single-use proven (second claim of a nonce = no award). One-per-chat proven (re-trigger doesn't mint a 2nd token). Mint fail-safe proven (mint down → static-code reveal still sent). No code/nonce in logs or OG text. meshtk reliable-reply structural test count updated. run.human 900+ vitest still green. Deploy used github-hosted (not EC2). cac1 untouched.
