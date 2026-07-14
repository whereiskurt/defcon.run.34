# CTF score integration for the DC33 total-score migration

**Audience:** the separate DC33 total-score mapper (the `leaderboard` worktree).
**Purpose:** give you the exact, committed read for a user's CTF contribution so you
can roll it into your global total without reverse-engineering our data layer.

**Ownership boundary (read this first):**

- **We own and expose** the CTF signal on `run.human`. You **read** it and add it to
  your global total: `globalScore = activityScore + ctfScore` is computed on **your**
  (consumer) side.
- **We do NOT build the global/total leaderboard here.** That is your worktree.
- **Our writes are NOT coupled to the DC33 schema.** This doc describes a read
  contract only. The `q` admin leaderboard (Phase 47) is **CTF-only** — it is not the
  global board.

---

## Where the data lives

| | |
|---|---|
| **Table** | `run-human-electro` (env `RUN_ELECTRO_DBNAME`, defaults to `run-human-electro`) |
| **Region** | `us-east-1` |
| **Data layer** | [ElectroDB](https://electrodb.dev) — service `run`, version `1` for every entity below |
| **Source files** | `apps/run.human/webapp/src/entities/run-user.ts` (`RunUser`), `apps/run.human/webapp/src/entities/ctf.ts` (`CtfSolve`) |

ElectroDB is the **authoritative key encoder**. The raw `pk`/`sk` strings below are
given so a non-ElectroDB reader can build keys directly, but if you can use ElectroDB,
prefer the entity queries — the encoding (`$<service>#<attr>_<value>` for partitions,
`$<entity>_<version>#...` for sort keys, with attribute names lower-cased) is an
ElectroDB implementation detail we do not want you to hand-maintain.

---

## The fast read — `RunUser.ctfScore` (rollup)

`RunUser.ctfScore` is a **running total maintained by the judge via atomic `ADD`**, and
`ctfSolves` is a solve **count**. These are cheap rollups intended for leaderboard reads —
one `GetItem` per user, no aggregation.

**Entity:** `RunUser` (`service: "run"`, `version: "1"`)

**Primary key:**

| Part | Composite | Encoded string |
|------|-----------|----------------|
| `pk` | `["userId"]` | `$run#userid_<userId>` |
| `sk` | `[]` (constant) | `$runuser_1` |

**Fields you care about:**

- `ctfScore` (number, default `0`) — the running CTF point total. **Rollup, not source of truth.**
- `ctfSolves` (number, default `0`) — number of challenges solved.

`ctfScore` for a user **==** `sum(CtfSolve.points)` over that user's solve rows
(see the `run-user.ts` comment: *"CtfSolve rows are the auditable source of truth
(ctfScore can be recomputed as sum(points))"*). So you may **trust `ctfScore` for speed**,
or **recompute from `CtfSolve` for audit** — your choice.

---

## The source of truth — `CtfSolve` rows (auditable)

One `CtfSolve` row per `(challenge, user)`. These rows are the auditable ledger; the
rollup above is derived from them.

**Entity:** `CtfSolve` (`service: "run"`, `version: "1"`)

**Primary key** (all solvers of a challenge share a partition; each user is one row):

| Part | Composite | Encoded string |
|------|-----------|----------------|
| `pk` | `["challenge"]` | `$run#challenge_<challenge>` |
| `sk` | `["user"]` | `$ctfsolve_1#user_<user>` |

**`byUser` GSI** — index `gsi1pk-gsi1sk-index` — this is your **"all my solves"** read:

| Part | Composite | Encoded string |
|------|-----------|----------------|
| `gsi1pk` | `["user"]` | `$run#user_<user>` |
| `gsi1sk` | `["challenge"]` | `$ctfsolve_1#challenge_<challenge>` |

**Scored / audit attributes on each row:**

| Attribute | Type | Notes |
|-----------|------|-------|
| `challenge` | string | challenge id |
| `user` | string | run.human user id — the same value as `RunUser.userId`, so it joins the two entities |
| `ordinal` | number | gap-free solve order (`n`) |
| `points` | number | points awarded for this solve — **sum these to rebuild `ctfScore`** |
| `firstBlood` | boolean | first solver of the challenge |
| `tierCeiling` | number | scoring ceiling in effect at solve time (audit) |
| `channel` | `"qr"` \| `"covert"` | how it was solved |
| `solvedAt` | string | UTC-ISO timestamp |

> **Shared-index note:** `gsi1pk-gsi1sk-index` is a table-wide GSI also used by other
> entities (e.g. `RunUser.byHash`). The partition **value** namespaces them —
> `CtfSolve.byUser` rows have `gsi1pk = "$run#user_<user>"`, so a raw query on that exact
> prefix returns CtfSolve rows only. ElectroDB adds this entity filter for you.

---

## Sample queries

### (a) All solves for a user — ElectroDB (idiomatic)

```ts
import { CtfSolve } from "@/entities/ctf";

// Every CtfSolve row for one user, via the byUser GSI.
const { data } = await CtfSolve.query.byUser({ user }).go();
// data: CtfSolveItem[] — sum data.map(r => r.points) to recompute the CTF total.
```

### (b) All solves for a user — raw DynamoDB (no ElectroDB)

```js
// AWS SDK v3 QueryCommand
{
  TableName: "run-human-electro",
  IndexName: "gsi1pk-gsi1sk-index",
  KeyConditionExpression: "gsi1pk = :pk",
  ExpressionAttributeValues: {
    ":pk": `$run#user_${user}`,   // e.g. "$run#user_user-123"
  },
}
// Returns this user's CtfSolve rows; sum the `points` attribute for the CTF total.
```

### (c) The fast rollup — read `ctfScore` via a RunUser GetItem

```ts
import { RunUser } from "@/entities/run-user";

const { data } = await RunUser.get({ userId }).go();
const ctfScore = data?.ctfScore ?? 0;   // cheap leaderboard read
const ctfSolves = data?.ctfSolves ?? 0;
```

Raw-key equivalent (`GetItem`):

```js
{
  TableName: "run-human-electro",
  Key: { pk: `$run#userid_${userId}`, sk: "$runuser_1" },
}
// Item.ctfScore / Item.ctfSolves
```

---

## Integration boundary (non-goals)

- **The global/total leaderboard is NOT built here** — the DC33 `leaderboard` worktree
  owns it. We expose the CTF signal; you map it into your total.
- **Our writes are NOT coupled to the DC33 schema.** If the mapper needs a shape we do
  not emit, that transformation lives on the consumer side, not in our entities.
- **The `q` admin leaderboard (Phase 47) is CTF-only** — not the global board.
- **Trust model:** `ctfScore` (rollup) for speed; `CtfSolve` rows (ledger) for audit —
  the two must agree because `ctfScore == sum(CtfSolve.points)`.
