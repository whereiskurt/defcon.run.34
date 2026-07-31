# meshtk Ghost Chat Cadence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make unlocked meshtk ghost replies arrive as a burst of short, human-looking chat messages instead of one paragraph shredded at 60 characters.

**Architecture:** Move the message-break decision from a fixed-width splitter to the model. A shared style preamble tells every ghost to emit one message per line; `handleLLMChat` splits on newlines, normalizes stray dashes, caps the burst at 7 transmissions, and paces sends proportionally to message length. The old width splitter survives only as a fallback for a runaway line.

**Tech Stack:** Go 1.24.1, AWS Bedrock (Claude Haiku 4.5), standard library only — no new dependencies.

## Global Constraints

- **Two trees, byte-identical.** Every Go change lands in BOTH `~/working/meshtk/` and `/Users/khundeck/working/defcon.run.34/apps/run.mqtt/meshtk/`. `Dockerfile.meshtk` builds from the monorepo tree (`COPY . .`), so that tree is what ships; upstream must match or the next vendor-sync reverts it.
- **Author upstream first**, then copy to the monorepo tree. Verify with `diff -r` before committing.
- **No new Go dependencies.** Standard library only.
- **Package-level pure functions.** New logic goes in package-level funcs, not `*FleetCmd` methods, so tests need no `FleetCmd` instance. This matches `llm_test.go`.
- **Go test style:** plain `testing`, no testify, no table helpers unless natural. Match existing `internal/app/fleet/*_test.go`.
- **Never touch the flag path.** `handleLLMChat` is the only function changing. The deterministic flag-reveal branch (`cmd.go` ~line 856-892) and `sendPKIReplyReliable` are out of scope — claim URLs must stay unchunked, unnormalized, untypo'd.
- **Do not modify `rabbit.pack`'s `Description`** at `meshtk.dc34.yaml:864`. It contains an em dash, is not a prompt, and is never sent to a model.
- Verification commands run from `~/working/meshtk` unless stated otherwise.

## File Structure

| File | Responsibility |
|---|---|
| `internal/app/fleet/chatstyle.go` (new) | Pure message-shaping: dash normalization, newline splitting, message cap, sentence-aware fallback, pacing math |
| `internal/app/fleet/chatstyle_test.go` (new) | Tests for all of the above |
| `internal/app/fleet/llm.go` (modify) | Shared style preamble, prompt composition, token ceiling |
| `internal/app/fleet/llm_test.go` (modify) | Prompt composition tests |
| `internal/app/fleet/cmd.go` (modify) | `handleLLMChat` wiring; delete the old `splitIntoChunks` method |
| `apps/run.mqtt/meshtk/meshtk.dc34.yaml` (modify) | 8 persona prompts: strip em dashes, drop the 230-char instruction |

`chatstyle.go` is a new file rather than more lines in the 1160-line `cmd.go` because every function in it is pure and independently testable, and `cmd.go` is already the largest file in the package.

---

### Task 1: Dash normalization

**Files:**
- Create: `~/working/meshtk/internal/app/fleet/chatstyle.go`
- Test: `~/working/meshtk/internal/app/fleet/chatstyle_test.go`

**Interfaces:**
- Consumes: nothing
- Produces: `func normalizeDashes(s string) string`

- [ ] **Step 1: Write the failing test**

Create `internal/app/fleet/chatstyle_test.go`:

```go
package fleet

import "testing"

func TestNormalizeDashes(t *testing.T) {
	cases := []struct{ in, want string }{
		{"Yo—Condor here", "Yo, Condor here"},
		{"Yo — Condor here", "Yo, Condor here"},
		{"a–b", "a, b"},
		{"—leading", "leading"},
		{"trailing—", "trailing"},
		{"no dashes here", "no dashes here"},
		{"  padded  ", "padded"},
	}
	for _, c := range cases {
		if got := normalizeDashes(c.in); got != c.want {
			t.Errorf("normalizeDashes(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/working/meshtk && go test ./internal/app/fleet/ -run TestNormalizeDashes -v`
Expected: FAIL to build with `undefined: normalizeDashes`

- [ ] **Step 3: Write minimal implementation**

Create `internal/app/fleet/chatstyle.go`:

