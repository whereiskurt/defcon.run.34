# QR front-door service

**A single short-link service that resolves every link at the cheapest layer that can
do the job — a CDN edge redirect, a thin stateless resolver, or the authenticated app —
never writing to the database on the hot path, and never leaking a secret through a
link preview.**

## Context

You print QR codes and hand out short URLs: on badges, on signage, on flyers, on stickers.
Some point at fixed destinations. Some need to change *after* they're printed. Some
resolve differently depending on when they're scanned, or who scanned them, or a
parameter in the code. And a few are meant to be *shared* — pasted into a group chat —
where the first thing that happens isn't a human clicking but a bot fetching a preview.

The naive version — encode the destination directly in the QR, or point every link at
your main app — falls apart the moment you need to re-point a printed code, or the moment
a scan spike lands on your application servers, or the moment a shared secret link shows
its secret in a Slack preview.

## Forces

- **Print is immutable; destinations aren't.** Once a QR is on a sticker, the bytes it
  encodes are fixed forever. Anything that might change must live behind a layer of
  indirection.
- **Scans are spiky and cheap.** A popular code can be scanned thousands of times in
  minutes. Each individual scan is worth almost nothing analytically. Landing that traffic
  on your app — or writing a database row per scan — is paying application prices for
  edge-shaped work.
- **Some links carry trust; most don't.** A plain "go here" redirect needs no identity. A
  link that awards something, validates a secret, or mutates a user record needs
  authentication and anti-abuse. These must not share a trust boundary.
- **Shared links get previewed before they get clicked.** Chat apps fetch the URL with a
  crawler to render a card. If the URL carries a secret, that secret is now in the
  crawler's hands (and its logs) before any human acts.

## The pattern

Sort links into three tiers by how much trust and mutability they need, and handle each
at the cheapest layer that suffices.

```
                         scan / click
                              │
        ┌─────────────────────┼──────────────────────────┐
        ▼                     ▼                           ▼
  1. EDGE REDIRECT      2. THIN RESOLVER           3. AUTHENTICATED APP
  (no compute)          (stateless function)       (the only place trust lives)

  fixed vanity link     re-pointable code:         validates secrets,
  → 30x at the CDN,     data lookup → ordered       mutates user records,
  origin never          rules → 30x redirect;       enforces rate limits.
  contacted             one log line, no per-        the resolver only
                        scan DB write               HANDS OFF to it.
```

**1 — Static vanity redirects at the edge.** A link whose destination is fixed is a
redirect rule evaluated at the CDN edge. No compute, no origin request, no database. This
is the cheapest possible link and should be the default for anything that doesn't need to
change.

**2 — Re-pointable dynamic codes through a thin stateless resolver.** The printed QR
encodes a short *code*, never a destination. The resolver looks the code up in data,
evaluates an **ordered, first-match rule list**, and issues a redirect:

- rules are tried in order (e.g. time-window rules, then parameter-match rules), falling
  back to a default destination;
- the resolver is **stateless** — it reads, decides, redirects, and logs; it never writes
  user data and never validates a secret;
- redirects for mutable codes are always **temporary** (302), never permanent (301) — a
  301 can be cached by browsers forever, which defeats the entire point of re-pointability.

Because the destination lives in data, you re-point a printed code by editing a row. The
sticker never changes.

**3 — Anything that touches trust hands off to the authenticated app.** The resolver is
anonymous edge code; it must never be the thing that decides whether a secret is correct
or writes to a user's record. For those links, the resolver's only job is to construct a
handoff URL to the authenticated application, which is the **sole judge**: it requires a
session, validates, rate-limits, applies effects idempotently. (This year's instance was a
CTF flag capture — the edge routes the submission, the app judges it — but the split
generalizes to any "public link, privileged action" flow.)

**Analytics live off the hot path.** The resolver writes *nothing* to the database per
scan. It emits one structured log line per scan. A separate scheduled job aggregates those
log lines into counters on an interval, with a header-guarded on-demand flush for when you
need fresh numbers now. High-volume, low-value-per-event traffic never touches your
transactional store.

**Shared secret links get a secret-safe, crawler-only preview.** When a link that carries
a secret is designed to be shared, opt that code into an "unfurl": if the request comes
from a recognized link-preview crawler, serve a static Open Graph card instead of the
redirect. The card:

