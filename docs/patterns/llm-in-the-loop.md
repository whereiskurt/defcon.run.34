# A language model in the loop

**When you put a language model inside an automated pipeline, wrap it in three
disciplines: try the cheap deterministic path first and fall back to the model
conservatively behind a ledgered daily budget; keep every secret out of the
model's context and fill it in server-side; and let the model — not downstream
code — decide the structure and voice of its own output.**

## Context

A model earns its place in a pipeline when the input is messy natural language and
the output feeds something automated: a free-text payment note that has to be
matched to a person, a chat reply that has to read like a human wrote it, an
inbound message that might be an attack. The model is genuinely good at the fuzzy
part. But the moment it sits in an automated loop it stops being a chat toy and
becomes a component with a cost meter, an attack surface, and an output contract —
and each of those needs a discipline the model does not supply on its own.

These three patterns are independent; reach for whichever the situation needs. They
share one stance: the model is powerful where deterministic code is weak, and
reckless where it is strong. Use it for the former; fence it out of the latter.

## Forces

- **Every model call spends real money, and volume is unpredictable.** A loop that
  calls the model per event can bankrupt a budget on a traffic spike or a retry
  storm. There is no natural ceiling unless you build one.
- **Whatever is in the context can leak.** Prompt-extraction and jailbreak attacks
  are cheap and endless. Anything you place in the prompt — a secret, a flag, an
  answer — is one clever message away from coming back out, verbatim or paraphrased.
- **The model is non-deterministic in ways that matter.** It will occasionally
  mistype a code, drop a field, or paraphrase a value you needed exact. You cannot
  rely on it to reproduce a fixed string.
- **The model knows the shape of good output; your downstream code does not.** Only
  the model knows where a sentence should end or which word a human would fumble.
  Code that reshapes the model's output after the fact is guessing.

## The pattern

### 1 — Budget-capped fallback matcher

Do the cheap, deterministic thing first; call the model only when it comes back
empty; and gate every model call behind a persisted budget checked *before* the
spend.

```
  input
    │
    ▼
  DETERMINISTIC PATH        cheap, exact, no spend
  (regex on a structured    → hit? done. high confidence.
   reference; index lookup)  → miss? ↓
    │
    ▼
  BUDGET LEDGER (pre-flight, fail-closed)
  today's spend < cap?  ── no ──▶ skip the call, mark the
    │ yes                          item, alert an admin
    ▼
  MODEL CALL                fuzzy, costs money
    │                       ambiguous result ⇒ NO match
    ▼
  on success: increment the ledger (after the spend, not before)
```

The deterministic path is a regex against a structured reference or an exact lookup
in an index — it is nearly free, exact, and high-confidence. The model is the
fallback for the inputs that path can't resolve, and even then it is conservative:
a single unambiguous candidate is a match; zero or more-than-one is *no* match,
because a wrong automated action is worse than none.

The budget ledger is the load-bearing part. It is a persisted daily counter checked
pre-flight: over the cap and the call is skipped, the item is marked for human
follow-up, and an admin is alerted. Two ordering rules make it trustworthy: the cost
check runs **before** the spend (so you never overspend by one expensive call), and
the ledger is incremented **after** a *successful* call (so a failed call doesn't
burn headroom). The check is fail-closed — if you can't confirm you're under budget,
you don't call.

### 2 — Keep the secret out of the model context

If the model must react to a trigger by revealing something sensitive — a code, a
URL, an answer — never put that sensitive value in the prompt or context. Detect the
trigger deterministically, bypass the model entirely for that turn, and fill a
`{{code}}` template **server-side**. The model never sees the secret, so
prompt-extraction and jailbreak attacks structurally cannot leak it, and the model
can't mistype or paraphrase it either.

Pair this with content guardrails run as a **standalone sidecar stage** — an HTTP
hop to a co-located validator — rather than inline on the model call. A sidecar with
one small contract guards every backend identically (swap the model, the guard is
unchanged) and carries an explicit fail-open/fail-closed policy knob: fail-open so a
sidecar hiccup never bricks the loop, or fail-closed when a block must never slip
through, chosen per deployment and logged on every intervention. Because the
deterministic reveal skips the model, it also skips the output guard — so the secret
never even passes through the redaction path that might eat it.