```go
package fleet

import (
	"regexp"
	"strings"
)

// dashRun matches an em or en dash together with any whitespace hugging it.
var dashRun = regexp.MustCompile(`\s*[\x{2014}\x{2013}]\s*`)

// normalizeDashes replaces em and en dashes with a comma and a space. The style
// preamble already forbids them, so this is the belt to that suspenders: a
// reply opening "Yo—Condor here" is the single most bot-looking thing we ship,
// and it costs nothing to make it unrepresentable.
func normalizeDashes(s string) string {
	s = strings.TrimSpace(dashRun.ReplaceAllString(s, ", "))
	s = strings.TrimPrefix(s, ", ")
	return strings.TrimRight(s, ", ")
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/working/meshtk && go test ./internal/app/fleet/ -run TestNormalizeDashes -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd ~/working/meshtk
git add internal/app/fleet/chatstyle.go internal/app/fleet/chatstyle_test.go
git commit -m "feat(fleet): normalize em and en dashes in chat replies"
```

---

### Task 2: Sentence-aware fallback splitter

**Files:**
- Modify: `~/working/meshtk/internal/app/fleet/chatstyle.go`
- Test: `~/working/meshtk/internal/app/fleet/chatstyle_test.go`

**Interfaces:**
- Consumes: nothing
- Produces: `func splitSentenceAware(text string, limit int) []string`

This only fires when a single model line overruns the hard limit. It should be rare, but a runaway line is exactly where a bad break is most visible.

- [ ] **Step 1: Write the failing test**

Append to `internal/app/fleet/chatstyle_test.go`:

```go
func TestSplitSentenceAwarePrefersSentenceEnd(t *testing.T) {
	// Break should land after "one." not mid-word.
	in := "aaa bbb one. ccc ddd two"
	got := splitSentenceAware(in, 14)
	want := []string{"aaa bbb one.", "ccc ddd two"}
	if len(got) != len(want) {
		t.Fatalf("got %d parts %q, want %d", len(got), got, len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("part %d = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestSplitSentenceAwareFallsBackToComma(t *testing.T) {
	got := splitSentenceAware("aaa bbb ccc, ddd eee fff", 14)
	if got[0] != "aaa bbb ccc," {
		t.Errorf("part 0 = %q, want %q", got[0], "aaa bbb ccc,")
	}
}

func TestSplitSentenceAwareFallsBackToSpace(t *testing.T) {
	got := splitSentenceAware("aaa bbb ccc ddd eee fff", 14)
	if got[0] != "aaa bbb ccc" {
		t.Errorf("part 0 = %q, want %q", got[0], "aaa bbb ccc")
	}
}

func TestSplitSentenceAwareHardCutsUnbrokenRun(t *testing.T) {
	got := splitSentenceAware("aaaaaaaaaaaaaaaaaaaaaaaa", 10)
	if len(got) != 3 || got[0] != "aaaaaaaaaa" {
		t.Fatalf("got %q, want 3 parts starting with 10 a's", got)
	}
}

func TestSplitSentenceAwareRespectsLimit(t *testing.T) {
	long := "The tech was never the hard part. People are. A badge and a clipboard got me through more doors than any exploit ever did, and that is not a joke about security theatre, it is just what happened every single time I tried it."
	for _, p := range splitSentenceAware(long, 230) {
		if len(p) > 230 {
			t.Errorf("part exceeds limit at %d: %q", len(p), p)
		}
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/working/meshtk && go test ./internal/app/fleet/ -run TestSplitSentenceAware -v`
Expected: FAIL to build with `undefined: splitSentenceAware`

- [ ] **Step 3: Write minimal implementation**

Append to `internal/app/fleet/chatstyle.go`:

```go
// splitSentenceAware breaks an over-long line into pieces of at most limit
// bytes, preferring the last sentence end inside the limit, then the last
// comma, then the last space, and hard-cutting only for an unbroken run.
func splitSentenceAware(text string, limit int) []string {
	var out []string
	rest := strings.TrimSpace(text)
	for len(rest) > limit {
		cut := lastIndexBefore(rest, limit, func(i int) bool {
			c := rest[i]
			return (c == '.' || c == '?' || c == '!') && i+1 < len(rest) && rest[i+1] == ' '
		})
		if cut > 0 {
			cut++ // keep the punctuation with the piece it ends
		}
		if cut <= 0 {
			cut = lastIndexBefore(rest, limit, func(i int) bool {
				return rest[i] == ',' && i+1 < len(rest) && rest[i+1] == ' '
			})
			if cut > 0 {
				cut++
			}
		}
		if cut <= 0 {
			cut = lastIndexBefore(rest, limit, func(i int) bool { return rest[i] == ' ' })
		}
		if cut <= 0 {
			cut = limit
		}
		out = append(out, strings.TrimSpace(rest[:cut]))
		rest = strings.TrimSpace(rest[cut:])
	}
	if rest != "" {
		out = append(out, rest)
	}
	return out
}

// lastIndexBefore scans backwards from limit-1 for the highest index where
// match holds, returning -1 if there is none.
func lastIndexBefore(s string, limit int, match func(i int) bool) int {
	if limit > len(s) {
		limit = len(s)
	}
	for i := limit - 1; i > 0; i-- {
		if match(i) {
			return i
		}
	}
	return -1
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/working/meshtk && go test ./internal/app/fleet/ -run TestSplitSentenceAware -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
cd ~/working/meshtk
git add internal/app/fleet/chatstyle.go internal/app/fleet/chatstyle_test.go
git commit -m "feat(fleet): sentence-aware fallback splitter for over-long lines"
```

