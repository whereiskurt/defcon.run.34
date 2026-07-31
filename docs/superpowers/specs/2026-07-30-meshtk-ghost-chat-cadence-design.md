# meshtk Ghost Chat Cadence

Make unlocked ghost bot replies read like a person texting instead of a
paragraph fed through a shredder.

## Problem

Once a runner unlocks a ghost via OTP, follow-up DMs route to Bedrock Haiku and
come back as a single blob that gets hacked into fixed-width scraps. Observed in
prod on `ghost-condor-00`:

```
Yo—Condor here. What's good? Information asymmetry,
always have a way out, and knowing the target better than
they know themselves. The real thrill? Making someone
```

Three defects visible in three messages: breaks land mid-clause, the reply is
truncated mid-sentence, and it opens on an em dash.

## Root cause

Three independent causes, all in the LLM chat path.

1. **The chunk width is 60, not 230.** `cmd.go:1096` calls
   `n.splitIntoChunks(reply, 60)`. The splitter walks back to the last space
   before char 60 and cuts. Nothing about it is sentence-aware, so a break at a
   clause boundary is luck.

2. **The model is asked for one blob.** `llm.go:23` sets
   `llmMaxTokens = 150`, and every persona prompt ends with *"All responses must
   be limited to under 230 characters."* Haiku writes one 230-char paragraph;
   the splitter then shreds it into four scraps. The model never gets to decide
   where a message should end, because it does not know it is emitting messages.

3. **The persona prompts teach the em dash.** Condor's `SystemPrompt` in
   `meshtk.dc34.yaml` is itself written in em dashes (`his experiences—still
   speaking`, `an echo—disembodied`, `never without an air of
   self-reflection`). The model is copying the register it was handed.

The fix is to move the break decision from the splitter to the model. Only the
model knows where the beats are.

## Reference output

The target. Prompt is `What's good?` to Condor:

```
1  Condor here.

2  What's good is nobody asks that anymore. they just
   want the payload.

3  Look. every system has a seam. usually its a person
   who's bored, or helpful, or both.

4  I never broke crypto. I broke assumtions.

5  *assumptions

6  Anyway. always have a way out. you'll want it before
   you think you do.

7  Whats the target?
```

Every line ends on a real sentence boundary. Short-form does the compression.
The typo texture is dropped apostrophes plus lowercase drift after the opener,
which reads as thumb-typing rather than as a broken bot. Message 1 as a bare
two-word opener is what sells it as a person, and the `*assumptions`
self-correct is the highest-value tell — nobody thinks a bot backspaces.

## Design

### Layer 1 — Prompt

