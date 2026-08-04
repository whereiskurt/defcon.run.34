# Bib Pickup Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A runner's self-scan only awards the 200-point bib pickup if an operator has already scanned that runner's bib QR ("primed" it).

**Architecture:** A new durable `BibPickupPass` marker row, keyed by the runner's userId, is minted inside `judgeScan` when an operator (`QR_ADMIN_GROUPS`) scans a runner who has an uncollected bib. `judgeBibPickup` gains a third gate requiring that row. Both the mint decision and the operator-facing verdict come from one new `ScanStore.bibStatus()` read, keeping `social-scan.ts` a pure judge over an injectable store.

**Tech Stack:** Next.js 16, ElectroDB on DynamoDB (`run-human-electro`), Vitest, `tsx` for operator scripts.

**Spec:** `docs/superpowers/specs/2026-08-04-bib-pickup-pass-design.md`

## Global Constraints

- Operator set is `QR_ADMIN_GROUPS` (`admin` + `runadmin` + `qradmin`), via the existing `isQrAdmin(session)`.
- The pass is **durable — no expiry, no `ttl` attribute**. TTL is DISABLED on `run-human-electro`; writing `ttl` would imply cleanup that never happens.
- The mint MUST fire before the `SocialPair` claim, so a same-PT-day re-scan (`already_today`) still mints.
- `hasScoreFor` stays the once-ever gate; the pass never becomes it.
- All new failure modes return `null` from `judgeBibPickup` → the ordinary "You cannot scan your own QR code!". The feature fails inert.
- Run tests with Node ≥22.12 (`nvm use 22.12.0`) — vitest requires it.
- Deploy is GitHub Actions only. Never `terragrunt apply` locally, never `--with-terragrunt`.

---

### Task 1: `BibPickupPass` entity

**Files:**
- Modify: `apps/run.human/webapp/src/entities/social.ts` (append after `SocialEgg`)

**Interfaces:**
- Produces: `BibPickupPass` ElectroDB entity — `get({ userId })`, `put({ userId, grantedBy, grantedAt })`.

- [ ] **Step 1: Add the entity**

```ts
/**
 * Bib pickup pass — an operator has scanned this runner's bib QR, so their
 * self-scan may redeem the pickup award. DURABLE by design: bibs are primed in
 * bulk the day before the con and collected over the following days.
 *
 * No `ttl`: TTL is DISABLED on run-human-electro, so a ttl attribute would
 * imply a cleanup that never runs. One row per runner (put-overwritten on
 * re-prime), so growth is bounded by the roster.
 */
export const BibPickupPass = new Entity(
  {
    model: { entity: "BibPickupPass", version: "1", service: "run" },
    attributes: {
      userId: { type: "string", required: true }, // the RUNNER
      grantedBy: { type: "string" }, // operator's userId — audit trail
      grantedAt: {
        type: "string",
        default: () => new Date().toISOString(),
      },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["userId"] },
        sk: { field: "sk", composite: [] },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);
```

Note `grantedAt` is NOT `readOnly` (unlike `SocialEgg.claimedAt`) — re-priming refreshes it via `.put()`.

- [ ] **Step 2: Commit**

```bash
git add apps/run.human/webapp/src/entities/social.ts
git commit -m "feat(human): BibPickupPass entity — operator-primed bib marker"
```

---

### Task 2: Mint the pass in `judgeScan`

**Files:**
- Modify: `apps/run.human/webapp/src/lib/social-scan.ts`
- Test: `apps/run.human/webapp/src/lib/__tests__/social-scan.test.ts`

**Interfaces:**
- Consumes: `BibPickupPass` from Task 1.
- Produces:
  - `ScanStore.bibStatus(userId: string): Promise<"none" | "ready" | "picked_up">`
  - `ScanStore.mintPickupPass(userId: string, grantedBy: string): Promise<void>`
  - `judgeScan` input gains `operator?: boolean`
  - `ScanResult` `ok:true` variant gains `bib?: "ready" | "picked_up"`
  - `ScanResult` `already_today` variant gains `bib?: "ready" | "picked_up"` and `ownerName?: string`

- [ ] **Step 1: Write the failing tests**

Add to `social-scan.test.ts`. The fake store needs two new methods and a `passes` set — extend `makeFakeStore` alongside the existing `state`:

```ts
    passes: [] as Array<{ userId: string; grantedBy: string }>,
    bibs: new Map<string, "none" | "ready" | "picked_up">(),
```
```ts
    async bibStatus(userId) {
      return state.bibs.get(userId) ?? "none";
    },
    async mintPickupPass(userId, grantedBy) {
      state.passes.push({ userId, grantedBy });
    },
```

