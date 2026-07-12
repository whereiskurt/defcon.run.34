# Bib name → rabbit name sync

**Date:** 2026-07-11
**Status:** Approved — ready for implementation
**Services touched:** run.bib (caller), run.human (RunUser + internal API)

## Problem / intent

When a runner saves the name they want printed on their bib (`nameOnBib` in
run.bib), that is almost always the name they also want as their run.human
"rabbit name" (`displayName`). Today the two are independent: a runner sets a
bib name and their rabbit name stays the auto-generated `rabbit_XXXX`.

We want a bib-name save to propagate to the rabbit name — but only until the
runner has taken ownership of their rabbit name by editing it manually with the
profile pencil. Once they do that, the rabbit name is theirs and the sync must
never overwrite it again.

## Behavior contract

1. **Direction:** one-way, run.bib → run.human only. Editing the rabbit name in
   run.human never changes the bib name.
2. **Sync-until-claimed:** every successful bib-name save copies the name to the
   rabbit name *until* the runner manually edits the rabbit name via the profile
   pencil. From that point the rabbit name is manual-only and the sync is a
   permanent no-op for that user ("keep saving over it's fine, until they set it
   themselves — then it's only editable manually").
3. **Length reconciliation** (bib name is 0–24 chars; rabbit name is 3–20):
   - Trimmed bib name **< 3 chars** (including empty / cleared / burned): **skip**
     the sync, leave the rabbit name untouched (never wipe their identity).
   - Trimmed bib name **> 20 chars**: copy the **first 20 chars**.
   - Otherwise: copy verbatim.
4. **Fail-open:** the bib-name save is the primary action and its own source of
   truth. Any sync failure (network, non-2xx, timeout, missing user) is logged
   and swallowed; it never blocks or fails the bib save. Mirrors the existing
   `getSocialQrHash` resilience contract in run.bib.
5. **No extra quota:** the sync does **not** consume run.human's
   `displayname_change` quota. The runner already spent a `bibname_change` quota
   on the bib side; the rabbit-name update is an internal side effect, not a
   user-initiated name change.

## The "manually claimed" marker

Add an optional boolean `displayNameManual` to the run.human `RunUser` entity.

- **Profile pencil** (`PATCH /api/user`, `displayName` branch) sets
  `displayNameManual = true` whenever the user edits their own display name.
- **Bib sync** write sets `displayNameManual = false` on every write, so
  subsequent bib saves keep syncing (the "keep saving over" requirement) until
  the pencil flips it to `true`.

### Back-compat for existing users (no migration job)

Existing RunUsers won't have the flag. The sync infers the lock state when the
flag is **absent**:

```
autoDefault = `rabbit_${adapterUserId.slice(0, 4)}`   // exactly what upsertRunUser generates
locked = (displayNameManual === true)
      || (displayNameManual === undefined && currentDisplayName !== autoDefault)
```

Because nothing has ever bib-synced before this ships, any pre-ship
`displayName` that differs from the exact auto-default was set deliberately by
the user → treated as locked. A user still on the exact `rabbit_XXXX` default is
unclaimed → first bib save syncs and stamps `displayNameManual = false`, so all
later saves see an explicit flag and never re-run the heuristic.

## Components

### run.human

1. **`entities/run-user.ts`**
   - Add `displayNameManual` (boolean, optional) to the `RunUser` attributes and
     the `RunUserItem` type.
   - `updateRunUserProfile` already does `.set(data)`, so it can carry
     `displayNameManual` with no signature change beyond the type.

2. **`app/api/user/route.ts` (profile pencil)**
   - In the `displayName` branch of `PATCH`, also set `displayNameManual: true`
     when writing the profile.

3. **`app/api/internal/user/[oidcSub]/route.ts` (new PATCH handler)**
   - Same `X-Internal-Secret` gate and OIDC-sub → adapter userId → RunUser
     resolution as the existing GET.
   - Body `{ displayName: string }`. Server-side: trim; if `< 3` chars →
     `200 { synced: false, reason: "too_short" }`; truncate to 20.
   - Load the RunUser, compute `locked` (above). If locked →
     `200 { synced: false, reason: "manual" }`, no write.
   - Else `updateRunUserProfile(adapterUserId, { displayName, displayNameManual: false })`
     and return `200 { synced: true, displayName }`. **No quota consumption.**
   - Errors resolve to a non-2xx JSON, matching the GET handler's shape.

### run.bib

4. **`lib/rabbit-name-sync.ts` (new helper)**
   - Reuse the internal-URL derivation + `X-Internal-Secret` pattern from
     `lib/social-qr.ts` (share the `HUMAN_BASE_URL` / `INTERNAL_SECRET`
     resolution; factor out if clean, otherwise mirror it).
   - `export async function syncRabbitName(ownerSub, name): Promise<boolean>` —
     `PATCH ${HUMAN_BASE_URL}/api/internal/user/${sub}` with `{ displayName }`.
     Catches everything, returns `false` on any failure/non-2xx (never throws).

5. **`app/api/bib/route.ts` (`PATCH`)**
   - After `updateBibName(...)` succeeds and only when `nameOnBib` was provided:
     compute `trimmed = nameOnBib.trim()`. If `trimmed.length >= 3`, call
     `syncRabbitName(session.user.id, trimmed.slice(0, 20))` inside a
     try/catch (best-effort, awaited so the ECS Node runtime completes it, but
     never allowed to affect the response). `< 3` chars → skip.

## Testing

- **run.human internal PATCH** (unit): secret gate (403), unknown sub (404),
  locked-by-flag skip, locked-by-heuristic skip (non-default name, no flag),
  unclaimed overwrite + `displayNameManual: false` stamped, too-short skip,
  >20 truncation, quota is NOT called.
- **run.human `/api/user` pencil** (unit): editing displayName stamps
  `displayNameManual: true`.
- **run.bib `syncRabbitName`** (unit): success → true; non-2xx → false; throw →
  false (never throws out).
- **run.bib `PATCH /api/bib`** (unit): name save triggers sync with truncated
  name; <3 char / cleared name skips sync; a sync throw does not fail the save.

## Out of scope

- Bidirectional sync (rabbit → bib).
- Backfilling existing bibs into rabbit names in bulk.
- Changing run.human's 3–20 displayName rules or run.bib's 24-char cap.
- Uniqueness enforcement on either name (neither is unique today).
