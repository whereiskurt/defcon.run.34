---
created: 2026-08-01T06:55:00Z
title: "Phase 73 hardware UAT — drive a real radio past the LLM ceiling and confirm the refusal"
area: run.mqtt
priority: medium
source: Phase 73 / 73-03-PLAN.md (human-only, cannot be claimed by an agent)
---

Phase 73 shipped a per-`(fleet, sender)` LLM rate limiter. Everything below the RF
layer is proven by automated tests and a live AWS probe. **The one thing no agent can
verify is the actual radio experience** — that requires hardware in hand.

## What to do

1. DM a ghost from a real radio more than `MESHTK_LLM_CALLS_PER_HOUR` times in an hour
   (default **60**, so vary the message text each time — `isRetransmit` collapses
   byte-identical repeats within 30s and would mask the test).
2. Confirm the over-cap DM gets the in-character refusal
   (`👻 …too many questions at once. give me a minute.`) as a real message on the
   device — not silence, and not a dropped packet.
3. Confirm a **different** radio talking to the same ghost still gets normal LLM
   replies. This is the locked "the fleet is never globally silenced" guarantee.
4. Confirm the refusal arrives as ONE message, not a burst.
5. Check the `dcr-mqtt-llm-rate-limit` CloudWatch alarm fires on the SNS tripwire after
   sustained refusals (>= 20 in 5min by default) — and that it only NOTIFIES, with the
   ghosts still answering.

## Why it can't be automated

The refusal is sent on the plain `sendPKIReply` path over the mesh. Its delivery
depends on the iOS proxy → BLE hop that Phase 72 root-caused as the source of observed
drops — a seam only reproducible with a physical radio.

## Also needs a human decision

⚠️ **Confirm the default ceiling of 60 calls/radio/hour.** That number was the
planner's pick, not Kurt's. Raise/lower live with `MESHTK_LLM_CALLS_PER_HOUR` on the
ghosts container — no code change, no redeploy of the image.

## Accepted residual (not a bug — a recorded decision)

Aggregate spend across MANY distinct radios each sitting just under the bucket remains
**unbounded**, and no alarm watches cost. Kurt declined a global cap, a daily spend
ceiling, and an AWS Budgets/`InvocationCount` backstop on 2026-08-01. A quiet alarm is
NOT proof that spend is controlled.

See [[2026-07-31-llm-rate-limiting-bedrock-ceiling]] for the original filing.