```ts
describe("bib pickup pass minting", () => {
  it("an operator scanning a bib-holder mints a pass and reports bib:ready", async () => {
    const { store, state } = makeFakeStore([SCANNER, OWNER]);
    state.byToken.set("tok", OWNER);
    state.bibs.set(OWNER.userId, "ready");

    const r = await judgeScan(
      { scannerId: SCANNER.userId, token: "tok", nowMs: NOW, operator: true },
      store
    );

    expect(r).toMatchObject({ ok: true, bib: "ready" });
    expect(state.passes).toEqual([
      { userId: OWNER.userId, grantedBy: SCANNER.userId },
    ]);
  });

  it("THE 409 TRAP: a same-day re-scan still mints and still reports bib:ready", async () => {
    const { store, state } = makeFakeStore([SCANNER, OWNER]);
    state.byToken.set("tok", OWNER);
    state.bibs.set(OWNER.userId, "ready");
    const input = {
      scannerId: SCANNER.userId,
      token: "tok",
      nowMs: NOW,
      operator: true,
    };

    await judgeScan(input, store);
    const second = await judgeScan(input, store);

    // The pair is burnt for the day, but priming MUST still work — otherwise an
    // operator re-scanning a stack silently mints nothing and the runner can
    // never redeem.
    expect(second).toMatchObject({
      ok: false,
      code: "already_today",
      bib: "ready",
      ownerName: OWNER.displayName,
    });
    expect(state.passes).toHaveLength(2);
  });

  it("reports picked_up and mints NOTHING for a runner who already collected", async () => {
    const { store, state } = makeFakeStore([SCANNER, OWNER]);
    state.byToken.set("tok", OWNER);
    state.bibs.set(OWNER.userId, "picked_up");

    const r = await judgeScan(
      { scannerId: SCANNER.userId, token: "tok", nowMs: NOW, operator: true },
      store
    );

    expect(r).toMatchObject({ ok: true, bib: "picked_up" });
    expect(state.passes).toEqual([]);
  });

  it("mints nothing and reports no bib for a runner with no bib", async () => {
    const { store, state } = makeFakeStore([SCANNER, OWNER]);
    state.byToken.set("tok", OWNER);

    const r = await judgeScan(
      { scannerId: SCANNER.userId, token: "tok", nowMs: NOW, operator: true },
      store
    );

    expect(r).toMatchObject({ ok: true });
    expect((r as { bib?: string }).bib).toBeUndefined();
    expect(state.passes).toEqual([]);
  });

  it("a NON-operator never mints, and never even reads bib status", async () => {
    const { store, state } = makeFakeStore([SCANNER, OWNER]);
    state.byToken.set("tok", OWNER);
    state.bibs.set(OWNER.userId, "ready");
    let reads = 0;
    const spied: ScanStore = {
      ...store,
      async bibStatus(u) {
        reads += 1;
        return store.bibStatus!(u);
      },
    };

    await judgeScan(
      { scannerId: SCANNER.userId, token: "tok", nowMs: NOW },
      spied
    );

    expect(state.passes).toEqual([]);
    expect(reads).toBe(0); // ordinary runner scans pay nothing extra
  });

  it("an operator self-scan mints nothing — self is rejected before the mint", async () => {
    const { store, state } = makeFakeStore([SCANNER]);
    state.byToken.set("tok", SCANNER);
    state.bibs.set(SCANNER.userId, "ready");

    const r = await judgeScan(
      { scannerId: SCANNER.userId, token: "tok", nowMs: NOW, operator: true },
      store
    );

    expect(r).toEqual({ ok: false, code: "self" });
    expect(state.passes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/run.human/webapp && npx vitest run src/lib/__tests__/social-scan.test.ts
```
Expected: FAIL — `bibStatus` is not a `ScanStore` member, `operator` is not a `judgeScan` input.

- [ ] **Step 3: Implement**

In `social-scan.ts`, extend the types:

```ts
/** Operator-scan bib verdict. Drives both the mint and the scanner copy. */
export type BibScanStatus = "none" | "ready" | "picked_up";
```

Add to `ScanStore` (optional, so existing fakes keep compiling):

```ts
  /**
   * Operator scans only: does this runner have a bib, and did they collect it?
   * `ready` is the only status that mints a pass.
   */
  bibStatus?(userId: string): Promise<BibScanStatus>;
  /** Upsert the durable pickup pass. Re-priming refreshes it. */
  mintPickupPass?(userId: string, grantedBy: string): Promise<void>;
```