---

### Task 3: Newline message splitting with airtime cap

**Files:**
- Modify: `~/working/meshtk/internal/app/fleet/chatstyle.go`
- Test: `~/working/meshtk/internal/app/fleet/chatstyle_test.go`

**Interfaces:**
- Consumes: `normalizeDashes` (Task 1), `splitSentenceAware` (Task 2)
- Produces: `const maxChatMessages = 7`, `const chatHardLimit = 230`, `func splitMessages(reply string) (msgs []string, dropped int)`

- [ ] **Step 1: Write the failing test**

Append to `internal/app/fleet/chatstyle_test.go`:

```go
import "strings" // add to the existing import block if not present

func TestSplitMessagesOnePerLine(t *testing.T) {
	reply := "Condor here.\n\nWhat's good is nobody asks that anymore.\nI never broke crypto. I broke assumtions.\n*assumptions\n"
	msgs, dropped := splitMessages(reply)
	want := []string{
		"Condor here.",
		"What's good is nobody asks that anymore.",
		"I never broke crypto. I broke assumtions.",
		"*assumptions",
	}
	if dropped != 0 {
		t.Errorf("dropped = %d, want 0", dropped)
	}
	if len(msgs) != len(want) {
		t.Fatalf("got %d msgs %q, want %d", len(msgs), msgs, len(want))
	}
	for i := range want {
		if msgs[i] != want[i] {
			t.Errorf("msg %d = %q, want %q", i, msgs[i], want[i])
		}
	}
}

func TestSplitMessagesNormalizesDashes(t *testing.T) {
	msgs, _ := splitMessages("Yo—Condor here.")
	if msgs[0] != "Yo, Condor here." {
		t.Errorf("got %q, want %q", msgs[0], "Yo, Condor here.")
	}
}

func TestSplitMessagesCapsAtSeven(t *testing.T) {
	var lines []string
	for i := 0; i < 10; i++ {
		lines = append(lines, "line")
	}
	msgs, dropped := splitMessages(strings.Join(lines, "\n"))
	if len(msgs) != maxChatMessages {
		t.Errorf("got %d msgs, want %d", len(msgs), maxChatMessages)
	}
	if dropped != 3 {
		t.Errorf("dropped = %d, want 3", dropped)
	}
}

func TestSplitMessagesExpandsOverLongLine(t *testing.T) {
	long := strings.Repeat("word ", 100) // 500 bytes, no sentence ends
	msgs, _ := splitMessages(long)
	if len(msgs) < 2 {
		t.Fatalf("expected the long line to expand, got %d", len(msgs))
	}
	for _, m := range msgs {
		if len(m) > chatHardLimit {
			t.Errorf("msg exceeds hard limit at %d: %q", len(m), m)
		}
	}
}

func TestSplitMessagesEmptyReply(t *testing.T) {
	msgs, dropped := splitMessages("\n  \n\n")
	if len(msgs) != 0 || dropped != 0 {
		t.Errorf("got %d msgs / %d dropped, want 0/0", len(msgs), dropped)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/working/meshtk && go test ./internal/app/fleet/ -run TestSplitMessages -v`
Expected: FAIL to build with `undefined: splitMessages`

- [ ] **Step 3: Write minimal implementation**

Append to `internal/app/fleet/chatstyle.go`:

```go
// maxChatMessages caps how many transmissions one LLM reply may become. Each
// message is a separate PKI encrypt and a separate LoRa send, so this is an
// airtime budget, not a style preference.
const maxChatMessages = 7

// chatHardLimit is the per-message ceiling. The style preamble asks the model
// for 200 so its own lines never reach this; anything that does is a runaway
// line and gets handed to splitSentenceAware.
const chatHardLimit = 230

// splitMessages turns one LLM reply into the messages to send. The model
// authors its own breaks by emitting one message per line; this cleans up after
// it. dropped reports how many messages the cap discarded, so the caller can
// log it — a silent truncation would read as "the model was concise".
func splitMessages(reply string) (msgs []string, dropped int) {
	for _, line := range strings.Split(reply, "\n") {
		line = normalizeDashes(line)
		if line == "" {
			continue
		}
		if len(line) <= chatHardLimit {
			msgs = append(msgs, line)
			continue
		}
		msgs = append(msgs, splitSentenceAware(line, chatHardLimit)...)
	}
	if len(msgs) > maxChatMessages {
		dropped = len(msgs) - maxChatMessages
		msgs = msgs[:maxChatMessages]
	}
	return msgs, dropped
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/working/meshtk && go test ./internal/app/fleet/ -run TestSplitMessages -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
cd ~/working/meshtk
git add internal/app/fleet/chatstyle.go internal/app/fleet/chatstyle_test.go
git commit -m "feat(fleet): split LLM replies on newlines with a 7-message cap"
```

