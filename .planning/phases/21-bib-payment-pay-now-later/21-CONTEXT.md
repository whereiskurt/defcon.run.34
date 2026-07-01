# Phase 21: Bib Payments (Cash + Stripe + PayPal/Venmo, crypto-ready) - Context

**Gathered:** 2026-06-30
**Status:** Ready for planning (plan in detail when Phase 20 completes)

<domain>
## Phase Boundary

Add the payment/donation layer to bib registration. A participant chooses a **give amount** ($10 / $20 / $50 / $500) and a **payment method**, supporting THREE methods **at launch**: **cash on-site**, **Stripe** (cards + Apple/Google Pay), and **PayPal/Venmo**. All online methods go through one provider-agnostic `PaymentProvider` seam; cash persists a `pay_on_site` registration collected at the event. The registration's payment state is authoritative and updated by a provider-generic webhook when an online payment completes. **Crypto (BTC/ETH)** is designed into the seam but **deferred** (not implemented this milestone).

Claude scaffolds the working Stripe AND PayPal/Venmo integrations against the seam. The other developer owns only the real **Stripe account + go-live keys** (development uses test/sandbox credentials).

</domain>

<decisions>
## Implementation Decisions

### Payment model (per product)
- **Give tiers:** preset amounts $10, $20, $50, $500 (USD). These are donation/contribution tiers, not a fixed bib fee.
- **Payment methods at launch (all three):**
  1. **Cash on-site:** registration saved as `pay_on_site` with the chosen amount recorded as intended/owed; collected in person at DEF CON; no online charge
  2. **Stripe:** pick a tier → Stripe Checkout → `paid` on webhook confirmation (cards + Apple/Google Pay)
  3. **PayPal/Venmo:** pick a tier → PayPal Orders approval/capture → `paid` on webhook confirmation (Venmo appears as a PayPal funding source for eligible US buyers)
- **Crypto (BTC/ETH):** seam-ready but **deferred** — the method chooser hides it until a provider ships (rail TBD: Coinbase Commerce vs BTCPay).
- Amount + currency + chosen `paymentProvider` are recorded on the registration regardless of method.

### Provider-agnostic payment seam (multiple providers at launch)
Support **cash + Stripe + PayPal/Venmo at launch**, with crypto (BTC/ETH) pluggable later. Do NOT hardcode a provider; one abstraction so adding a provider is a new file, not a refactor.

- Define a `PaymentProvider` interface in `lib/payments/`:
  ```ts
  interface PaymentProvider {
    id: "stripe" | "paypal" | "coinbase" | ...;
    createCheckout(reg: BibRegistration, amount: Money): Promise<{ redirectUrl: string }>;
    verifyWebhook(req): Promise<PaymentEvent>;   // signature verify → normalized event
  }
  ```
- A small `lib/payments/index.ts` registry maps provider id → implementation and exposes the **enabled** set (feature-flagged) that drives the checkout method chooser. The webhook **route** (`/api/payments/[provider]/webhook`) and the **state machine** (`paid` transition, idempotency) are OURS and provider-independent; each provider only normalizes its events into `PaymentEvent`.
- **Providers implemented this milestone (by Claude, against the seam):**
  - `lib/payments/stripe.ts` — Checkout Session create + `verifyWebhook` via `STRIPE_WEBHOOK_SECRET`. Works in **test mode**; the other dev owns the real account/keys + go-live only.
  - `lib/payments/paypal.ts` — PayPal **Orders API** create/capture + webhook verify/normalize; Venmo rides on this as a funding source. Works in **sandbox**.
  - `lib/payments/fake.ts` — deterministic no-external-dependency provider for CI/dev.
