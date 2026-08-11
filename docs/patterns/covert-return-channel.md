# Covert return channel

**Return a server's verdict to a page through a benign-looking styling asset — always
served identically, read from the styling engine rather than the network — so that
success, failure, and auth-state are byte-for-byte indistinguishable to a network
watcher, a log, and a shoulder-surfer.**

## Context

Sometimes a page has to ask a server a yes/no question and act on the answer, in a
setting where *the asking must not be observable*. The classic version is a hidden
in-page action — a secret gesture that submits a value and celebrates on success — where
the whole point is that a bystander watching the browser's network tab, or an operator
reading server logs, cannot tell whether the gesture landed, whether the person is signed
in, or even that anything happened at all.

The naive version leaks on every axis. A `fetch` that returns `{"win":true}` shows up in
the network tab with a tell-tale JSON body. A `200` on success and `403` on failure leaks
through the status code. A `Set-Cookie` or a custom header leaks through the response
metadata. Even a same-status JSON response leaks through *body size* — a win object and a
lose object are different lengths. Any of these turns a "did they get it?" question into a
one-glance answer for anyone looking over a shoulder or grepping a log.

## Forces

- **Every network-visible field is a potential tell.** Status code, content-type,
  headers, cookies, *and body length* are all observable in a browser's network panel and
  in edge access logs. To be truly covert, all of them must be constant across outcomes.
- **The read has to happen somewhere.** The page still needs the answer. If it reads the
  answer off the *network response*, the observation happens on an observable surface. The
  read must move off the network entirely.
- **The channel must be deniable, not just quiet.** It isn't enough that the traffic is
  low-key; a determined observer who *does* look must see something that reads as ordinary
  and unrelated — a theme loading, a cache-buster ticking — not an obviously-encoded token.
- **Robustness cannot create a tell.** The decoder handling garbage input must fail into
  the *same* observable state as a legitimate non-win. A thrown error, a different status,
  a stack trace in a log — any of these is a differential an attacker can trigger on purpose.

## The pattern

Encode the verdict inside a **styling asset** — a stylesheet — and read it back through
the **styling engine's computed-value API**, never through the network response body.

```
   in-page action
        │  injects <link rel=stylesheet href=".../theme?v=<encoded>">
        ▼
   ┌─────────────┐   always: 200, text/css, no-store, ~same size
   │   server    │   ├─ win  → base sheet + :root{ --token: <N> }
   │  (the judge)│   └─ else → base sheet + :root{ --filler: 000 }   (same length)
   └─────────────┘
        │  browser applies the sheet as a theme
        ▼
   getComputedStyle(el).getPropertyValue('--token')   ← CSSOM read, NOT a network event
        │
        ▼   non-empty / > 0  ⇒  win
   celebrate
```

**One asset type, one envelope, every time.** The endpoint always answers `200`, always
`text/css`, always `no-store`. Win, wrong, unauthenticated, and malformed input all return
a stylesheet. There is no status, header, or cookie that varies with the outcome.

**The verdict is a presence-only marker inside the body.** Both outcomes return the same
believable base theme. The win sheet adds one declaration — a custom property that reads
like a theme token (`--accent-ramp: 734`, where the number is the award). The decoy adds a
*different* same-length declaration (a filler token that is never read). So the win-marker
declaration is *present on a win and absent otherwise* — its mere presence is the entire
signal — and the two bodies differ by only a couple of bytes.

