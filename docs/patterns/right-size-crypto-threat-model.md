# Right-size crypto to the stated threat

**Name the specific threat you're actually defending against, implement exactly enough
to defeat *that* — no more — write down in the code why it is deliberately not
stronger, and confine the whole choice to one file so a future upgrade is a
single-file edit.**

## Context

You need to store some secret-ish values so they can be checked later: challenge
answers, coupon codes, low-value tokens. The reflex is to reach for the heaviest
hammer in the drawer — "it's a secret, so bcrypt/argon2/scrypt it" — because that's
what you cargo-cult from password storage. Or the opposite reflex: store it in
plaintext because it's "not really sensitive," and hand the whole set to anyone who
reads one table.

Both reflexes skip the one step that actually decides the right answer: *stating the
threat*. Password hashing is calibrated for a very specific adversary — one who has
stolen your hash table and will grind billions of guesses offline against
human-chosen, low-entropy passwords. If your threat isn't that, a password-grade KDF
is answering a question you didn't ask (and paying its CPU cost on every check). If
your threat is worse than "plaintext leak," plaintext is negligent. The job is to
match the mechanism to the actual threat and *record the match* so the next person
doesn't have to re-derive it.

## Forces

- **Effort should track the threat, not the vibe.** "It's a secret" is not a threat
  model. "A read of this table must not hand the attacker the answers" is. Only the
  second one tells you what to build.
- **Over-engineering has real costs.** A password-grade KDF is deliberately slow; on a
  hot verification path that's latency you're spending to defend against an attack that
  may not apply. And cargo-culted crypto invites cargo-culted *mis*-use.
- **Under-engineering is negligence.** Plaintext answers, or an unsalted hash trivially
  reversed by a precomputed rainbow table, means one table read is a total compromise.
- **The right choice today may be wrong tomorrow.** The threat can escalate. If the
  crypto decision is smeared across the codebase, upgrading it is a scary
  archaeology project; if it's in one file behind one function, it's a small edit.
- **Comparison is a side channel.** How you *check* a secret can leak it — a
  non-constant-time compare leaks via timing; a log line leaks via the log.

## The pattern

Turn the vague "make it secure" into a written threat and build precisely to it.

```
   1. STATE THE THREAT          "a table leak must not hand over the answers"
                                          │
   2. BUILD EXACTLY ENOUGH      salted hash with a per-app static salt
                                (defeats a GENERIC rainbow table for a table read)
                                          │
   3. DOCUMENT THE CEILING      in-module comment: this is deliberately NOT
                                password-grade, and here is why that's OK here
                                          │
   4. CONFINE TO ONE FILE       upgrading to per-answer salt or a real KDF is
                                a single-file change — nothing else knows how
                                the value is hashed
```