- **Deferred provider:** `lib/payments/coinbase.ts` (or `btcpay.ts`) for crypto — NOT written this milestone; the interface + DB `paymentProvider` field + generic webhook route already accommodate it.
- Env/secret contract: Stripe (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) and **PayPal (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`)** SSM slots are created in Phase 19; each future provider adds its own keys under `/{site}/secrets/{region}/bib/<provider>_*` (one-line infra add, no schema change). Browser-needed client ids are `NEXT_PUBLIC_*`.
- Stripe **account/keys** remain an external dependency (`<task type="handoff">` for go-live); everything else — registry, state machine, cash, UI, Stripe code (test mode), PayPal code (sandbox), fake — is built here and independently shippable.

### Testing payments (how to verify before real money)
- **Stripe test mode:** use `sk_test_…` / `pk_test_…` keys (in the Phase-19 SSM placeholders for a staging deploy, or `.env.local` for dev). No real charges.
- **Test cards:** `4242 4242 4242 4242` (success), `4000 0000 0000 9995` (decline), `4000 0025 0000 3155` (requires 3DS) — any future expiry, any CVC/ZIP.
- **Webhook forwarding locally:** install the Stripe CLI (not in this container), then `stripe login` and `stripe listen --forward-to localhost:3001/{region}/api/payments/stripe/webhook`. The CLI prints a `whsec_…` signing secret — use it as `STRIPE_WEBHOOK_SECRET` locally. Replay/trigger events with `stripe trigger checkout.session.completed`.
- **PayPal sandbox:** create a PayPal developer app for sandbox client id/secret; use sandbox buyer test accounts to approve/capture an Order; configure a sandbox webhook (`PAYPAL_WEBHOOK_ID`) and verify signature. Venmo is testable where PayPal enables it in sandbox; otherwise verify the PayPal path (Venmo is the same provider code).
- **End-to-end test path (each provider):** select a give tier → choose method → provider approval (test card / sandbox buyer) → redirect back → webhook flips registration to `paid` → confirmation page reflects it. Assert idempotency by re-triggering the same event.
- **Cash path** needs no provider — testable immediately (select cash → `pay_on_site` persisted with amount).
- A normalized **fake provider** (`lib/payments/fake.ts`, used in CI/dev when no real provider is configured) exercises the full registration→pay→confirm flow with no external dependency.

### Go-live / add-provider = minimal, localized
The provider abstraction keeps both go-live and future providers to a tiny change:
  - **Stripe go-live (other dev's step):** populate the real `stripe_secret_key` / `stripe_webhook_secret` SSM values + flip `PAYMENTS_STRIPE_ENABLED` on. The code (built here) doesn't change.
  - **PayPal go-live:** swap sandbox → live PayPal creds in SSM + flip `PAYMENTS_PAYPAL_ENABLED`.
  - **Add crypto later:** one new `lib/payments/<provider>.ts` + its SSM keys + enable flag. No schema or UI change.
Per-provider enable flags feed the registry's enabled set, which drives the method chooser — a disabled provider simply doesn't appear. Cash always works.

### Payment state machine (ours, authoritative, provider-independent)
- States: `unpaid` (initial, pre-choice) → `pending_payment` (any online provider checkout started) | `pay_on_site` (cash chosen) → `paid` (webhook confirmed)
- `paid` transition is idempotent (replayed/duplicate webhook from any provider does not double-apply); status on the confirmation page is read from the persisted registration, never inferred from the client redirect
- The registration records which `paymentProvider` was used

### UI
- Confirmation step after registration: give-amount selector (10/20/50/500) + **payment-method chooser** listing only enabled providers (cash / Stripe / PayPal-Venmo; crypto hidden until shipped)
- Confirmation page reflects current status: paid / pending / pay-on-site (with amount + provider) and a "Pay now" button where applicable

</decisions>

<specifics>
## Specific Ideas
- Keep give tiers config-driven (`amounts.ts`) so product can adjust without code surgery
- Keep the enabled-provider set config/flag-driven so ops can turn a method on/off without a deploy of new code
- Cash path needs an organizer-facing way to mark a `pay_on_site` registration `paid` once collected — minimal internal/admin flag; confirm scope with product (may defer)
- Suggested plan split: 21-01 seam+registry+fake+webhook route+state machine+UI+cash; 21-02 Stripe provider; 21-03 PayPal/Venmo provider — so each provider is an isolated, independently testable unit

</specifics>

<code_context>
## Existing Code Insights
- Bib entity + API routes land in Phase 20 — payment fields (`paymentStatus`, `amount`, `currency`, `paymentProvider`) defined on the entity there
- Stripe + PayPal secrets wired into service.hcl + SSM in Phase 19 (no infra change needed here)
- Auth: protect payment routes with the run.gpx `auth` export + `bib` claim (Phase 20)

</code_context>

<deferred>
## Deferred Ideas
- Crypto (BTC/ETH) provider → seam-ready; rail decision (Coinbase Commerce vs BTCPay) + implementation deferred to a later milestone (tracked as PAY-01)
- Stripe real account/keys + production go-live → another dev's step (code is built here, test mode)
- Organizer reconciliation dashboard for cash collection → confirm with product; likely a later phase
- Refunds / partial payments → out of scope for v1.5

</deferred>

---
*Phase: 21-bib-payment-pay-now-later*
*Context gathered: 2026-06-30*
