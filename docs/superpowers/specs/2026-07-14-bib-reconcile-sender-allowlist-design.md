# bib-reconcile sender allowlist — design

**Date:** 2026-07-14
**Status:** approved (design decisions confirmed by owner)
**Branch:** `gsd/bib-reconcile-sender-allowlist`

## Problem

The bib-payment inbound receiver (`apps/run.bib/lambda/reconcile/`, module
`infra/terraform/modules/bib-reconcile-lambda`) is live: an email to
`bibpayment@run.defcon.run` is stored by SES to S3 under `bib-payments/`, an
S3 event triggers the reconcile Lambda, Haiku extracts payment fields, and the
matched bib's paid amount is updated.

The intended design assumed a **trusted-forwarder model** — only an admin
(Kurt / Jesse / the shared `defcon.run@gmail.com`) forwards a receipt into the
inbox. But **no sender authorization was ever built**. The receiver processes
*any* email delivered to that address. The only guards are the runnerCode
match, the fuzzy-name check, and the $20/day Haiku budget cap — none of which
authenticate the forwarder. Anyone able to send mail to
`bibpayment@run.defcon.run` can attempt to drive a bib to "paid".

## Goal

Enforce a sender allowlist so only forwards from an approved set of addresses
are processed. Allowlist values must **not** live in source code.

Initial allowlist: `defcon.run@gmail.com`, `whereiskurt@gmail.com`,
`jesse.krembs@gmail.com`.

## Design

### Gate placement
In `processS3Record` (`index.mjs`), immediately after `parseReceiptEmail` and
**before** the budget check + Haiku call — so unauthorized mail never spends
API budget, never writes a DB row, never touches a bib.

The gate compares the parsed `From` address (`parsed.from.address`) against the
allowlist. In the trusted-forwarder model this `From` is the admin who
forwarded the receipt (the original provider, e.g. Venmo, is in the body and is
what Haiku extracts — that is *not* what we authorize on).

### Matching semantics (`lib/allowlist.mjs`)
`isSenderAllowed(fromAddress, rawAllowlist) -> boolean`
- Parse `rawAllowlist` (comma-separated) → trim, lowercase, drop empties → Set.
- **Fail-closed:** empty/whitespace/undefined allowlist ⇒ return `false` (reject
  everything). A lost or unset config removes access, never silently disables
  the control.
- Normalize `fromAddress` (trim, lowercase); null/empty ⇒ `false`.
- Return `set.has(normalized)`. Exact address match, case-insensitive.

### Rejection behavior — log-only, silent
On a non-allowlisted sender, `processS3Record` returns a diagnostic outcome
`{ rejected: true, rejectReason: "unauthorized_sender", ... }` and does no
further work. The handler emits **one structured log line**
(`msg: "bib-reconcile rejected", reason: "unauthorized_sender"`, **not**
`error: true` — a rejection is expected, not an alarm), then continues. No
admin email, no `BibReconcile` DB row. Rejections are auditable via CloudWatch
Logs only.

### Config — kept out of source
- New module variable `allowed_senders` (string, comma-separated, default `""`).
- New Lambda env var `BIB_ALLOWED_SENDERS = var.allowed_senders` in
  `bib-reconcile-lambda/v1.0.0/main.tf`.
- Live unit `region/us-east-1/bib-reconcile/terragrunt.hcl` sets
  `allowed_senders = get_env("TF_VAR_BIB_ALLOWED_SENDERS", "")`.
- Repo variable `TF_VAR_BIB_ALLOWED_SENDERS` holds the real list; injected into
  `terragrunt-apply.yml` (baked into the Lambda env at apply) and
  `terragrunt-plan.yml` (truthful plans). Same pattern as
  `TF_VAR_FWD_EMAIL_TO_ADDRESS`. Source ships only the env-var *name*.

### Handler robustness
Make the handler's success `console.log` null-safe on `outcome.extracted`
(`?.provider` etc.). This supports the rejected path and also fixes a latent
issue: the existing budget-exhausted path already returns `extracted: null`,
which the unconditional `outcome.extracted.provider` access would throw on and
mislog as a failed record.

## Tests (vitest, `ctx` injection)
- allowed sender → proceeds (reaches extractor; not rejected)
- disallowed sender → `rejected: true`, extractor/budget never called
- empty allowlist → fail-closed reject
- case-insensitive match
- unit tests for `isSenderAllowed` (parse/normalize/empty/edge cases)

## Out of scope
- Verifying the *original* provider/sender inside the body (Haiku already
  extracts a display name for fuzzy matching; not a security control).
- SPF/DKIM verification of the forward.
- Any change to matcher, budget, or reconcile logic.
