# Post-flash Welcome DM — Design

**Date:** 2026-07-26
**Status:** Approved (Kurt, 2026-07-26 — ship live authorized)
**Scope:** After every successful flash + configure + registration, the radio
receives a PKI DM from `!dc340001` "DEF CON 34 MeshMap" welcoming the user —
immediately, with a proof-of-life re-flush so radios that come online a few
minutes later still get it.

## Decisions (ratified)

| Question | Decision |
|----------|----------|
| Content/sender | MeshMap welcome from `!dc340001`: "Welcome to defcon.run, `<displayName|runner>`! Your radio is configured and on the mesh. Reply hi to any rabbit 🐇 or visit run.defcon.run" |
| Frequency | Every successful flash+configure (re-flashes included — doubles as an end-to-end check) |
| Timing | Publish immediately + hand the byte-identical envelope to the fleet's proof-of-life pending store (10-min TTL re-flush; device packet-id dedup makes duplicates invisible) |

## Architecture (rides the OTP-delivery rails)

### Trigger: run.human internal registration route

`/api/internal/meshtastic-radios` (called by run.flash after successful
configure; the authoritative success moment) enqueues a **`MeshWelcomePending`**
item after the MeshRadio upsert, best-effort (enqueue failure never fails
registration). Message text rendered server-side with the RunUser displayName
(fallback "runner").

### Queue entity

Same physical partition as the OTP queue — pk composite `queue="otp"` →
`pk = "$run#queue_otp"` (pk carries no entity name); distinct sk prefix:

- `sk = "$meshwelcomepending_1#nodeid_<nodeId>"` (entity `MeshWelcomePending`
  v1, service `run`)
- Attributes: `queue`, `nodeId`, `nodeNum`, `message`, `userId`, `attempts`,
  `createdAt`. No collision with `$meshotppending_1#…` items for the same node.
- Parity-locked on both sides (vitest ↔ Go), fixture `!433d1cec`.

### meshtk delivery (extends the existing poller)

- `otpqueue.List` widens: Query the partition **without** an sk prefix
  condition; classify each item by sk prefix into `Item` (otp) or
  `WelcomeItem`; unknown prefixes are skipped with a log (forward compat).
- Poller welcome path: same pubkey chain (item → keycache → observed; flash
  rows always carry the read-back pubkey), same PKI build/publish from
  `!dc340001` on `msh/US/2/e/PKI/!dc340001`. On success: delete item, then
  **queue the same envelope bytes into the fleet's pending store** so the next
  proof-of-life transmission from that radio (within the existing 10-min
  pending TTL / flush caps) re-publishes identical bytes — invisible duplicate
  if the first landed, delivery-on-first-contact if it didn't.
- Same guardrails as OTP items: 24 h age reap, 10-attempt cap, per-pass
  summary log line (now `welcome=N` too).
- No `codeSentAt` stamp for welcome items (nothing reads it).

### UI

Done step gains one line (copy-snapshot append):
"Watch your radio — a welcome message from DEF CON 34 MeshMap is on its way."

## Known limitation

A radio that first connects more than ~10 min after the initial publish misses
the welcome (pending-store TTL). Accepted: booth flow pairs within minutes,
and re-flashing sends a fresh one.

## Testing

- vitest: MeshWelcomePending key parity; internal registration route enqueues
  (and failure is swallowed).
- Go: List classification (otp/welcome/unknown mixed partition); welcome
  success path (send → delete → pending-store handoff), failure bump, reap.
- Live UAT: flash or re-flash a board; welcome DM arrives from "DEF CON 34
  MeshMap"; ghosts log shows `welcome=1`.

## Out of scope

- Longer-horizon retry (wait-until-seen beyond 10 min).
- Any change to the OTP item contract or verify flow.