---

### Task 4: Length-proportional pacing

**Files:**
- Modify: `~/working/meshtk/internal/app/fleet/chatstyle.go`
- Test: `~/working/meshtk/internal/app/fleet/chatstyle_test.go`

**Interfaces:**
- Consumes: nothing
- Produces: `func baseDelay(msgLen int) time.Duration`, `func applyJitter(d time.Duration, r float64) time.Duration`, `func openingDelay(r float64) time.Duration`

Randomness is passed in as `r` rather than drawn inside, so the math is deterministic under test. The caller supplies `rand.Float64()`.

- [ ] **Step 1: Write the failing test**

Append to `internal/app/fleet/chatstyle_test.go` (add `"time"` to the import block):

```go
func TestBaseDelayClamps(t *testing.T) {
	cases := []struct {
		msgLen int
		want   time.Duration
	}{
		{0, 600 * time.Millisecond},    // floor
		{10, 600 * time.Millisecond},   // 450+140=590, still floored
		{130, 2270 * time.Millisecond}, // 450 + 130*14
		{230, 3500 * time.Millisecond}, // 450+3220=3670, ceilinged
		{5000, 3500 * time.Millisecond},
	}
	for _, c := range cases {
		if got := baseDelay(c.msgLen); got != c.want {
			t.Errorf("baseDelay(%d) = %v, want %v", c.msgLen, got, c.want)
		}
	}
}

// Bounds rather than equality on purpose: 0.8+0.4*1 lands on a float64 knife
// edge where the product can round either side of 1.2e9 ns, and an exact
// assertion would be flaky rather than wrong.
func TestApplyJitterSpansTwentyPercent(t *testing.T) {
	d := 1000 * time.Millisecond
	within := func(name string, got, want time.Duration) {
		if got < want-time.Millisecond || got > want+time.Millisecond {
			t.Errorf("%s = %v, want ~%v", name, got, want)
		}
	}
	within("applyJitter(1s, 0)", applyJitter(d, 0), 800*time.Millisecond)
	within("applyJitter(1s, 1)", applyJitter(d, 1), 1200*time.Millisecond)
	within("applyJitter(1s, 0.5)", applyJitter(d, 0.5), 1000*time.Millisecond)
}

func TestOpeningDelayRange(t *testing.T) {
	if got := openingDelay(0); got != 700*time.Millisecond {
		t.Errorf("openingDelay(0) = %v, want 700ms", got)
	}
	if got := openingDelay(1); got != 1500*time.Millisecond {
		t.Errorf("openingDelay(1) = %v, want 1500ms", got)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/working/meshtk && go test ./internal/app/fleet/ -run 'TestBaseDelay|TestApplyJitter|TestOpeningDelay' -v`
Expected: FAIL to build with `undefined: baseDelay`

- [ ] **Step 3: Write minimal implementation**

Add `"time"` to the import block of `internal/app/fleet/chatstyle.go`, then append:

```go
// baseDelay scales the pause after a message by that message's length, so a
// long message reads as having taken longer to thumb out.
func baseDelay(msgLen int) time.Duration {
	d := 450*time.Millisecond + time.Duration(msgLen)*14*time.Millisecond
	if d < 600*time.Millisecond {
		return 600 * time.Millisecond
	}
	if d > 3500*time.Millisecond {
		return 3500 * time.Millisecond
	}
	return d
}

// applyJitter spreads d by plus or minus 20%. r is expected in [0,1); the
// caller supplies it so the arithmetic stays deterministic under test.
func applyJitter(d time.Duration, r float64) time.Duration {
	return time.Duration(float64(d) * (0.8 + 0.4*r))
}

// openingDelay is the beat before the first message lands, so the ghost reads
// as having seen the question rather than having pre-computed the answer.
func openingDelay(r float64) time.Duration {
	return 700*time.Millisecond + time.Duration(r*800)*time.Millisecond
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/working/meshtk && go test ./internal/app/fleet/ -run 'TestBaseDelay|TestApplyJitter|TestOpeningDelay' -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
cd ~/working/meshtk
git add internal/app/fleet/chatstyle.go internal/app/fleet/chatstyle_test.go
git commit -m "feat(fleet): length-proportional pacing for chat replies"
```