Extend `ScanResult`:

```ts
export type ScanResult =
  | {
      ok: true;
      ownerId: string;
      ownerName: string;
      remainingToday: number;
      bib?: BibScanStatus;
    }
  | {
      ok: false;
      code: "bad_token" | "not_found" | "self" | "already_today" | "cap";
      /** already_today only: priming still happened, so the operator UI can say so. */
      bib?: BibScanStatus;
      ownerName?: string;
    };
```

In `judgeScan`, after the `self` check and BEFORE `claimPairDay`:

```ts
  // ── Bib priming ───────────────────────────────────────────────────────────
  // Deliberately BEFORE the pair-day claim: SocialPair burns an unordered pair
  // for the whole PT day, so minting only on the success path would mean an
  // operator re-scanning a bib they already scanned today mints NOTHING and the
  // runner can never redeem. Priming must be repeatable; the pair claim is not.
  //
  // Gated on the BIB, not on the operator's group: operators also use attendance
  // mode for ordinary run scanning, where "bib ready" would be nonsense.
  let bib: BibScanStatus | undefined;
  if (input.operator && store.bibStatus && store.mintPickupPass) {
    try {
      const status = await store.bibStatus(owner.userId);
      if (status !== "none") bib = status;
      if (status === "ready") {
        await store.mintPickupPass(owner.userId, scannerId);
      }
    } catch (err) {
      // Priming is additive; a failure must never fail the scan itself.
      console.error("[social-scan] bib priming failed", err);
    }
  }
```

Thread `bib` through both exits:

```ts
  if (!claimed) {
    return { ok: false, code: "already_today", bib, ownerName: owner.displayName };
  }
```
…and add `bib` to the final success return.

Implement on `defaultScanStore`:

```ts
  async bibStatus(userId) {
    const bib = await getBibForPickup(userId);
    if (!bib) return "none";
    const collected = await defaultStore.hasScoreFor!({
      challenge: BIB_PICKUP_CHALLENGE,
      user: userId,
    });
    return collected ? "picked_up" : "ready";
  },
  async mintPickupPass(userId, grantedBy) {
    await BibPickupPass.put({
      userId,
      grantedBy,
      grantedAt: new Date().toISOString(),
    }).go();
  },
```

Imports needed: `getBibForPickup` from `@/entities/bib`, `defaultStore` from `@/lib/ctf-judge`, `BIB_PICKUP_CHALLENGE` from `@/lib/bib-pickup`, `BibPickupPass` from `@/entities/social`.