**State the threat in one sentence.** Write the adversary down: *what do they have,
and what must they not get?* ("An attacker who reads the stored table must not recover
the plaintext answers.") That sentence is the spec for everything below it.

**Build exactly enough to defeat that threat.** For "table-read must not reveal
answers," a salted hash with a per-application static salt is enough: it defeats a
*generic* precomputed rainbow table, which is the attack a table read enables. You do
*not* need a per-answer salt or a slow KDF for that stated threat — those defend
against a *different* adversary (one grinding targeted offline guesses), and if that
adversary isn't in your threat model you're paying for defense you don't need.

**Document the ceiling, in the module.** Right where the hashing lives, write *why* it
is deliberately not stronger: name the threat it does defend, and name the threat it
does not (offline guessing of low-entropy inputs). This is the difference between "a
considered choice" and "someone didn't know better" — and it's what lets a reviewer
trust the code and a successor upgrade it confidently.

**Confine the whole choice to one file.** Every path that hashes or compares the value
goes through one small module. Then escalating the threat model — per-answer salt, a
real KDF — is a single-file edit; no caller knows or cares how the value is hashed.

**Make the comparison side-channel-clean.** Compare in constant time, never log the
inputs, and give the pre-hashed path and the raw-guess path *one shared comparator* so
there's exactly one place the check happens (and one place to get it right).

## Key moves

- **The threat sentence is the design.** Write it first, in plain words. Everything
  downstream is "what defeats exactly this?" — no more, no less.
- **Match the mechanism to the attack, not to the word "secret."** A static app salt
  beats rainbow tables; a per-answer salt beats targeted offline guessing; a slow KDF
  beats mass low-entropy cracking. Pick the one whose attack is in your model.
- **Write the ceiling down where the code is.** An in-module comment stating "not
  password-grade, and here's why that's fine here" converts an invisible judgment call
  into a documented, reviewable, upgradable decision.
- **One file, one function, one comparator.** Localizing the crypto makes both the
  audit and the future upgrade small. Sharing the comparator between the pre-hashed and
  raw-guess paths guarantees byte-identical behavior and one correct check.
- **Constant-time, never-logged.** The comparison is part of the threat surface: use a
  timing-safe compare and keep the raw input out of every log.

## Traps

- **"It's a secret, so bcrypt it" everywhere.** Reflexively applying password-grade
  hashing to non-password values adds latency and complexity against an adversary you
  may not face, and normalizes cargo-culting over threat-stating. Ask what the attack
  actually is first.
- **A static salt read as password-grade.** A per-app static salt defeats *generic*
  rainbow tables but not a *targeted* offline grind — so if your inputs are
  low-entropy and offline guessing *is* in your threat model, this is under-built.
  That's exactly why the ceiling has to be documented: so the boundary is explicit,
  not assumed.
- **Rotating the salt orphans the stored hashes.** With a static salt, changing it
  makes every existing stored hash unverifiable — they must be re-hashed. Note this at
  the salt definition so a "let's rotate the salt" impulse doesn't silently break
  verification.
- **A non-constant-time or logging comparator.** Getting the hash right and then leaking
  via timing or a debug log undoes the work. The comparator is part of the threat
  surface, not an afterthought.
- **Length-mismatched timing-safe compares throw.** A constant-time compare typically
  requires equal-length inputs; guard for empty/mismatched lengths and return a plain
  "no match" rather than letting it throw.

## When not to use it

- If your threat model genuinely *is* "offline grinding of human passwords," then a
  password-grade KDF is the right-sized answer — this pattern points you *to* argon2/
  scrypt there, not away from it. Right-sizing cuts both ways.
- If the value is truly public or worthless, even a salted hash is overhead; store it
  plainly and spend the effort elsewhere. The pattern is about *matching* effort to
  threat, including matching *down*.
- If a compliance regime dictates a specific mechanism regardless of your own threat
  analysis, follow the mandate; the threat-first reasoning still helps you document why,
  but the choice isn't yours to right-size.

## As built (defcon.run 34)

- **Reference implementation:** `apps/run.human/webapp/src/lib/ctf-hash.ts` — a salted
  SHA-256 of the normalized answer with a per-app static salt (`CTF_ANSWER_SALT`,
  documented default). The module header states the exact threat ("a table leak doesn't
  hand over flags — NOT password-grade KDF") and that upgrading to a per-answer salt or
  a real KDF is "a single-file change confined to this module." `verifyAnswerHash` does
  a constant-time `timingSafeEqual`, returns false (never throws) on empty/length-
  mismatched inputs, and never logs its inputs; `verifyAnswer` (raw guess) delegates to
  it so both paths share one comparator.
- **Threat context:** the same "a table leak doesn't reveal flags" framing appears in
  the CTF judge design's anti-cheat section,
  `docs/superpowers/specs/2026-07-13-ctf-judge-and-covert-channel-design.md` §10.
- Realized with Node's built-in `crypto` (`createHash`, `timingSafeEqual`) — no added
  dependency, which is itself a right-sizing choice.