---

### Task 5: Shared style preamble and token ceiling

**Files:**
- Modify: `~/working/meshtk/internal/app/fleet/llm.go:22-39`
- Test: `~/working/meshtk/internal/app/fleet/llm_test.go`

**Interfaces:**
- Consumes: nothing
- Produces: `const chatStylePreamble string`, `func composeSystemPrompt(persona string) string`, `const llmMaxTokens = 2000`

`defaultSystemPrompt` is deleted; the empty-persona case is handled by `composeSystemPrompt` returning the preamble alone.

- [ ] **Step 1: Write the failing test**

Append to `internal/app/fleet/llm_test.go`:

```go
func TestComposeSystemPromptIncludesBoth(t *testing.T) {
	got := composeSystemPrompt("You are Condor.")
	if !strings.Contains(got, "You are Condor.") {
		t.Error("persona missing from composed prompt")
	}
	if !strings.Contains(got, "own line") {
		t.Error("style preamble missing from composed prompt")
	}
}

func TestComposeSystemPromptEmptyPersona(t *testing.T) {
	if got := composeSystemPrompt("   "); got != chatStylePreamble {
		t.Errorf("empty persona should yield the bare preamble, got %q", got)
	}
}

// The preamble tells the model never to use an em dash. It would be a poor
// teacher if it used one itself.
func TestChatStylePreambleHasNoDashes(t *testing.T) {
	if strings.ContainsAny(chatStylePreamble, "—–") {
		t.Error("chatStylePreamble contains an em or en dash")
	}
}

func TestLLMMaxTokensAllowsFullBurst(t *testing.T) {
	// 7 messages of ~200 chars is roughly 400 tokens; the ceiling must clear
	// that with room so the final message is never clipped mid-word.
	if llmMaxTokens < 1000 {
		t.Errorf("llmMaxTokens = %d, too low for a 7-message burst", llmMaxTokens)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/working/meshtk && go test ./internal/app/fleet/ -run 'TestComposeSystemPrompt|TestChatStylePreamble|TestLLMMaxTokens' -v`
Expected: FAIL to build with `undefined: composeSystemPrompt`

- [ ] **Step 3: Write minimal implementation**

In `internal/app/fleet/llm.go`, add `"strings"` to the import block. Change `llmMaxTokens` from `150` to `2000`. Delete the `defaultSystemPrompt` const and replace it with:

```go
// chatStylePreamble is the shared output contract for every LLM ghost. Voice
// lives in each persona's SystemPrompt; how the words arrive lives here, so
// cadence is tuned in one place across the whole fleet.
//
// The 200-character ask sits under chatHardLimit (230) deliberately, so the
// model's own lines never reach the fallback splitter.
const chatStylePreamble = `You are texting on a mesh radio. Write like a person, not a chatbot.

Put each message on its own line. A blank line is ignored. Send 3 to 7 messages.
Keep every message under 200 characters. Most should be much shorter. A one or
two word message is good.

Never use an em dash or an en dash. Use a period, a comma, or start a new message.

Type the way a person types on a phone: contractions, dropped apostrophes,
lowercase after the opening message, short words instead of long ones.

About one message in five should carry a small typo. Never put a typo in a URL,
a code, or a number. Now and then, fix a typo by sending the corrected word on
its own with a leading asterisk.

Do not number your messages. No bullets, no markdown, no stage directions.`

// composeSystemPrompt puts the shared cadence contract in front of the ghost's
// own voice.
func composeSystemPrompt(persona string) string {
	if strings.TrimSpace(persona) == "" {
		return chatStylePreamble
	}
	return chatStylePreamble + "\n\n" + persona
}
```

Then rewrite `generateReply` to compose rather than default:

```go
func generateReply(ctx context.Context, message, systemPrompt string) (string, error) {
	systemPrompt = composeSystemPrompt(systemPrompt)
	if key := os.Getenv("MESHTK_ANTHROPIC_KEY"); key != "" {
		return callClaudeAnthropic(ctx, message, systemPrompt, key)
	}
	return callClaudeBedrock(ctx, message, systemPrompt)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/working/meshtk && go test ./internal/app/fleet/ -v`
Expected: PASS, all tests in the package including the pre-existing three in `llm_test.go`

- [ ] **Step 5: Commit**

```bash
cd ~/working/meshtk
git add internal/app/fleet/llm.go internal/app/fleet/llm_test.go
git commit -m "feat(fleet): shared chat style preamble, raise max tokens to 2000"
```

---

### Task 6: Wire handleLLMChat

**Files:**
- Modify: `~/working/meshtk/internal/app/fleet/cmd.go:1082-1160`

