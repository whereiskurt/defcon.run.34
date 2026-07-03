# run.bib

Bib registration app for defcon.run 34 (`bib.defcon.run`) — Next.js 16 + Auth.js
(OIDC) + ElectroDB/DynamoDB + Stripe. The Next.js app lives in
[`webapp/`](webapp); `lambda/`, `nginx/`, and `redirects/` are deploy assets.

## Local development

The app is auth-walled end-to-end (middleware gates every route; `/orderform`
reads the bib from DynamoDB server-side). There are two ways to run it locally.

### Fast UI loop — no auth, no database (recommended for styling)

```bash
cd apps/run.bib/webapp
npm install          # first time only
npm run dev:ui       # → http://localhost:3006/orderform
```

`dev:ui` sets `DEV_AUTH_BYPASS=1`, which renders the whole app against a
synthetic session + bib (see [`src/lib/dev-auth.ts`](webapp/src/lib/dev-auth.ts)).
No `run.auth`, no DynamoDB, no `.env.local` required. Live-save (`PATCH
/api/bib`) is stubbed to a no-op 200 so `BibForm` behaves. Or use the VS Code
task **"App: run.bib UI-only bypass (:3006)"**.

The bypass is **double-gated** — it only activates when `NODE_ENV !==
"production"` **and** `DEV_AUTH_BYPASS=1`, so a production build can never
honor it regardless of env.

### Full stack — real auth + database

```bash
cd apps/run.bib/webapp
npm run dev          # → http://localhost:3006
```

Requires, additionally:

1. **run.auth** running on `:3002` (its VS Code task or docker-compose service).
2. **Local DynamoDB** — the `Local: DynamoDB` task (`apps/local/dynamodb`, port
   8888) creates the `run-human-electro` / `run-human-authjs` tables this app
   defaults to.
3. **`webapp/.env.local`** with matching `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`,
   `AUTH_JWT_SECRET`, `AUTH_INTERNAL_SECRET`, and
   `RUN_DYNAMODB_ENDPOINT` / `RUN_ELECTRO_ENDPOINT=http://localhost:8888` (plus
   dummy access keys). See `.env.example`. Stripe vars are only needed to
   exercise checkout, not to render.

## Ports

`3006` (chosen to avoid the `run.flash` `3004` collision). Siblings: run.human
`3001`, run.auth `3002`, run.gpx `3003`, run.flash `3004`, run.mqtt `3005`.

## Tests

```bash
npm test             # vitest — 11 suites (bib preview, stripe webhook, admin gate, …)
```