- uses **generic, celebratory copy and a static image** — it never echoes the code or
  secret;
- forwards (via meta-refresh / client redirect) to the destination **base URL with the
  secret query stripped**, so even the preview's "click here" can't leak it;
- is served **only to crawlers** — a real human still gets the instant redirect and never
  sees the card;
- **fails to a 404, never a 5xx**, and never throws — a missing asset degrades gracefully;
- **HTML-escapes every interpolated value**, since even operator-controlled data reaches
  an HTML/JS context.

A false crawler-detection negative just means "no card" (graceful); a false positive just
means a human gets the same secret-stripped forward. Both failure modes are safe by design.

## Key moves

- **Indirection is the product.** The code is not the destination. Everything the service
  buys you — re-pointing, rules, analytics, previews — flows from that one layer of
  indirection between the printed bytes and the destination data.
- **Cheapest sufficient layer.** Don't land edge-shaped traffic in your app. Static →
  edge; dynamic → thin stateless resolver; trusted → app. Each tier only does what the
  cheaper tier can't.
- **Region-aware, not region-replicated.** One resolver in one region, reading global
  data, can rewrite its destination to a region-scoped path based on a cookie — you get
  per-region destinations without standing up the resolver stack in every region.
- **The edge routes; the core decides trust.** Keep validation and mutation behind
  authentication. The anonymous layer's job ends at "hand this to the judge."
- **Secrets in a scanned URL are semi-public — design for it.** Anything in a URL path is
  captured by edge access logs regardless of what your code does. Treat secret-bearing
  links as **spent-on-use**: single-use per identity, rate-limited, granting an effect
  rather than revealing a durable secret. If a value must truly stay secret, a scanned GET
  URL is the wrong channel.

## Traps

- **A public hostname may not be reachable direct-to-origin.** If your origin's security
  group only accepts traffic from the CDN, then "point DNS straight at the load balancer"
  silently times out. Every public hostname — including the resolver's — must front
  through the CDN. This one cost real debugging time; check your origin's ingress before
  assuming a direct path works.
- **301 vs 302.** A permanent redirect on a mutable code will be cached by browsers and
  can't be re-pointed. Use temporary redirects for anything that lives in data.
- **Reserved namespaces.** If some path prefixes have special meaning (a handoff namespace,
  an admin flush endpoint), those names must be reserved — a user-created code must not be
  allowed to shadow them.
- **The unfurl must never widen the leak it's preventing.** The card exists *because* the
  link is shared into crawler-heavy channels. If the card echoes the secret, or forwards to
  the secret-bearing URL, it has made the exposure worse, not better. Strip the secret from
  everything the crawler can see or fetch.

## When not to use it

- If every link is fixed and will never be re-pointed, you only need tier 1 (edge
  redirects). The resolver is overhead.
- If you have no shared secret links, skip the unfurl entirely.
- If scan volume is genuinely low and you want live counts with no rollup lag, a per-scan
  write may be simpler than the log-line + scheduled-rollup machinery — the off-hot-path
  design pays off at spiky, high volume, not at a trickle.

## As built (defcon.run 34)

- **Design spec:** `docs/superpowers/specs/2026-07-11-qr-service-design.md` (the full
  architecture), extended by `2026-07-18-dynamic-scheduled-qr-design.md` and
  `2026-07-18-ctf-share-unfurl-cherries-design.md`.
- **Resolver:** `apps/run.qr/lambda/resolver/lib/` — `parse-path.mjs`, `resolve.mjs`,
  `rules.mjs`, `unfurl.mjs`, `respond.mjs`.
- **Analytics rollup:** `apps/run.qr/lambda/rollup/`.
- **Infrastructure:** `infra/terraform/modules/qr-resolver/` (resolver + wiring) and
  `infra/terraform/modules/cloudfront-redirect/` (edge redirects).
- **Admin CRUD:** `apps/run.human/webapp/src/entities/qr.ts`,
  `.../src/lib/qr-admin.ts`, `.../src/components/admin/QrForm.tsx`.
- Realized on CDN edge functions + a function-as-a-service resolver behind a load balancer
  + a global key-value store + the main Next.js app as the judge.