**Interfaces:**
- Consumes: `splitMessages`, `baseDelay`, `applyJitter`, `openingDelay` (Tasks 3-4)
- Produces: nothing consumed downstream

This deletes the `splitIntoChunks` method entirely. It has exactly one caller (`cmd.go:1096`), verified with `rg -n "splitIntoChunks"` — the fallback path now lives in `splitSentenceAware`.

- [ ] **Step 1: Confirm the only caller before deleting**

Run: `cd ~/working/meshtk && rg -n "splitIntoChunks" --glob '!vendor' --glob '*.go'`
Expected: exactly 3 hits, all in `cmd.go` — the call at 1096, the doc comment at 1105, the definition at 1107. If there are others, stop and report.

- [ ] **Step 2: Replace the send loop**

In `internal/app/fleet/cmd.go`, add `"math/rand"` to the import block. Replace ONLY the chunking loop (lines 1096-1102, everything from `for i, chunk := range n.splitIntoChunks(reply, 60) {` through its closing brace) with the code below.

Leave everything above it in `handleLLMChat` exactly as-is: the `generateReply` call, the error path that sends `"👻 …signal lost. try again."`, and the `guardOutput` block at lines 1090-1095 that returns `cannedRefusal`. The guardrail must keep running on the whole reply before any splitting.

```go
	msgs, dropped := splitMessages(reply)
	if dropped > 0 {
		n.Config.Log.Warnf("LLM reply exceeded %d messages, dropped %d", maxChatMessages, dropped)
	}
	if len(msgs) == 0 {
		n.Config.Log.Errorf("LLM reply produced no sendable messages")
		return
	}
	go func() {
		time.Sleep(openingDelay(rand.Float64()))
		for i, m := range msgs {
			n.sendPKIReply(toFleetIdx, to, from, topic, m)
			if i < len(msgs)-1 {
				time.Sleep(applyJitter(baseDelay(len(m)), rand.Float64()))
			}
		}
	}()
```

> **Revised during execution, user-approved.** The paced send runs on its own
> goroutine, mirroring `handleLyricsChat` at `cmd.go:1041`. The original version
> of this block ran inline, which blocks paho's ordered dispatch goroutine for up
> to ~27s — `mqtt.go:257` calls the handler synchronously and `SetOrderMatters`
> is never set, so paho's default of `true` applies. That matters beyond latency:
> `isRetransmit` anchors a FIXED 30s dedup window that does not refresh on a hit
> (`cmd.go:568-579`), so occupancy past 30s makes a queued retransmit read as a
> new request and fire a SECOND full burst. ACKs stall for the duration too.
>
> Message shaping and both log lines stay synchronous — only the sleep-and-send
> loop moves.

- [ ] **Step 3: Delete the dead splitter**

Delete the entire `splitIntoChunks` method and its doc comment (the block from `// splitIntoChunks splits a string into chunks of specified size` through the closing brace of the function, originally lines 1105-1160).

- [ ] **Step 4: Verify it builds and the package is clean**

Run: `cd ~/working/meshtk && go build ./... && go vet ./internal/app/fleet/ && go test ./internal/app/fleet/`
Expected: no build output, no vet output, `ok github.com/whereiskurt/meshtk/internal/app/fleet`

- [ ] **Step 5: Verify the flag path is untouched**

Run: `cd ~/working/meshtk && rg -n "sendPKIReplyReliable|RevealURL" internal/app/fleet/cmd.go | head`
Expected: the reveal and reliable-send call sites still present and unmodified. `git diff` for this task must show changes ONLY inside `handleLLMChat` and the deleted splitter.

- [ ] **Step 6: Commit**

```bash
cd ~/working/meshtk
git add internal/app/fleet/cmd.go
git commit -m "feat(fleet): send LLM replies as a paced multi-message burst"
```

---

### Task 7: Mirror the Go changes into the monorepo tree

**Files:**
- Create: `apps/run.mqtt/meshtk/internal/app/fleet/chatstyle.go`
- Create: `apps/run.mqtt/meshtk/internal/app/fleet/chatstyle_test.go`
- Modify: `apps/run.mqtt/meshtk/internal/app/fleet/llm.go`
- Modify: `apps/run.mqtt/meshtk/internal/app/fleet/llm_test.go`
- Modify: `apps/run.mqtt/meshtk/internal/app/fleet/cmd.go`

**Interfaces:**
- Consumes: everything from Tasks 1-6
- Produces: the tree that `Dockerfile.meshtk` actually builds

The monorepo tree is the Docker build context (`COPY . .`), so this is the copy that ships. The upstream copy exists so the next vendor-sync does not revert it.

- [ ] **Step 1: Copy the five files**