A shared style preamble lives in `llm.go` and is prepended to whatever
`SystemPrompt` the ghost carries. One place to tune, and it matches what
`config.go:138` already declares the field is for ("persona ONLY: voice,
mannerisms, catch-phrases").

The preamble specifies:

- One message per line. Blank lines ignored.
- 3 to 7 messages. Each under 200 characters. Most much shorter. One or two
  words is fine.
- Never an em dash or an en dash. Use a period, a comma, or a new message.
- Thumb-typing register: contractions, dropped apostrophes, lowercase drift
  after the opening message, short words over long ones.
- Roughly one message in five carries a small typo. Never in a URL, a code, or
  a number. Occasionally the next message is just the corrected word with a
  leading asterisk.
- No numbering, no bullets, no markdown.

The 200-char ask sits under the 230 hard limit deliberately, so the model's own
lines fit without ever touching the fallback splitter.

Typos are model-driven, not code-injected. Code cannot produce the
`*assumptions` self-correct, because that requires knowing which word broke and
that it is worth fixing.

Eight of the ten ghosts in `meshtk.dc34.yaml` carry a `SystemPrompt` —
goldstein, mudge, condor, sharp, ladyada, hopper, turing, gibson. (`ricky` is
lyrics-only and `dt` has none, so neither reaches this path.) Each of those
eight gets two edits: strip the em dashes out of the prompt prose, and delete
the trailing "All responses must be limited to under 230 characters", which now
contradicts the shared contract. All eight currently contain both.

The file holds one further em dash, in the `rabbit.pack` `Description` at line
864. It is not a prompt and is never sent to a model. Leave it alone.

### Layer 2 — Token ceiling

`llmMaxTokens` 150 → 2000. Seven messages at 200 chars is roughly 400 tokens,
so 2000 is headroom rather than a length target — length stays bounded by the
message contract. What it buys is that the final message can never be clipped
mid-word, which is the truncation visible in the prod sample above. Unused
headroom costs nothing.

### Layer 3 — Output parsing

`handleLLMChat` stops chunking by width and starts splitting on newlines:

1. Split the reply on `\n`, trim each line, drop empties.
2. Normalize any surviving dash: `\s*[—–]\s*` → `, `, then trim.
3. Cap at 7 messages. If the model overran, keep the first 7 and log the number
   dropped. No silent truncation.
4. Any single line still over 230 chars goes through `splitIntoChunks` as a
   fallback.

`splitIntoChunks` survives only as that fallback and gains a sentence-aware
preference order: break at `.`/`?`/`!` within the limit, else at a comma, else
at a space, else hard-cut. A runaway line is exactly where a bad break is most
visible, so it is worth fixing even though it should rarely fire.

The output guardrail keeps running on the whole reply before any splitting, and
the deterministic flag-reveal branch stays on its own send path. The claim URL
is never typo'd, never chunked, and never dash-normalized.

### Layer 4 — Pacing

The flat 500ms between sends becomes length-proportional, so a long message
reads as taking longer to type:

- Before the first message: 700ms plus up to 800ms of jitter.
- Between messages: `450ms + 14ms × len(message just sent)`, clamped to
  600ms–3500ms, then ±20% jitter.

A 130-char message buys about 2.3s. A full seven-message reply lands over
roughly 12–15 seconds. At these sizes the airtime cost is well inside budget.

## Files

Code changes land in **both** trees. `cmd.go` and `llm.go` exist upstream at
`~/working/meshtk` and in the tracked monorepo overlay at
`apps/run.mqtt/meshtk/`, and `build.sh` overlays the monorepo copies over a
fresh GitHub clone — so an upstream-only fix is invisible in prod.

| File | Change |
|---|---|
| `internal/app/fleet/llm.go` (both trees) | Shared style preamble; `llmMaxTokens` 150 → 2000 |
| `internal/app/fleet/cmd.go` (both trees) | Newline splitting, dash normalization, 7-message cap, sentence-aware fallback, length-proportional pacing |
| `apps/run.mqtt/meshtk/meshtk.dc34.yaml` | 8 personas: strip em dashes, drop the 230-char line |

Editing the YAML means re-running `sync-meshtk-fleet.mjs`.

## Non-goals

- No change to the OTP unlock flow, the flag-reveal path, or the guardrails.
- No change to the lyrics playback path (`ricky`), which is not LLM-driven.
- No per-persona style divergence. All eight LLM ghosts share identical break
  and typo rules and differ only in voice.

## Risks

- **Typo rate drifts.** Haiku may over- or under-typo at temperature 0.8. The
  rate is a single line in the shared preamble, so it is cheap to retune.
- **Model ignores the line contract** and emits one paragraph anyway. The
  fallback splitter catches this and the result is no worse than today's
  behavior at a 230 width instead of 60.
- **Dash normalization on a numeric range** (`1990—1995` → `1990, 1995`) is
  possible but vanishingly rare in chat register.

## Verification

- Unit tests for the parser: newline splitting, dash normalization, the
  7-message cap logging its drops, and the sentence-aware fallback on an
  over-230 line.
- Unit test that the pacing function stays inside its clamp at 0, typical, and
  230-char lengths.
- Manual: unlock a ghost in prod and confirm the reply arrives as separate
  messages breaking on sentence boundaries, with no em dash, and that a flag
  claim URL still arrives intact and unchunked.
