# Bib Pickup — the first self-scan

**Date:** 2026-08-01
**App:** `run.human`
**Surfaces:** `POST /api/social-scan`, `/r` (ScanClient), `QrScannerModal`

## Problem

Bib pickup at the event needs an identity check that a volunteer can trust in
about three seconds. Kurt's workflow:

> runner shows up for bib pickup, they say their bib, we show it to them, and
> then make them scan it. Once it shows bib pickup we know it's really theirs.

Today, scanning your own QR is a dead end: `judgeScan` returns `code: "self"`
and both surfaces say *"That's your own QR code!"*. That message is correct as a
**second** message — but the **first** self-scan is exactly the moment that
proves the person holding the phone owns the bib in their hand.

## Design

### Trigger

A self-scan — the existing `code: "self"` branch. No new scan entry point, no
new QR payload. Both surfaces already POST to `/api/social-scan` and branch on
`data.code`, so the whole feature hooks in at that one server decision.

### The rule

| Condition | Result |
|---|---|
| First self-scan **and** the runner has a bib | **Bib Pickup!** — render their bib, award 200 |
| Self-scan again (already picked up) | today's *"That's your own QR code!"* |
| Self-scan with **no bib** | today's *"That's your own QR code!"* |

Once-ever is not a new flag: it falls out of the CTF solve ledger. `judgeSolve`
returns `solved: false` on a replay, and that failure is exactly the signal to
fall through to the ordinary self message. There is no separate "has picked up"
boolean to keep in sync.

### Points — why the CTF ledger

The derived score (`scoring-engine.ts`) is:

```
score = runStreak + socialStreak + ctfStreak + flagPoints
```

Accomplishments carry **no points** — `EngineAccomplishment` is
`{ source, completedAt }`, and an accomplishment's only contribution is lighting
a con-day for `runStreak`. `flagPoints` is therefore the only mechanism in this
codebase that pays a discrete, once-ever award. That is the same path `jack-egg`
uses, so bib pickup uses it too:

```ts
judgeSolve({ user, challenge: "bib-pickup", channel: "qr", grant: true })
```

`grant: true` skips answer validation — the server has already proven
entitlement out of band (the scan resolved to the caller's own hash). Every
other gate (`enabled`, windows, claims) still applies.

**This requires a seeded `bib-pickup` Ctf row.** `judgeSolve` treats a missing
or disabled challenge as a non-solve, so until the row exists the feature is
inert: a self-scan simply shows the old message. That is a safe failure — never
a crash, never a bib screen without an award — but it does mean **the seed is
part of shipping, not an afterthought.** The row is added to the existing
`scripts/seed-ctf-dc34.mts`, which already full-inserts grant-only rows
(`jack-egg`, `exceptional-run`, `unlock-*`).

Trade-off accepted: the award renders as a line in the **CTF** section of the
runner's drill, because that is where flag points live.

### API contract

`POST /api/social-scan`, in the `result.code === "self"` branch only:

1. Resolve the caller's bib. No `runnerCode` → return today's `self` 400 unchanged.
2. `judgeSolve(... grant: true)`. Not solved (replay, or row unseeded) → today's `self` 400 unchanged.
3. Solved → `rescoreBestEffort`, then **200**:

```jsonc
{
  "code": "bib_pickup",
  "points": 200,
  "bib": { "nameOnBib": "KPHKPH2", "runnerCode": "BIB-RXRN", "hasSponsored": true }
}
```

`bib_pickup` is a **success** (200), unlike every other self outcome. Both
clients must branch on `data.code === "bib_pickup"` *before* their generic
`res.ok` path, or the scanner would flash "PAIRED".

### Data

run.human's `entities/bib.ts` is a read-only mirror of the bib service's entity
and currently declares only `ownerSub` and `runnerCode`. It gains `nameOnBib`
and `paidAmount` (still read-only — run.bib owns every write), plus
`getBibForPickup(adapterUserId)`.

The adapter-id → OIDC-sub bridge already in that file still applies: bibs are
keyed by the OIDC sub, **not** the Auth.js adapter id. `getBibForPickup` reuses
`resolveOidcSub` rather than re-deriving it.

### Rendering

`BibPreview` is ported from run.bib into run.human so the runner sees the
**actual bib**, not an approximation — the point of the screen is that they
recognise the thing about to be handed to them. It carries `dc34-logo` and
`dc34-smiley` (data URIs) and needs `qrcode`, already a run.human dependency.
`useCopy` resolves against run.human's own CopyProvider.

- **`/r` (ScanClient)** — the primary surface. A phone camera opening the bib
  stub's QR lands here. Full "🎉 Bib Pickup!" + rendered bib + "+200 🥕".
- **`QrScannerModal`** — the in-app camera. Flashes `BIB PICKUP!` as a success;
  the full bib render belongs on the dedicated page, not a camera overlay.

## Error handling

- **No bib** → unchanged self message (a runner with no bib has nothing to pick up).
- **Unseeded/disabled challenge** → unchanged self message. Inert, not broken.
- **Bib read fails** → unchanged self message; a lookup error must never block the scan path.
- **Award succeeds but rescore fails** → still a 200 with the bib screen.
  `rescoreBestEffort` is already best-effort; the ledger row is the truth and the
  next rescore picks it up.

## Testing

| Test | Asserts |
|---|---|
| first self-scan, has bib | 200, `code: "bib_pickup"`, bib payload, judgeSolve called with `grant: true` |
| second self-scan | 400 `self` — no second award |
| self-scan, no bib | 400 `self`, judgeSolve **never called** |
| challenge unseeded | 400 `self` — inert, no crash |
| non-self scan | untouched by any of this |
| payload scope | response carries only the caller's own bib |

## Non-goals

- Any volunteer-facing tooling. The runner scans; there is no operator screen.
- Marking pickup on the bib service. run.bib owns bib state; this only reads.
- Changing the scoring engine. The award rides the existing `flagPoints` path.
