# Radio OTP Device Verification — Design

**Date:** 2026-07-25
**Status:** Approved (Kurt, 2026-07-25)
**Scope:** Finish the manual-add Meshtastic radio flow: deliver the site-minted
verification code to the physical device over the mesh (MQTT), proving the user
owns the device they claim.

## Problem

The site side of manual radio add is fully built and live in run.human:

- `POST /api/meshtastic-radios` mints a 6-digit `verificationCode` on the
  authoritative `MeshRadio` row (`verified=false`, `verificationAttempts`,
  `resendAttempts`).
- `PATCH` verifies the entered code (5-attempt cap).
- `POST /api/meshtastic-radios/resend` rotates the code (3-resend cap).
- The UI shows a code-entry box claiming "A verification code was sent to your
  radio."

**Nothing ever sends the code to the device.** The row sits in DynamoDB and the
UI statement is a lie. This design closes that gap.

## Decisions (ratified via Q&A)

| Question | Decision |
|----------|----------|
| OTP transport | **PKI DM only** — X25519-encrypted direct message using the device's public key. Verifying proves possession of the device private key. No channel-PSK fallback. |
| Send trigger | **meshtk polls DDB** — no new network paths or secrets between run.human and meshtk. |
| Sender identity | **`!dc340001` "DEF CON 34 MeshMap"** — the existing official virtual node; keys already in config. |
| No pubkey yet | **Queue + show status** — wait for a user-supplied key or an observed NODEINFO; the site card shows delivery state honestly. |

## Architecture

### The queue (new, replaces full-table scanning)

The MeshRadio entity has no all-radios index (pk is per-nodeId, GSI1 per-user),
so polling MeshRadio directly would mean a full-table Scan every cycle. Instead,
run.human enqueues delivery work in the same DynamoDB table under a constant
partition:

- **Entity:** `MeshOtpPending` — `pk = "$run#otpqueue"` (constant, ElectroDB
  conventions), `sk = <canonical nodeId>`.
- **Attributes:** `nodeId`, `nodeNum` (uint32), `code` (6-digit string),
  `publicKey` (0x-hex, optional — user-supplied at add time), `userId`,
  `createdAt`, `attempts` (meshtk-incremented). Expiry: the live table has DDB
  TTL **disabled**, so the meshtk poller reaps items whose `createdAt` is older
  than 24 h (no infra change).
- **Writers:** run.human `POST` (add) and `POST /resend` upsert the item with the
  current code. Resend also clears `codeSentAt` on the MeshRadio row.
- **Reader/deleter:** meshtk. Item is deleted on successful send; ages out via
  TTL if the radio is never reachable.

Key composition on the meshtk side is byte-identical to run.human's ElectroDB
output and **locked by a parity test**, exactly like the existing
`keycache.meshRadioKey` contract.

### meshtk poller (in the ghosts/fleet process)

The fleet process already owns an MQTT publish client, the live node DB
(observed NODEINFO pubkeys), and PKI DM machinery (`PublishPKIMessage`). Add a
poller loop:

1. Every ~20 s, `Query` the single `$run#otpqueue` partition (≈0.5 RCU; never a
   Scan).
2. For each item, resolve the device pubkey: queue item's `publicKey` → else the
   fleet node DB's observed NODEINFO key for that nodeNum. No key → leave item
   queued; retry next poll.
3. Send a PKI-encrypted DM **from `!dc340001`** to the device on the PKI topic:
   `run.defcon.run radio verification code: <code>`.
4. On publish success: delete the queue item, then `UpdateItem` the MeshRadio
   row (byte-identical key) setting `codeSentAt = now`.
5. On publish failure: increment `attempts` on the item; give up and log at 10.

Sender keys come from the existing `NodeInfo.PKI` config block
(`meshtk.dc34.yaml`). Code lives upstream in `~/working/meshtk`, then syncs into
`apps/run.mqtt/meshtk` for the container build (standing repo rule).

### run.human changes (small)

- `POST` (add) and `POST /resend`: also upsert the `MeshOtpPending` item; resend
  clears `codeSentAt`.
- `GET` already strips only `verificationCode`; `codeSentAt` flows to the client
  automatically once present.
- `MeshtasticRadios.tsx` unverified card becomes honest:
  - `codeSentAt` present → "Code sent HH:MM — check your radio."
  - absent → "Waiting to reach your radio on the mesh — make sure it's
    connected."
- Existing caps unchanged: 5 verification attempts, 3 resends. The verify path
  (`PATCH`) is untouched.

### IAM / infra

The mqtt task role needs `dynamodb:Query` on the table plus
`UpdateItem`/`DeleteItem`, scoped to the `$run#otpqueue` partition and
`$meshradio_1` rows. If the role lives outside the `ecs-task` Terraform module,
the IAM change needs its own CI apply — `deploy.yml` only applies
`ecs-task`/`ecs-service`.

## Error handling

| Failure | Behavior |
|---------|----------|
| No pubkey known | Item stays queued; UI shows "waiting"; TTL reaps at 24 h. |
| MQTT publish fails | Retry next poll; `attempts` cap 10, then log + leave for TTL. |
| meshtk restarts | Queue is durable in DDB; poller resumes cold with no state. |
| Duplicate sends | Idempotent-enough: item deleted only after successful publish; worst case the device gets the same code twice. |
| Code rotated mid-flight (resend) | Queue upsert overwrites the item with the new code; only the current code is ever sent. |

## Testing

- **Go:** queue key/attribute byte-parity test (locked, like keycache); poller
  unit tests with fake store + fake MQTT client (no-pubkey wait, success delete,
  failure retry, attempts cap).
- **run.human:** route tests for queue upsert on add/resend and `codeSentAt`
  clearing.
- **Live UAT (acceptance):** manual-add `!7573fe10` (Shannon_Overwatch — online
  today, NODEINFO pubkey observed 08:50 UTC) on run.defcon.run; the MFA DM
  arrives on the device from "DEF CON 34 MeshMap"; entering the code flips the
  card to verified.

## Out of scope

- Code expiry (existing flow has none; attempt/resend caps suffice).
- Channel-PSK fallback delivery.
- Any change to the verify (`PATCH`) contract or quota behavior.
