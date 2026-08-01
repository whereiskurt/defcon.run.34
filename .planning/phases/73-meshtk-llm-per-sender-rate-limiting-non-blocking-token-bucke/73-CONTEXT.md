# Phase 73: meshtk LLM per-sender rate limiting — Context

**Gathered:** 2026-08-01
**Status:** Ready for planning
**Source:** Direct decisions from Kurt in-session (2026-08-01), promoting the deliberately-deferred Phase 72 todo

<domain>
## Phase Boundary

Put a bound on Bedrock model calls originating from a single mesh radio, at the one
choke point that exists in the code today.

**In scope:** a non-blocking per-`(fleet, sender)` token bucket guarding
`generateReply`, an in-character refusal when a sender's bucket is empty, an
operator-tunable env knob, and a log + CloudWatch alarm on sustained refusals.

**Out of scope (Kurt declined each explicitly on 2026-08-01):** global fleet-wide
call cap; daily token/spend ceiling with kill switch; AWS Budgets or a CloudWatch
alarm on Bedrock `InvocationCount`. Also out of scope: any change to the lyric
path, the guardrail path, or the award/claim path.

</domain>

<decisions>
## Implementation Decisions

### Scope (LOCKED — Kurt, 2026-08-01)
- Ship the **per-sender token bucket ONLY**. A global fleet cap, a daily spend
  ceiling, and an out-of-band AWS backstop were each offered as options and each
  declined. Do not add them back under another name.
- ⚠️ The accepted consequence: **aggregate spend across many distinct radios each
  sitting just under the bucket remains unbounded**, and nothing in this phase
  alarms on cost. This is a recorded acceptance. Surface it in the plan; do not
  quietly "fix" it by widening scope.

### Failure posture (LOCKED — Kurt, 2026-08-01)
- **The fleet is NEVER globally silenced.** A trip refuses the one abusive sender;
  every other radio keeps being served. Dead ghosts mid-con are a worse failure
  than a visible overage.
- The alarm **notifies only** — it must never auto-disable model calls.

### Refusal behaviour (follows the Phase 72 `stageFullReply` precedent)
- An over-cap request is **refused in words, never silence** — "a blackholed
  request is indistinguishable from a dead bot" (`cmd.go`, stageFullReply comment).
- It is **never queued**. A backlog would outlive the requester's interest and then
  burst at a radio that stopped listening.
- The refusal send must not itself consume a token or re-enter the limiter.

### Concurrency shape (forced by the runtime, not a preference)
- `handleLLMChat` executes **inline on paho's ordered dispatch goroutine**
  (`SetOrderMatters` defaults true; a paho handler must not block). The acquire
  must therefore be **non-blocking `select`/`default`**, mirroring
  `acquireLyricSlot`. A blocking acquire stalls ACK dispatch and can outlast the
  fixed 30s `requestDedupWindow`, which reintroduces the multi-copy bug observed
  live on 2026-07-19.
- Per-fleet state must be mutex-guarded and **pruned on access**, exactly as
  `dedupRequest` does, so the map cannot grow unbounded over a multi-day fleet
  lifetime.
- A **nil bucket must degrade to unlimited**, not panic and not refuse-everything —
  the existing tests construct bare `FleetCmd` values (`acquireLyricSlot` documents
  this exact hazard).

### Claude's Discretion
- Bucket algorithm (classic token bucket vs sliding window), refill rate, burst
  size, and the default numeric values.
- The exact env var name(s) under the `MESHTK_` prefix and the refusal copy.
- Whether the bucket keys on the raw `from` node id alone or a composite.
- ⚠️ **Zero-value semantics must be decided deliberately, not copied.**
  `lyricsMaxConcurrent` maps `0` → default precisely because a zero cap would
  silence ricky entirely. A rate limiter may legitimately want `0` to mean
  "refuse all" as a kill switch, or may want the same default-coercion. Pick one,
  write the rationale into the code comment, and test it.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The todo this phase promotes
- `.planning/todos/pending/2026-07-31-llm-rate-limiting-bedrock-ceiling.md` — the
  filed acceptance, with the choke-point line numbers and the "what does NOT cover
  this" section (the lyric semaphore is not a rate limit).

### Upstream Go source (changes land HERE first)
- `~/working/meshtk/internal/app/fleet/llm.go` — `generateReply` (:63),
  `callClaudeBedrock` (:71-90), `bedrockModelID` (:23) =
  `us.anthropic.claude-haiku-4-5-20251001-v1:0`, `llmMaxTokens` 2000.
- `~/working/meshtk/internal/app/fleet/cmd.go` — `handleLLMChat` (:1328, the sole
  caller of `generateReply`); `requestDedupWindow` / `dedupRequest` /
  `isRetransmit` (:758-781, the per-(fleet,sender) keying + prune pattern to
  reuse); `lyricsMaxConcurrent` / `acquireLyricSlot` / `stageFullReply`
  (:615-660, the non-blocking-acquire + refuse-in-words precedent).

### Phase 72 (the dependency)
- `docs/superpowers/specs/2026-07-31-bot-hardening-design.md` — "Out of scope
  (deliberate)" is where this todo was born.
- `.planning/phases/72-bot-hardening-*/` — the metric-filter → SNS
  `dcr-admin-reports-tripwire` alarm plumbing (72-04) this phase reuses for RATE-04.

</canonical_refs>

<specifics>
## Specific Ideas

- The alarm should follow 72-04's shape: a **plain-text** metric filter token (72-04
  learned the hard way that a JSON selector does not match these log lines), a
  count-gated `>=N/5min` threshold, on the existing tripwire SNS topic.
- `guardText` / `guardRefusalMessage` already exist in `handleLLMChat` as the
  precedent for "refuse and return early" — the limiter refusal sits *before* the
  model call, the guardrail refusal *after* it.

</specifics>

<deferred>
## Deferred Ideas

- Global fleet-wide concurrency/call cap — declined 2026-08-01.
- Daily token or spend ceiling with kill switch (would need `Converse` response
  token accounting) — declined 2026-08-01.
- AWS Budgets / CloudWatch `InvocationCount` backstop — declined 2026-08-01. This
  is the only item that would have bounded aggregate multi-radio spend.

</deferred>

---

*Phase: 73-meshtk-llm-per-sender-rate-limiting-non-blocking-token-bucke*
*Context gathered: 2026-08-01 from direct user decisions*
