# Email-to-object-store test seam

**To end-to-end test a flow that hinges on a real email — a one-time code, a magic link —
route the mail provider's inbound mail into an object store and let the test poll that
store, match on recipient, and pull the code out of the message. Add plus-addressing and
you get many isolated test identities against the real mail path, with no mock and no test
backdoor in production.**

## Context

The hardest half of an authentication flow to automate is the part that leaves your system.
A login sends a six-digit code or a magic link *by email*; the user reads it out-of-band and
brings it back. An end-to-end test has to close that loop — it needs to actually receive the
mail and extract the secret — or it isn't testing the flow that real users take.

The usual escapes all weaken something. Mock the mail send and you've stopped testing the
real delivery path — the templating, the provider, the deliverability. Bake a test-only
backdoor into production ("if the email is `test@…`, the code is always `000000`") and
you've shipped a bypass that is now an attack surface. Read the code out of the database and
you're reaching behind the flow instead of through it. What you want is to receive the *real*
email the *real* way, and still have a test read it programmatically.

## Forces

- **The out-of-band channel is the whole point.** The email hop is exactly what you're
  trying to verify works. Anything that skips it tests a different, easier system than the
  one users hit.
- **Tests need to read a human channel.** Email is built for a person with an inbox, not a
  test runner with an assertion. You need a machine-readable tap on that channel that
  doesn't distort it.
- **Production must not grow test-only affordances.** Every backdoor, magic value, or
  "test mode" branch is a permanent liability that outlives the test and widens the attack
  surface. The test seam has to live *outside* the production trust boundary.
- **Parallel tests must not collide.** Run auth tests concurrently and they'll fight over
  one mailbox — whose code is whose? You need many isolated identities without provisioning
  many real mailboxes.

## The pattern

Turn the mail provider's *inbound* side into a pollable store, and turn one address into
many with plus-addressing.

```
   test triggers login ──► app sends REAL email ──► mail provider
                                                        │ inbound rule
                                                        ▼
                                              object store: inbox/<domain>/<msg>
                                                        │
   test polls the store ◄───────────────────────────────┘
   ├─ list objects newer than "I started"
   ├─ fetch each, match on recipient (the +tag)
   └─ regex the code/link out of subject or body
```

**1 — Route inbound mail into an object store.** Configure the mail provider so that mail
arriving at your domain is deposited as objects under a known prefix (`inbox/<domain>/…`)
instead of, or in addition to, a human mailbox. Now every email your app sends and that
"comes back" to your domain is a retrievable object with a timestamp.

**2 — Poll, don't wait for a webhook.** The test lists the inbox prefix for objects created
*after* the moment it kicked off the login, newest first, on a short interval up to a
timeout. Polling is simpler and more robust for a test than standing up a webhook receiver,
and the "after my start timestamp" filter keeps it from matching a stale message from an
earlier run.

**3 — Match on recipient, extract with a regex.** For each candidate object, fetch the body
and confirm it's addressed to *this test's* recipient (substring match on the address). Then
pull the secret out with a regex against the subject and the body — a one-time code is a
`\d{6}` in the subject line or inside a known markup wrapper; a magic link is a URL match.
Return the extracted value to the test to submit back through the front door.

**4 — Plus-addressing for isolated parallel identities.** A single real inbox
`user@domain` accepts `user+anything@domain`, all delivered to the same place but each
distinguishable. Give every test case its own tag — `user+caseA@domain`,
`user+accountb@domain` — and each gets a parallel, isolated identity against the *real* mail
path. The recipient-match step keys on the full plus-address, so concurrent tests never read
each other's codes, and you never provisioned more than one mailbox.

The result: the test drives the genuine send-email-and-read-it-back loop, end to end,
through the same code a user hits — with the only "test-only" thing being an inbound routing
rule that lives entirely outside production.

## Key moves

- **Tap the channel, don't fake it.** The seam is a *read tap* on real inbound mail, not a
  substitute for it. Everything the app does to send the email still happens; the test just
  gains a way to read the result.
- **The seam lives outside the production trust boundary.** An inbound-mail routing rule and
  a test that reads a bucket touch nothing in the production app. There is no code path in
  production that behaves differently because a test is running — which is exactly why this
  is safe where a backdoor isn't.
- **Filter by start-time to avoid stale matches.** Anchor the poll to "objects newer than
  when I started." Without it, a test can grab a leftover email from a previous run and pass
  (or fail) for the wrong reason.
- **Plus-addressing is free parallelism.** One mailbox becomes unlimited isolated
  identities. Lean on it for concurrency and for role-based scenarios (primary user, second
  user, admin) without any extra provisioning.
- **Extract narrowly, from a known shape.** Regex the exact format your templates produce
  (six digits in the subject, a URL in a known wrapper). A tight pattern fails loudly when a
  template changes, which is a test doing its job.

## Traps

- **Stale-message matches.** The single most common flake: matching an email from a prior
  run. The after-timestamp filter is the fix; skipping it is the bug.
- **Delivery latency vs. timeout.** Real mail takes seconds — sometimes tens of seconds — to
  route and land as an object. Size the poll timeout generously (a minute-plus), or the test
  fails on a slow-but-correct delivery.
- **Recipient match too loose.** Match on the full plus-address, not just the base user, or
  concurrent `+caseA` and `+caseB` tests will read each other's mail and pass
  nondeterministically.
- **Template drift breaks extraction silently-ish.** If the code moves from the subject to
  the body, or the markup wrapper changes, the regex stops matching. Check both subject and
  body, and treat an extraction miss as a real failure to investigate, not a retry-forever.
- **Leftover test-user state across runs.** The mail seam is clean, but the identities it
  exercises accrete database rows. Pair it with a cleanup step that clears the test users'
  records between runs, or later runs inherit earlier state.

## When not to use it

- **When you don't control the receiving domain's inbound routing.** The whole seam depends
  on being able to route your domain's inbound mail into a store you can read. Against a
  third-party address you can't configure, this doesn't apply.
- **Unit and integration layers.** For fast, isolated tests below the E2E line, mocking the
  mail send is the right call — you're testing your logic, not the delivery path. The seam is
  specifically for the end-to-end tier that must exercise the real out-of-band channel.
- **When the out-of-band channel isn't email.** SMS, authenticator apps, and push each need
  their own tap. The *shape* (route the real channel into a pollable store) may transfer, but
  the mechanics don't.

## As built (defcon.run 34)

- **The seam:** `apps/run.auth/e2e/lib/s3-email.ts` — `waitForVerificationEmail()` resolves
  the inbox bucket, polls the `inbox/defcon.run/` prefix for objects newer than the login
  start time, matches the recipient, and regexes a `\d{6}` code out of the subject
  (`Subject:\s*(\d{6})`) with a body fallback (`<strong>(\d{6})</strong>`).
- **Plus-addressed identities:** `apps/run.auth/e2e/README.md` — three test accounts
  (`jeanclaude+accounta@defcon.run`, `+accountb`, `+accountc`) sharing one real mailbox, plus
  the cleanup phase that clears test-user rows from the auth tables between runs.
- Realized on SES inbound → S3 for the mail tap, with the code submitted back through the
  real auth front door via Playwright.