### 3 — Let the model segment and imperfect its own output

When the model's output has natural structure, ask *it* for the structure instead of
reshaping a blob downstream. The failure mode to avoid is generating one paragraph
and then fixed-width-chunking it into scraps that shred sentences mid-clause — the
splitter has no idea where the beats are, so a clean break is luck.

Instead, ask for **one message per line** and have the code merely split on
newlines. Only the model knows where a thought ends. Go further: let the model
author *deliberate imperfections* — an occasional typo followed by an asterisk
self-correction — as an authenticity signal. Code literally cannot fabricate this,
because the correction requires knowing which word broke and that it was worth
fixing. Keep a dumb downstream reshaper as a *fallback* for the rare line that
overruns, never as the primary path.

## Key moves

- **Deterministic first, model as fallback, ambiguity as a no-op.** The exact path
  is cheaper and more trustworthy; the model only sees what it couldn't resolve, and
  an ambiguous model result is treated as no result.
- **The budget is a persisted ledger, not a hope.** Check before spending, increment
  after success, fail closed. A hard ceiling is the only thing that makes
  model-in-the-loop safe to leave running unattended.
- **The secret's value never enters the context.** Detect the trigger, bypass the
  model, template server-side. This is the cleanest possible defense against
  extraction — you can't leak what was never there.
- **The guard is a sidecar with a stable contract.** One HTTP hop guards every
  backend the same way, with an explicit fail-mode.
- **Structure is the model's job; reshaping is a fallback.** One message per line;
  split on newlines. Downstream chunking survives only as a safety net.

## Traps

- **Incrementing the budget before the call.** A failed or timed-out model call then
  burns headroom you never used. Increment on success, downstream of the spend.
- **A one-shot far-below-cap call that is itself huge.** A per-call ceiling and a
  daily ceiling guard different failures; a daily ledger doesn't stop one pathological
  call. Bound both if a single call can be large.
- **Trusting the model to echo an exact value.** Even when the code is plainly in the
  input, the model may drop or paraphrase it. Keep a deterministic extractor over the
  raw input as the source of truth for anything that must be exact.
- **Guardrails inline on the model call** have to be re-implemented for every backend.
  A sidecar guards all of them once — route the deterministic reveal around the *model*
  while still logging it.
- **A style contract with no fallback.** The model will sometimes ignore "one message
  per line" and emit a paragraph. Without the downstream splitter as a net, that turn is
  a wall of text.

## When not to use it

- If the deterministic path resolves nearly everything, the model fallback may not be
  worth its cost and complexity — measure the miss rate first.
- If nothing in the loop is sensitive, the secret-isolation machinery is overhead.
- If the output has no natural structure (a scalar, a yes/no), there's nothing to
  segment — take the blob.
- If volume is tiny and bounded, a hard per-run cap may beat a persisted daily ledger.

## As built (defcon.run 34)

- **Budget-capped fallback matcher:** `apps/run.bib/lambda/reconcile/lib/matcher.mjs`
  (deterministic runner-code regex primary + conservative name fallback; ambiguous ⇒
  no match) and `.../lib/budget.mjs` (`DAILY_BUDGET_CAP_CENTS`, `checkBudget`
  pre-flight, `incrementBudget` after success), orchestrated by `.../lib/reconcile.mjs`.
- **Secret-out-of-context + sidecar guard:**
  `docs/superpowers/specs/2026-07-24-ghost-bedrock-guardrails-flags-design.md` (§4
  architecture, §5.3 deterministic server-side `{{code}}` reveal, §5.5 guard stage
  and fail-mode) and `docs/superpowers/specs/2026-07-31-bot-hardening-design.md`
  (Workstream C — fail-closed guardrail, reason-keyed degradation). The guard sidecar
  is `apps/run.mqtt/guardrails/app.py`.
- **Model segments its own output:**
  `docs/superpowers/specs/2026-07-30-meshtk-ghost-chat-cadence-design.md` (one message
  per line, split on newlines, model-authored typo + asterisk self-correct, splitter
  demoted to a sentence-aware fallback).
- Realized on a function-as-a-service reconcile Lambda over a key-value ledger, a paid
  hosted model for extraction and chat, and a co-located transformers sidecar for the
  two-sided guard.