⚠️ `bib-pickup.ts` must NOT import from `social-scan.ts` or this cycles. `BIB_PICKUP_CHALLENGE` is a const in `bib-pickup.ts`; importing it one way only is fine.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/run.human/webapp && npx vitest run src/lib/__tests__/social-scan.test.ts
```
Expected: PASS, including the pre-existing cases.

- [ ] **Step 5: Commit**

```bash
git add apps/run.human/webapp/src/lib/social-scan.ts apps/run.human/webapp/src/lib/__tests__/social-scan.test.ts
git commit -m "feat(human): operator scans mint a durable bib pickup pass"
```

---

### Task 3: Enforce the pass in `judgeBibPickup`

**Files:**
- Modify: `apps/run.human/webapp/src/lib/bib-pickup.ts`
- Test: `apps/run.human/webapp/src/lib/__tests__/bib-pickup.test.ts`

**Interfaces:**
- Consumes: `BibPickupPass` from Task 1.
- Produces: `judgeBibPickup` deps gain `hasPass?: (userId: string) => Promise<boolean>`.

- [ ] **Step 1: Write the failing tests**

Extend the existing mock block:
```ts
vi.mock("@/entities/social", () => ({ BibPickupPass: { get: vi.fn() } }));
```
Add `hasPass` to the `beforeEach` fixture (`hasPass = vi.fn().mockResolvedValue(true)`) and to `run()`.

```ts
  it("THE GUARD: an unprimed self-scan awards NOTHING", async () => {
    hasPass.mockResolvedValue(false);
    expect(await run()).toBeNull();
    expect(solve).not.toHaveBeenCalled();
  });

  it("awards once an operator has primed the bib", async () => {
    hasPass.mockResolvedValue(true);
    expect(await run()).toEqual({ points: 200, bib: BIB });
  });

  it("first-ness still wins over a live pass (re-primed, already collected)", async () => {
    hasScoreFor.mockResolvedValue(true);
    hasPass.mockResolvedValue(true);
    expect(await run()).toBeNull();
    expect(solve).not.toHaveBeenCalled();
  });

  it("degrades to null when the pass read throws", async () => {
    hasPass.mockRejectedValue(new Error("nope"));
    await expect(run()).resolves.toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/run.human/webapp && npx vitest run src/lib/__tests__/bib-pickup.test.ts
```
Expected: FAIL — "THE GUARD" awards instead of returning null.

- [ ] **Step 3: Implement**

Add the dep and the gate, after the `hasScoreFor` check:

```ts
    // THE GUARD: an operator must have primed this bib. Without it a runner can
    // award themselves 200 by scanning their own QR, which is exactly what this
    // gate exists to stop. Ordered AFTER first-ness so a runner who already
    // collected gets the ordinary message whether or not they were re-primed.
    if (!(await hasPass(userId))) return null;
```

Default implementation:

```ts
  const hasPass =
    deps.hasPass ??
    (async (u: string) => Boolean((await BibPickupPass.get({ userId: u }).go()).data));
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/run.human/webapp && npx vitest run src/lib/__tests__/bib-pickup.test.ts
```
Expected: PASS (all 12).

- [ ] **Step 5: Commit**

```bash
git add apps/run.human/webapp/src/lib/bib-pickup.ts apps/run.human/webapp/src/lib/__tests__/bib-pickup.test.ts
git commit -m "fix(human): bib pickup requires an operator-primed pass"
```

---

### Task 4: Route + both scanner surfaces

**Files:**
- Modify: `apps/run.human/webapp/src/app/api/social-scan/route.ts`
- Modify: `apps/run.human/webapp/src/components/qr/QrScannerModal.tsx:169-183`
- Modify: `apps/run.human/webapp/src/app/(ctf)/r/ScanClient.tsx:72-75`

**Interfaces:**
- Consumes: `ScanResult.bib` from Task 2.

- [ ] **Step 1: Pass `operator` and map the verdict**

In the route, `judgeScan` input gains `operator: isQrAdmin(session)` (the same expression already used for `capExempt`).

On the success path, when `result.bib` is set, include it so the client can render the operator copy:
```ts
  if (result.ok) {
    await Promise.all([
      rescoreBestEffort(session.user.id),
      rescoreBestEffort(result.ownerId),
    ]);
    return NextResponse.json(result);
  }
```
(`result` already carries `bib` — no change needed beyond passing `operator`.)

For `already_today`, return **200** with the priming verdict instead of the bare 409, so an operator working a stack never sees a red error:
```ts
  // An operator re-scanning an already-primed bib is a SUCCESS for priming even
  // though the social pair is spent for the day. Runners still get the 409.
  if (result.code === "already_today" && result.bib) {
    return NextResponse.json({
      code: "bib_ready",
      bib: result.bib,
      ownerName: result.ownerName,
    });
  }
```

- [ ] **Step 2: Render in `QrScannerModal`** — before the generic `res.ok` branch

```ts
      if (res.ok && data.code === 'bib_ready') {
        flashNow('ok', `${data.bib === 'picked_up' ? 'ALREADY PICKED UP' : 'BIB READY'} · ${data.ownerName ?? 'runner'}`);
      } else if (res.ok && data.bib) {
        flashNow('ok', `${data.bib === 'picked_up' ? 'ALREADY PICKED UP' : 'BIB READY'} · ${data.ownerName ?? 'runner'}`);
      } else if (res.ok && data.code === 'bib_pickup') {
```

- [ ] **Step 3: Render in `ScanClient`** — same ordering rule, before the generic `res.ok`.

- [ ] **Step 4: Typecheck + full suite**

```bash
cd apps/run.human/webapp && npx tsc --noEmit && npx vitest run
```
Expected: clean typecheck; suite green (baseline ~1289 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/run.human/webapp/src/app/api/social-scan/route.ts apps/run.human/webapp/src/components/qr/QrScannerModal.tsx "apps/run.human/webapp/src/app/(ctf)/r/ScanClient.tsx"
git commit -m "feat(human): scanner reports Bib ready while priming"
```

---

### Task 5: Data fix script

**Files:**
- Create: `apps/run.human/webapp/scripts/reset-bib-pickup.mts`

Modelled on `scripts/reset-ctf-user.mts`: raw `@aws-sdk` client (entities import `@auth/dynamodb-adapter`, ESM-only, unusable from a `tsx` CJS run), rows written by their **own pk/sk as read from the query** — no key composition.

- [ ] **Step 1: Write the script**

Behavior, dry-run by default, `--confirm` to write:
1. Refuse to run if `RUN_ELECTRO_ENDPOINT` is set (that is local DynamoDB — the documented way a prod `--confirm` wipes the wrong store).
2. Query `pk = $run#challenge_bib-pickup`; print every `CtfSolve` row found.
3. Delete all `CtfSolve` rows on that partition.
4. Re-seed the KPH showcase row: user `041287e3-a0a4-4ffc-9a38-b38f83fb9057`, `ordinal 1`, `firstBlood true`, `points 200`, `solvedAt 2026-08-05T19:00:00.000Z`, `channel qr`.
5. Set `Ctf.solveCount = 1`.
6. Rescore each affected user by importing the PURE `computeUserScore` from `src/lib/scoring-engine.ts` over a raw-SDK read of their ledger, and patch their `RunUser` score fields.

⚠️ Touch ONLY the `bib-pickup` partition and the affected users' score fields. Never scan or delete outside it — run.bib's money rows (`Bib`, `GeneralDonation`, `PendingContribution`, `BibReconcile`) share this physical table.

- [ ] **Step 2: Dry run against prod**

```bash
cd apps/run.human/webapp
AWS_PROFILE=dc34-application npx tsx --env-file=.env scripts/reset-bib-pickup.mts
```
Expected: lists 5 solve rows, prints the 5 before/after scores, writes nothing.

- [ ] **Step 3: Commit** (do NOT `--confirm` yet — that runs after deploy)

```bash
git add apps/run.human/webapp/scripts/reset-bib-pickup.mts
git commit -m "ops(human): reset-bib-pickup — unaward self-scanned pickups"
```

---

### Task 6: Ship

- [ ] **Step 1: Push + open PR**

```bash
git push -u origin feat/bib-pickup-pass
gh pr create --title "fix(human): guard bib pickup behind an operator-primed pass" --body ...
```

- [ ] **Step 2: Merge, GATING on the state**

```bash
gh pr merge <N> --squash --admin
gh pr view <N> --json state --jq .state   # MUST print MERGED before building
```
A chained merge-and-build once shipped a no-op release because `gh pr merge` did not error while the PR stayed OPEN. Gate explicitly.

- [ ] **Step 3: Copy `env.local.sh` into the worktree BEFORE releasing**

```bash
cp /Users/khundeck/working/defcon.run.34/env.local.sh <worktree-root>/env.local.sh
```
Gitignored, so a fresh worktree lacks it; `build.sh` then forms a bare `application` profile that does not exist and dies at the S3 static-asset sync with exit 255 AFTER the image push.

- [ ] **Step 4: Build + push images, open the Release PR (NO deploy)**

```bash
./apps/release-all.sh --apps run.human --pr
```

- [ ] **Step 5: Deploy via GitHub Actions**

```bash
gh workflow run deploy.yml -f region=us-east-1 -f pr_number=<ReleasePR#> -f invalidate_cache=true
gh run watch <run-id>
```

- [ ] **Step 6: Verify the live version actually rolled**

```bash
curl -s https://run.defcon.run/use1/ | grep -oE 'v0\.0\.[0-9]+'
```
ECS does a rolling replace, so poll for a stable streak — CI green is not proof the new task is serving.

- [ ] **Step 7: Run the data fix with `--confirm`**, then re-verify the 5 scores.

---

## Self-Review

**Spec coverage:** §1 entity → Task 1. §2 minting → Task 2. §3 operator feedback/`bibStatus` → Tasks 2+4. §4 enforcement → Task 3. §5 behavior matrix → Tasks 2+3 tests. §6 data fix → Task 5. §7 tests → Tasks 2+3. Ship steps → Task 6. No gaps.

**Type consistency:** `bibStatus` returns `BibScanStatus` = `"none" | "ready" | "picked_up"` in Tasks 2, 4, 5. `mintPickupPass(userId, grantedBy)` argument order matches the fake store and `defaultScanStore`. `hasPass(userId)` is the only new `judgeBibPickup` dep. `ScanResult.bib` is the same optional field on both variants.

**Known risk:** Task 2 adds imports from `@/entities/bib` and `@/lib/ctf-judge` into `social-scan.ts`. `bib-pickup.ts` already imports from `ctf-judge`; `social-scan.ts` must import `BIB_PICKUP_CHALLENGE` from `bib-pickup.ts` one-way only. If a cycle appears, move the const to its own module.
