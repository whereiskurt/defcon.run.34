# PLAN-CHECK — v1.5 Phase 22 Payments

**Verdict:** PASSED
**Level:** goal-backward (each SC traced to a task; no orphan tasks; no missing SC)
**Concerns:** 4 non-blocking notes

## Goal-backward check

| SC | Owning task(s) | Verifiable evidence |
|---|---|---|
| SC1 Slider + no fixed tiers | 22-01-02 | `next build` route present; `<input type=range>` grep hit |
| SC2 Stripe Checkout + `whsec_*` verify + amount_total mutation | 22-01-03 + 22-01-04 | Vitest signature-verify test; `applyPayment` atomic ADD verified |
| SC3 Venmo page + handle + BIB-XXXX | 22-02-01 | Route emits; grep for `BIB_VENMO_HANDLE` reads env not hardcode |
| SC4 CashApp page + handle + BIB-XXXX | 22-02-02 | Route emits; grep for `BIB_CASHAPP_HANDLE` |
| SC5 SES → S3 → Lambda → Haiku → BibReconcile | 22-03-01/02/03 + 22-04-01/02 | `terragrunt plan` clean; vitest 6/6 pass on extractor + matcher |
| SC6 Match by runnerCode + fallback | 22-04-02 | Vitest cases for primary + fallback + no-match |
| SC7 Unmatched → admin email | 22-04-03 | Vitest SES-mock case; SES:SendEmail IAM in 22-03-02 |
| SC8 `canPrintName()` helper | 22-04-03 | Vitest for helper (`nameLocked && paidAmount >= 1000`); Phase 23 uses it |

**No unmapped SCs. No orphan tasks (every task owns an SC or a gate).**

## Non-blocking notes

1. **Vitest scaffolding for Lambda code (22-04-01)** — Plan 21-03 landed vitest for webapp only. Lambda directory `apps/run.bib/lambda/reconcile/tests/` will need its own `vitest.config.ts` (small addition). Not called out in PLAN — folded into 22-04-01 task body.
2. **Stripe SDK 18.x pin** — verify at 22-01-01 execution that 18.x is still latest stable; if newer major exists, evaluate breaking changes before pinning. Same for `@anthropic-ai/sdk` (spec says `^0.24.x` — verify at 22-04-01).
3. **Anthropic API cost drift** — AI-SPEC's `100¢ per invocation` estimate assumes ~500-token input; long-form email bodies could push higher. 22-04-03 could compute actual cost from `usage.input_tokens + usage.output_tokens * 5` for exact tracking. Left as a follow-up because the $20 cap has ~20x headroom over realistic volume.
4. **Regional Lambda scope** — Plan uses `us-east-1` only (mirrors `bib.defcon.run/use1/`). If multi-region needed later, the Lambda module IS multi-region-ready but the terragrunt live unit targets `us-east-1` only.

## Parallelization notes

- Plans 22-01 and 22-02 CAN run in parallel — no file overlap.
- Plan 22-03 and 22-04 CAN partially parallelize if 22-03 module allows a lambda-zip stub at plan time (22-03-02 done → 22-04 runs on stub; 22-03-03 lands after 22-04 handler is real).
- Recommended sequential: 22-01 → 22-02 → 22-03 → 22-04 for reviewer sanity (one narrow PR per plan).

## Hardware / HITL policy — respected

- Live Stripe verify + real Venmo/CashApp receipt end-to-end stays as an HITL-analog for Kurt post-merge.
- Plan does NOT auto-move any of those to green — SUMMARY.md records them separately.

## Green light

Ready for execute-phase. First executor should start with Plan 22-01 once Kurt loads the two Stripe SSM values.