```bash
cd /Users/khundeck/working/defcon.run.34
SRC=~/working/meshtk/internal/app/fleet
DST=apps/run.mqtt/meshtk/internal/app/fleet
cp "$SRC/chatstyle.go" "$SRC/chatstyle_test.go" "$SRC/llm.go" "$SRC/llm_test.go" "$SRC/cmd.go" "$DST/"
```

- [ ] **Step 2: Verify the two trees are byte-identical for the fleet package**

```bash
diff -r ~/working/meshtk/internal/app/fleet \
        /Users/khundeck/working/defcon.run.34/apps/run.mqtt/meshtk/internal/app/fleet
```
Expected: no output. Any output means a file diverged and must be reconciled before continuing.

- [ ] **Step 3: Build and test the monorepo tree independently**

```bash
cd /Users/khundeck/working/defcon.run.34/apps/run.mqtt/meshtk
go build ./... && go test ./internal/app/fleet/
```
Expected: no build output, `ok github.com/whereiskurt/meshtk/internal/app/fleet`

- [ ] **Step 4: Commit**

```bash
cd /Users/khundeck/working/defcon.run.34
git add apps/run.mqtt/meshtk/internal/app/fleet/
git commit -m "feat(mqtt): mirror meshtk chat cadence changes into the built tree"
```

---

### Task 8: Strip em dashes and the 230-char rule from the 8 persona prompts

**Files:**
- Modify: `apps/run.mqtt/meshtk/meshtk.dc34.yaml` — `SystemPrompt` at lines 115, 163, 211, 259, 307, 355, 403, 451

**Interfaces:**
- Consumes: nothing
- Produces: persona prompts carrying voice only

The eight ghosts with a `SystemPrompt` are goldstein, mudge, condor, sharp, ladyada, hopper, turing, gibson. `ricky` (lyrics-only) and `dt` have none. All eight currently contain both an em dash and the trailing 230-char instruction.

- [ ] **Step 1: Record the baseline**

```bash
cd /Users/khundeck/working/defcon.run.34/apps/run.mqtt/meshtk
rg -c '—' meshtk.dc34.yaml          # expect 9
rg -c '230 characters' meshtk.dc34.yaml  # expect 8
rg -n 'Id: "' meshtk.dc34.yaml | wc -l   # expect 27, record it
```

- [ ] **Step 2: Read all 8 prompts before editing any of them**

```bash
cd /Users/khundeck/working/defcon.run.34/apps/run.mqtt/meshtk
rg -n 'SystemPrompt:' meshtk.dc34.yaml
```
Then `Read` each of those lines in full. They are long single-line prose strings and the em dashes sit mid-sentence, so each replacement is a judgement about that sentence. Do not attempt a blind `sed` across the file — it would also hit line 864.

- [ ] **Step 3: Edit each of the 8 SystemPrompt values by hand**

For each of lines 115, 163, 211, 259, 307, 355, 403, 451, make exactly two kinds of change inside the quoted prompt string:

1. Replace every em dash with the punctuation the sentence actually wants — usually a comma, sometimes a period. Example from condor (line 211): `built from his public persona, his story, his writings, and his experiences—still speaking with the same wit and insight` becomes `...and his experiences, still speaking with the same wit and insight`.
2. Delete the trailing sentence `All responses must be limited to under 230 characters.` and any adjacent sentence that also prescribes length or message count — for condor that includes `For topics where Kevin was a direct witness or contributor, the GPT should provide multiple separate responses, each under 230 characters, to reflect layered insight or perspective.` The shared preamble owns length and count now, and a persona repeating it in different numbers is a contradiction the model has to resolve.

Do not change voice, catch-phrases, or the `always have a way out` instruction. Do not touch line 864 (`rabbit.pack` `Description`).

- [ ] **Step 4: Verify the edits landed and nothing else moved**

```bash
cd /Users/khundeck/working/defcon.run.34/apps/run.mqtt/meshtk
rg -c '—' meshtk.dc34.yaml          # expect 1 (only rabbit.pack Description)
rg -n '—' meshtk.dc34.yaml          # expect the single hit to be line ~864
rg -c '230 characters' meshtk.dc34.yaml  # expect 0
rg -n 'Id: "' meshtk.dc34.yaml | wc -l   # expect 27, unchanged
```

- [ ] **Step 5: Verify the YAML still parses and the image assertion would pass**

```bash
cd /Users/khundeck/working/defcon.run.34/apps/run.mqtt/meshtk
python3 -c "import yaml,sys; yaml.safe_load(open('meshtk.dc34.yaml')); print('yaml ok')"
grep -cE '^[[:space:]]*GPXFile:' meshtk.dc34.yaml   # expect 24, matching the Dockerfile assertion
```

