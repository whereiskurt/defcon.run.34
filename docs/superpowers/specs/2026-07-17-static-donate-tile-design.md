# Static landing "Donate" tile → login → donate panel

**Date:** 2026-07-17
**Author:** Kurt + Claude
**Status:** Approved

## Goal

Add a 5th tile ("Donate") to the static `defcon.run` landing page (`apps/static/landing`).
Clicking it sends the visitor through the run.human login flow and lands them on a page
with the donate panel already open, so a signed-in donation is one click from the apex page.

## Flow

```
[static defcon.run "Donate" card]
  → https://run.defcon.run/use1/api/auth/auto-signin?callbackUrl=%2Fuse1%2Fwhoami%3Fopen%3Ddonate
  → OIDC login flow (silent if the .defcon.run SSO cookie is already set; full login otherwise)
  → redirects to /use1/whoami?open=donate
  → run.human header sees ?open=donate + a live session → opens the existing DonateModal
```

`/api/auth/auto-signin` (`apps/run.human/webapp/src/app/api/auth/auto-signin/route.ts`) already
forces `signIn("run.defcon.run", { redirectTo: callbackUrl })` and honors an arbitrary same-origin
`callbackUrl` with its query string preserved. This is the same route silent-SSO uses, so it is a
proven entry point and sidesteps the `(public)` layout's silent-SSO hard-coded callback (which would
otherwise drop `?open=donate`).

The `DonateModal` opened is the **same one** the header's existing "Donate $" button uses
(`apps/run.human/webapp/src/components/header/header.tsx`), which posts cross-origin to bib's
`/api/checkout/general` with the SSO cookie. Donation mechanics are unchanged — this only adds an
entry point, and the resulting donation attributes to the logged-in user (see the donor-identity
work in `project_bib_donation_donor_identity`).

## Changes

### 1. run.human — `src/components/header/header.tsx` (one file)
Add a `useSearchParams()` effect that opens the DonateModal when `?open=donate` is present AND a
session exists:

```ts
const searchParams = useSearchParams();
useEffect(() => {
  if (hasSession && searchParams?.get('open') === 'donate') setDonateOpen(true);
}, [hasSession, searchParams]);
```

The `hasSession` gate ensures the panel only opens post-login (never flashes on a pre-login page).
Mirrors the existing `?open=checkin|qr` convention in `dropdown-user.tsx`. Requires a run.human app deploy.

### 2. static landing — `apps/static/landing`
- `content.json`: append a 5th `cards[]` entry:
  ```json
  {
    "id": "donate",
    "emoji": "💵",
    "kicker": "05 / GIVE",
    "title": "Chip In",
    "blurb": "Love the run? THANK YOU! Every dollar is helpful to keep DEF CON run fun and free.",
    "cta": "Donate",
    "url": "https://run.defcon.run/use1/api/auth/auto-signin?callbackUrl=%2Fuse1%2Fwhoami%3Fopen%3Ddonate",
    "image": "https://defcon.run/landing-donate.svg",
    "fit": "emblem"
  }
  ```
- `assets/landing-donate.svg`: new emblem art (money/heart motif, matching the mesh/faq emblem style).
- Rebuild: `node build.mjs` regenerates `index.html`.
- Deploy: static pipeline — `AWS_PROFILE=sudo-management`, sync bucket `defcon-run-static-20240523-v1`
  (incl. the new `landing-donate.svg`) + invalidate CloudFront `ETHVMDHQC21EG`.

## Notes / risks
- **Two deploys:** run.human app (header change, buildpub + deploy.yml) AND the static site (separate
  pipeline, `sudo-management` profile). Ordering: ship run.human first so `?open=donate` works before
  the static tile goes live.
- `callbackUrl` hard-codes `/use1/` (prod region), consistent with silent-SSO's callback construction
  and the use1-only run ecosystem.
- **basePath gotcha:** the run.human app is served under the `/use1` basePath in prod, so the
  auto-signin path itself must be `/use1/api/auth/auto-signin` — the naked `/api/auth/auto-signin`
  404s. (Silent-SSO gets away with the naked path only because Next's `redirect()` auto-prepends the
  basePath; a raw static href has no such help.) Verified live: the `/use1`-prefixed path 307s into
  the OIDC flow.
- Cards open in a new tab (`target="_blank"`), consistent with the four existing cards.

## Out of scope
- Cross-app donate on bib.defcon.run (the user chose the run.defcon.run panel).
- Any change to donation/checkout mechanics.
