# Bib Pickup Pass — guard the pickup award behind an operator scan

**Date:** 2026-08-04
**App:** run.human
**Supersedes the trigger in:** `docs/superpowers/specs/2026-08-01-bib-pickup-self-scan-design.md`

## Problem

The bib pickup award (200, once ever) currently fires on a runner's **first self-scan
of their own QR**, with no other gate. That was meant to model "a volunteer showed me
my bib at the pickup table and I scanned it" — but nothing actually requires the
volunteer. Four runners have already self-scanned out of curiosity and been awarded:

| user | name | ordinal | score before | score after unaward |
|---|---|---|---|---|
| `430f1e6f` | franchyze923 | 1 (first blood) | 210 | 10 |
| `70a89c0f` | scamp | 2 | 335 | 135 |
| `615e7f7d` | runlevel3 | 3 | 1240 | 1040 |
| `8cc36ced` | rabbit_8cc3 | 4 | 200 | 0 |
| `041287e3` | KPH (fabricated showcase row) | 1 (first blood) | 11165 | 11165 (re-seeded) |

The self-scan alone must stop unlocking the award, and the existing awards must be
reversed.

## Solution

Split the pickup into two scans by two different people:

1. **Prime** — an operator scans the runner's bib QR. This is an ordinary social scan
   (both parties get `+1 socialScore` as they do today) and additionally leaves a
   durable **`BibPickupPass`** row keyed to the runner. The scanner UI reports
   **"Bib ready — \<name\>"**.
2. **Redeem** — the runner scans their own QR. The pass is what unlocks the bib screen
   and the 200. No pass → the ordinary "You cannot scan your own QR code!".

The pass is deliberately **durable, with no expiry**: the operator intends to prime an
entire box of bibs the day before the con, and those runners collect over the following
days.

### Accepted risk

Priming ahead of time means the pass no longer proves the runner was physically
present — a primed runner can self-scan from their hotel room and bank the 200 without
walking to the table. Raised with and explicitly accepted by Kurt on 2026-08-04: the
physical bib still requires a human to hand it over, and the points are a game.
The mitigation, if it is ever wanted, is to additionally require `grantedAt` to fall on
the same PT day as the redemption — a one-line change at the enforcement point.

## Design

### 1. `BibPickupPass` entity

New entity in `src/entities/social.ts`, mirroring the existing `SocialEgg` shape
(per-user marker, `sk` empty, one row per user):

```ts
BibPickupPass {
  userId:    string   // pk — the RUNNER (owner of the scanned QR)
  sk:        []       // exactly one row per runner
  grantedBy: string   // operator's userId (audit trail)
  grantedAt: string   // ISO timestamp
}
```

Written with `.put()`, so re-priming the same runner is idempotent and simply refreshes
`grantedAt`/`grantedBy`. Read with a single `.get()` on the redemption path.

**No `ttl` attribute.** `describe-time-to-live` on `run-human-electro` reports
`DISABLED`, so the `ttl` attributes several `Ctf*` entities already write are decorative
and nothing auto-expires. Writing one here would imply a cleanup that does not happen.
Row count is bounded by the roster (one per runner), so growth is a non-issue.

### 2. Minting — inside `judgeScan`

`judgeScan` gains an `operator?: boolean` input. `app/api/social-scan/route.ts` passes
`isQrAdmin(session)`, which it already computes for `capExempt`, so the operator set is
`QR_ADMIN_GROUPS` = `admin` + `runadmin` + `qradmin` — the same people who already get
attendance mode and the daily-cap exemption.

**Placement is load-bearing:** the mint fires *after* the self-check and *before* the
pair-day claim. `SocialPair` blocks a repeat scan of the same pair on the same PT day
(`already_today`, HTTP 409). If minting happened only on the success path, an operator
re-scanning a bib they had already scanned that day would silently mint nothing, and the
runner could never redeem. Minting before the claim makes a re-scan always effective.

Never mints on `bad_token`, `not_found`, or `self` — an operator scanning their own QR
resolves to `self` before reaching the mint.

### 3. Operator feedback — branch on the bib, not on the operator

The bib lookup happens **inside `judgeScan`, behind the store seam** — not in the route.
`ScanStore` gains one method:

```ts
/** Operator scans only: does this runner have a bib, and did they collect it? */
bibStatus(userId: string): Promise<"none" | "ready" | "picked_up">
```

`defaultScanStore` implements it with `getBibForPickup` + the same `hasScoreFor`
existence read `judgeBibPickup` uses. Keeping it here rather than in the route means the
mint decision and the reported verdict are made in one place, from one read, and both
are testable through the fake store with no DynamoDB.

`judgeScan` therefore mints **only** when `operator === true` and `bibStatus === "ready"`,
and reports the verdict on its result so the route is a pure HTTP mapping:

| Operator scans… | `bibStatus` | Response | Pass minted |
|---|---|---|---|

| Operator scans… | Response | Pass minted |
|---|---|---|
| runner with a bib, not yet picked up | `ready` | `bib_ready` — "Bib ready — \<name\>" | yes |
| same runner again, any day | `ready` | `bib_ready` (**not** a red 409) | yes, refreshed |
| runner who already picked up | `picked_up` | `already_picked_up` — "\<name\> already picked up" | no |
| runner with no bib | `none` | ordinary `PAIRED` / `already_today` | no |

