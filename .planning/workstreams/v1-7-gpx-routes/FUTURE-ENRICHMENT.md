# Future direction (Kurt 2026-07-02) — DC33 seeding + CMS route enrichment

## Near-term: seed last year's (DC33) runs as individually-toggleable public routes
- **Already supported by Phase 28** — every route in a GLOBAL folder renders as its own
  toggle (group master + per-route on/off). So "all of last year's runs, individually
  selectable" needs only *content*: the DC33 public-asset GPX files imported into a GLOBAL
  folder (e.g. "DEF CON 34 Maps" or a dedicated "DC33 Archive").
- **Work:** a bulk-import script (like `seed-global-folders.ts`, but uploads GPX files:
  S3 put + active GLOBAL `GpxFile` row per file, extract bounds/distance/etc.). Blocked on
  the **source of the DC33 GPX assets** (Kurt referenced "public asset GPX maps" from DC33 —
  need the files or a URL/bucket).

## Later: CMS-backed route details (pop-up enrichment) — NOT NOW
Kurt's design:
- Store per-route detail in the CMS (Strapi, run.cms): title, description/write-up, photos,
  landmarks, YouTube/media links — a **light JSON doc of URLs**, assets served via CloudFront.
- **Public read-only** CMS endpoints serving just the public route details (no auth).
- The studio popup (extend `PublicOverlays`) fetches `/route-details/{routeId}` on click and
  renders the write-up + media; heavy assets are CloudFronted URLs, CMS payload stays light.
- Shape: new Strapi content type `RouteDetail` keyed by the GLOBAL `fileId` (or a slug),
  public GET endpoint, CDN for images/video thumbs. Route → detail linked by `fileId`.
- Candidate as **v1.8** (or Phase 33+) once the overlay + Strava land. Keep the overlay's
  route metadata light; enrichment is an additive lookup, not a change to the manifest.