- [ ] **Step 6: Commit**

```bash
cd /Users/khundeck/working/defcon.run.34
git add apps/run.mqtt/meshtk/meshtk.dc34.yaml
git commit -m "feat(mqtt): strip em dashes and length rules from ghost personas"
```

---

### Task 9: Re-sync the fleet manifest

**Files:**
- Modify: `apps/run.human/webapp/src/data/meshtk-fleet-yaml.ts` (generated, committed)

**Interfaces:**
- Consumes: the edited `meshtk.dc34.yaml` (Task 8)
- Produces: an in-sync run.human fleet snapshot

`meshtk-fleet-yaml.ts` is a committed byte-for-byte snapshot of `meshtk.dc34.yaml`. A parity vitest (`src/lib/__tests__/mesh-ghosts.test.ts`) byte-compares the two and fails on drift, so skipping this task breaks run.human's test suite.

- [ ] **Step 1: Run the sync**

```bash
cd /Users/khundeck/working/defcon.run.34/apps/run.human/webapp
node scripts/sync-meshtk-fleet.mjs
```
Expected: `wrote .../src/data/meshtk-fleet-yaml.ts (NNNNN bytes of YAML)`

- [ ] **Step 2: Confirm the parity test passes**

```bash
cd /Users/khundeck/working/defcon.run.34/apps/run.human/webapp
nvm use 22.12.0   # vitest requires Node >= 22.12
npx vitest run src/lib/__tests__/mesh-ghosts.test.ts
```
Expected: PASS. A failure here means the snapshot did not regenerate.

- [ ] **Step 3: Inspect the diff**

Run: `cd /Users/khundeck/working/defcon.run.34 && git diff --stat`
Expected: exactly one changed file, `apps/run.human/webapp/src/data/meshtk-fleet-yaml.ts`. The content diff is one enormous JSON-escaped string line, so `--stat` is the readable check. If any other file changed, stop and report.

- [ ] **Step 4: Commit**

```bash
cd /Users/khundeck/working/defcon.run.34
git add apps/run.human/webapp/src/data/meshtk-fleet-yaml.ts
git commit -m "chore(human): re-sync meshtk fleet snapshot after persona edits"
```

---

### Task 10: Full verification

**Files:** none modified

- [ ] **Step 1: Both trees build and test clean**

```bash
cd ~/working/meshtk && go build ./... && go vet ./internal/app/fleet/ && go test ./internal/app/fleet/ -count=1
cd /Users/khundeck/working/defcon.run.34/apps/run.mqtt/meshtk && go build ./... && go test ./internal/app/fleet/ -count=1
```
Expected: `ok github.com/whereiskurt/meshtk/internal/app/fleet` from both, no vet output.

- [ ] **Step 2: Trees still identical**

```bash
diff -r ~/working/meshtk/internal/app/fleet \
        /Users/khundeck/working/defcon.run.34/apps/run.mqtt/meshtk/internal/app/fleet
```
Expected: no output.

- [ ] **Step 3: The old 60-char splitter is gone**

```bash
cd /Users/khundeck/working/defcon.run.34/apps/run.mqtt/meshtk
rg -n "splitIntoChunks" --glob '!vendor' --glob '*.go'
```
Expected: no hits.

- [ ] **Step 4: Docker image builds, including the GPX assertion**

```bash
cd /Users/khundeck/working/defcon.run.34/apps/run.mqtt && ./build.sh meshtk
```
Expected: `meshtk GPX route assertion: verified 24 routes present in /app`, then `=== mqtt-meshtk:local built ===`. This is a local image build only — it does not push or deploy.

- [ ] **Step 5: Report for UAT**

Summarize for the user: both trees green, image builds, and the change is ready to release. Flag explicitly that behavior is unverified against the live model until a ghost is unlocked in prod, and that the three things to watch in UAT are the typo rate (tunable in one line of `chatStylePreamble`), whether the model honors one-message-per-line, and that a flag claim URL still arrives intact and unchunked.

Do NOT release or deploy. Per AGENTS.md the release is `./apps/release-all.sh --apps run.mqtt --pr` followed by the `deploy.yml` workflow, and both wait for explicit user approval.

---

## Deployment Notes

Out of scope for this plan, recorded so the next session does not have to rediscover it:

- The ghost chat runs in the **meshtk** image (`mqtt-meshtk`), not the nginx image.
- Copy `env.local.sh` into the worktree root before any release, or the build dies at the S3 sync with exit 255 after images already pushed.
- ECR repos are immutable; the Release PR's VERSION bump must produce a new tag.
- `cac1` has historically lagged `use1` on run.mqtt deploys. Confirm which regions are in scope at release time.