Because the mint sits before the pair-day claim, the `bib_ready` verdict must be carried
on **both** the success result and the `already_today` result. `ScanResult` gains an
optional `bib?: "ready" | "picked_up"` field on the `ok: true` variant, and the
`already_today` failure variant gains the same field plus `ownerName`, so the route can
render "Bib ready — \<name\>" with HTTP 200 on a same-day re-scan instead of the bare
409 an operator working through a stack would read as an error.

The branch is on the **bib**, not on the scanner's group, because operators also use
attendance mode for ordinary run scanning where "BIB READY" would be nonsense. This
keeps priming a stack honest and never tells a runner without a bib that theirs is
ready. Cost: two extra point-reads (bib + prior-solve), **on operator scans only** —
ordinary runner-to-runner scans are unchanged and pay nothing.

Both scanner surfaces — `/r` (`ScanClient.tsx`) and `QrScannerModal.tsx` — must branch
on the new codes **before** their generic `res.ok` path, the same requirement the
existing `bib_pickup` code already carries.

### 4. Enforcement — `judgeBibPickup`

Gate order (all failures return `null` → caller shows the ordinary self message, so the
feature continues to fail inert):

1. no bib → `null` (unchanged — do not burn the once-ever award on someone with nothing
   to collect)
2. already picked up, via `hasScoreFor` → `null` (unchanged — this, not the pass, is
   what makes the award once-ever)
3. **no `BibPickupPass` row → `null` (new — this is the hole being closed)**
4. otherwise → grant, render the bib

`hasScoreFor` stays ahead of the pass check so that a runner who already picked up gets
the ordinary message whether or not they were re-primed.

### 5. Behavior matrix

| Situation | Result |
|---|---|
| Runner self-scans, never primed | ordinary self message — **the hole being closed** |
| Operator primes → runner self-scans, any time later | bib screen + 200 |
| Runner self-scans twice after being primed | first shows the bib, second is the ordinary message |
| Runner scans the *operator's* QR instead | no pass — the operator must be the scanner |
| Operator self-scans their own QR | no pass (self-check precedes the mint) |
| Non-operator scans a runner's QR | no pass — ordinary social scan |

### 6. Data fix — `scripts/reset-bib-pickup.mts`

Modelled on `scripts/reset-ctf-user.mts`: raw `@aws-sdk` client (the entities import
`@auth/dynamodb-adapter`, which a `tsx` CJS run cannot require), rows written by their
**own pk/sk as read from the query** — no key composition, zero entity-key drift risk.
**Dry-run by default**; `--confirm` to write.

Steps:

1. Delete all 5 `CtfSolve` rows on `$run#challenge_bib-pickup`.
2. Set `Ctf.solveCount = 0`.
3. Re-seed the KPH showcase row: `041287e3`, `ordinal 1`, `firstBlood true`,
   `points 200`, `solvedAt 2026-08-05T19:00:00.000Z`.
4. Set `Ctf.solveCount = 1`.
5. Rescore all 5 affected users.

There are no `CtfScoreEvent` or `CtfAttempt` rows on that partition (verified), so the
solve rows plus the counter are the whole footprint.

**Ordinals are cosmetic on this challenge**: `pointMax == pointFloor == 200` and
`firstBloodBonus == 0`, so re-seeding KPH at ordinal 1 costs the next real picker-upper
nothing but a number.

**Safety:** the script must refuse to run when `RUN_ELECTRO_ENDPOINT` is set (that is
local DynamoDB — the documented way a prod `--confirm` silently wipes the wrong store),
matching `reset-all-scores.mts`. It touches only the `bib-pickup` partition and the five
named users' score fields; it must never scan or delete outside that partition, because
run.bib's money rows (`Bib`, `GeneralDonation`, `PendingContribution`, `BibReconcile`)
share the same physical table.

### 7. Tests

`src/lib/__tests__/bib-pickup.test.ts`:
- no pass → `null` (the regression this whole change exists to prevent)
- pass present → award
- already solved + pass present → `null` (first-ness still wins)
- no bib + pass present → `null`

`src/lib/__tests__/social-scan.test.ts`:
- operator scan of a bib-holder mints a pass and reports `bib: "ready"`
- operator scan returning `already_today` **still** mints and **still** reports
  `bib: "ready"` + `ownerName` (the 409 trap)
- operator scan of a runner who already picked up reports `bib: "picked_up"` and mints
  nothing
- operator scan of a runner with no bib mints nothing and reports no `bib` field
- non-operator scan of a bib-holder never mints (and never calls `bibStatus`)
- self-scan never mints

`src/lib/social-scan.ts` is a pure judge over an injectable `ScanStore`, so the mint is
tested through a fake store with no DynamoDB — the existing pattern.

## Out of scope

- Revoking a pass (no operator UI for un-priming; delete the row by hand if ever needed).
- Any change to how the 200 is valued, or to `socialScore`.
- The `ttl`-attributes-do-nothing finding on `run-human-electro` — noted here, not fixed.
