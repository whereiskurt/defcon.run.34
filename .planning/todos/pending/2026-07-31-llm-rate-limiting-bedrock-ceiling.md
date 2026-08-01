---
created: 2026-07-31T00:40:00Z
title: "meshtk bots: no LLM rate limiting and no Bedrock cost ceiling — abuse and spend are both unbounded"
area: run.mqtt
priority: medium
source: 72-10 / docs/superpowers/specs/2026-07-31-bot-hardening-design.md "Out of scope (deliberate)"
---

Raised during Phase 72 design and **consciously deferred by Kurt**. This is a recorded
decision, not an oversight — filed so the acceptance is visible rather than forgotten.

## What

`apps/run.mqtt/meshtk/internal/app/fleet/llm.go` (160 lines) has **no limiter of any kind**.
Every unlocked DM to a ghost becomes a Bedrock `Converse` call:

- `llm.go:23` — model is `us.anthropic.claude-haiku-4-5-20251001-v1:0` (Claude Haiku 4.5
  cross-region inference profile), billed per token.
- `llm.go:71-90` — `callClaudeBedrock` builds the request and calls `client.Converse`
  directly. There is no per-radio budget, no token ceiling, no global concurrency cap, and
  no circuit breaker between an inbound mesh DM and a paid model call.
- Auth is the ECS task role, so there is no per-caller attribution to rate-limit against
  either.

**The only throttle anywhere in the path** is `requestDedupWindow` at
`apps/run.mqtt/meshtk/internal/app/fleet/cmd.go:758` — 30 seconds, and it collapses
**byte-identical** repeats only (`isRetransmit`, `cmd.go:776-781`, keyed on
fleet+sender+message). It exists to swallow device retransmits, not to bound spend. Vary a
single character and it does nothing.

## What does NOT cover this

The lyric semaphore added in Phase 72 (`cmd.go:257`, `defaultLyricsMaxConcurrent = 12` at
`cmd.go:621-646`, env `MESHTK_LYRICS_MAX_CONCURRENT`) bounds **LYRIC fan-out only** — it caps
concurrent song performances to protect aggregate RF airtime. It sits on a different path
entirely and does **nothing** for model calls. Do not read the semaphore as a rate limit.

## Why it matters at a con

An attacker with one radio on the mesh can hold a loop of varied DMs against a ghost and
drive unbounded Bedrock spend with no ceiling to stop it, and no alarm scoped to cost. The
existing `dcr-mqtt-guardrail-outage` alarm (Phase 72) watches guardrail failures, not spend
or call volume.

## Where a future session should start

1. `apps/run.mqtt/meshtk/internal/app/fleet/llm.go:61-90` — the single choke point; a
   per-sender token bucket and a global semaphore both belong here.
2. `apps/run.mqtt/meshtk/internal/app/fleet/cmd.go:758-781` — the existing dedup, for the
   per-(fleet,sender) keying pattern to reuse.
3. AWS Budgets / a CloudWatch alarm on Bedrock `InvocationCount` for the backstop that does
   not depend on shipping code.

Changes go to `~/working/meshtk` upstream FIRST, then vendor-sync to `apps/run.mqtt/meshtk`
(a tracked overlay build.sh applies over a fresh clone). See
[[2026-07-29-meshtk-proxy-shared-chain-blockers]].