**Read through the styling engine, not the network.** The page injects the sheet with a
`<link>`, waits for it to apply, then reads the marker with
`getComputedStyle(el).getPropertyValue('--token')`. This is a **computed-style read**, not
a fetch-body parse and not a CSSOM-rule read. To a network watcher it is indistinguishable
from any stylesheet loading; there is no response body being inspected in JavaScript. (It
also works cross-origin: applied custom properties are readable via computed style even
when the sheet's raw rules are not.)

**The codec is reversible and total.** The value carried in the request looks like a
version stamp / cache-buster (`?v=20260806`). It is framing, not a secret — a forged value
still has to pass the real check downstream. Critically, the decoder is **total**: any
malformed input returns `null`, and `null` *is* the decoy trigger. It never throws. So the
robustness path and the honest-non-win path converge on the exact same output — the plain
sheet — and there is no input an attacker can craft to produce a distinguishable error.

**A guard test enforces the invariant at author time.** The covert modules are read from
disk by a test that fails if any of them so much as *mentions* the reward payload / the
game's win-vocabulary. This keeps a future well-meaning edit from leaking a win-only string
into the covert body (or importing a celebratory renderer into the covert path), which
would reintroduce a size or content tell the human eye would miss.

## Key moves

- **Move the read off the network.** The single load-bearing idea: the answer is delivered
  as *rendered state* and read from the render engine, so the observation surface is the
  DOM/CSSOM, not the wire. Everything else is in service of keeping the wire uniform.
- **Presence-only marker with a same-length decoy.** Don't encode win-vs-lose as
  *different values* of one field — encode it as *presence vs absence* of a marker, and pad
  the absence case with an equal-length dummy so body size never moves.
- **Bound the size delta explicitly.** The only remaining variation is the digit-count of
  the encoded number; keep a documented tolerance (a handful of bytes) and, ideally, a test
  that asserts `|len(win) − len(decoy)| ≤ tolerance` across the real value range.
- **Total, never-throwing decode → decoy.** Make "I couldn't decode this" and "this isn't
  a win" the *same* observable outcome. A decoder that can throw is a decoder that leaks.
- **No secret ever returns.** Nothing the server hands back — no nonce, cookie, or header —
  is needed to act on the result. The only claim material the client holds is what it sent.
  That is what lets win/lose/unauth stay byte-identical (there is nothing outcome-specific
  to return) and it makes replay trivially safe.
- **Guard the invariant in code, not just in review.** A source-reading test that bans the
  win-vocabulary from the covert files turns "don't leak a tell here" into a red build.

## Traps

- **Body size is a tell people forget.** Two same-status, same-content-type JSON responses
  still differ in length. If you carry the verdict as a value, pad the other branch to match.
- **In-memory subresource caching silently blocks re-fires.** A `<link>` to a URL the page
  already requested is served from the browser's memory cache *without a network request* —
  even under `no-store`. A deterministic covert URL therefore hits the server exactly once
  per page load; every repeat gesture reads a stale answer. Append a unique-per-fire token
  (time component + a monotonic in-page counter) so each fire is a real request. The server
  ignores that token.
- **Logging is a side channel.** If the endpoint emits even one structured line that varies
  with the outcome, the covert body was pointless. Keep the handler log-free (or log only a
  coarse, outcome-agnostic line) and never log the raw submitted value.
- **CSSOM-rule reads can be blocked cross-origin; computed-style reads are not.** If the egg
  can live on a different origin than the asset, read the *computed value on an element*, not
  the sheet's `cssRules` — the latter throws cross-origin and would break (or leak via the
  error) exactly where you need it to work.
- **A celebratory renderer imported into the covert path re-inflates the body.** Keep the
  win-side UI (confetti text, reward strings) entirely on the *visible* path; the covert
  channel returns only the bare marker.

## When not to use it

- **When observability is fine.** If nobody is watching the network tab and the logs aren't
  adversarial, a plain JSON endpoint is simpler and you should use it. This machinery only
  earns its keep when *unobservability itself* is a requirement.
- **When you must return a real secret.** The channel is designed so nothing sensitive comes
  back. If the page genuinely needs a durable secret from the server, a covert GET whose URL
  and response are both semi-public is the wrong tool — use an authenticated, encrypted
  channel and accept the visibility.
- **When the value must survive tampering on its own.** The encoded request value is framing,
  not authentication. The real check must live behind it; don't let the codec's reversibility
  fool you into trusting the payload.

## As built (defcon.run 34)

- **Design spec:** `docs/superpowers/specs/2026-07-13-ctf-judge-and-covert-channel-design.md`
  — §6.2 (the two front doors), §7 (endpoint disguise, CSS-as-ack, the invisibility
  invariants), §10 (anti-cheat/hygiene).
- **Codec (reversible + total):** `apps/run.human/webapp/src/lib/ctf-covert-codec.ts` —
  `encodeFlag`/`decodeFlag`; every failure returns `null`, never throws.
- **Sheet builder (presence-only marker + same-length filler):**
  `apps/run.human/webapp/src/lib/ctf-covert-css.ts` — `buildWinSheet`/`buildDecoySheet`,
  `AWARD_PROP`, `SIZE_TOLERANCE`.
- **Egg-side client (computed-style read, per-fire cache-buster):**
  `apps/run.human/webapp/src/lib/covert-egg.ts` — `fireCovert`/`readAward`/`shouldCelebrate`.
- **Endpoint (always `200 text/css`, total guard, no logging):**
  `apps/run.human/webapp/src/app/(ctf)/assets/theme/route.ts` — `handleCovert`.
- **Author-time guard tests:**
  `apps/run.human/webapp/src/lib/__tests__/ctf-reward-covert-invariant.test.ts` (and the
  sibling `ctf-otp-singleuse-covert-invariant.test.ts`, `ctf-wordlist-covert-invariant.test.ts`)
  read the covert source files from disk and fail if any references a reward token.
- Realized on a CDN-fronted app route emitting `text/css`, the browser CSSOM, and the main
  Next.js app as the sole judge behind it.
