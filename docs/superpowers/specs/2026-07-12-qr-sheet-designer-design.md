# QR Sheet Designer for /admin/qr — Design

**Date:** 2026-07-12
**Status:** Approved pending final spec review
**Owner:** run.human `/admin/qr`

## Summary

Port the defcon.run.33 "QRSheet" printable-sheet concept into defcon.run.34 as an
admin tool inside run.human's `/admin/qr` area, targeting the live q.defcon.run
redirect service. From anywhere in `/admin/qr`, an admin opens the **sheet
designer** for any URL (prefilled with `https://q.defcon.run/<CODE>` when
launched from a code), styles the QR (module shapes, eye styling, center logo,
DC34 color templates), picks a grid or Avery label layout, and downloads a
US-Letter PDF — generated entirely client-side.

Access is gated by a new **`qradmin`** group in addition to the existing
`admin`/`runadmin` groups, scoped to the `/admin/qr` area only.

## What dc33 had (functional baseline)

dc33's QRSheet was a stateless, quota-gated, user-facing generator:

- One URL repeated across every cell of a US-Letter PDF (612×792pt, 72 DPI).
- Layout presets: grids (default 7×9, plus 3×3 / 4×6 / 6×8, custom `AxB`) and
  8 Avery label templates (5160, 5163, 5164, 5167, 5261, 5262, 8160, 22816)
  with exact physical margins/spacing.
- Dotted grey fold lines between cells for custom grids (skipped for Avery).
- Optional **proof pages**: page 2 giant QR; pages 3–4 size-comparison (one QR
  per grid config, 2×2 → 8×8, 14 configs); page 5 progressive data-density
  test (URL grown character by character).
- Adaptive error correction: try H → Q → M → L until the URL fits; error if
  even L fails.
- Server-side generation: `qrcode` (PNG buffers) + `pdf-lib`, streamed as a
  download with a descriptive filename (`qr-<id>-avery-5160-2.625x1in.pdf`).
- Per-user quota (10 sheets), quick-generate link cards, Avery reference cards.

## Decisions (user-confirmed)

| Decision | Choice |
|---|---|
| Sheet content | **One code/URL per sheet**, repeated across cells (dc33 parity). No mixed-code sheets. |
| Output | **Client-side PDF** — styled QRs rendered in the browser, PDF composed with pdf-lib in the browser, downloaded. No new server surface. |
| Styling | Module shapes, eye/corner styling, center logo, DC34 color templates — all four. |
| dc33 extras | Keep proof pages (optional, default on). Drop quota, quick-link cards, standalone Avery reference cards, auto-download page. |
| Gating | `admin`, `runadmin`, **and new `qradmin`** for the whole `/admin/qr` area. |
| Styling engine | **`qr-code-styling`** npm library (approach A below). |

### Styling engine approaches considered

- **A. `qr-code-styling` (chosen)** — purpose-built browser library: dots /
  rounded / classy module shapes, corner-square + corner-dot styling, center
  image embedding. Renders offscreen; `getRawData("png")` returns a Blob that
  pdf-lib embeds directly. One client-only dependency; no server changes.
- **B. Hand-rolled SVG from `QRCode.create()` matrix** — zero new deps (run.bib
  already draws raw matrices) but re-implementing dot/rounded/eye geometry is
  hundreds of lines of fiddly, risky drawing code. Rejected.
- **C. Server-side PDF (dc33 port)** — styled rendering server-side needs
  node-canvas/jsdom in the container; loses live preview. Rejected.

## Architecture

All new code lives in `apps/run.human/webapp`. Client-side except the page gate.
No new API routes, no DB writes, no quota. The `Qr` entity is untouched.

```
src/app/(protected)/admin/qr/sheet/page.tsx   — server page: QR gate, renders designer
src/components/admin/QrSheetDesigner.tsx      — client designer UI (form + live preview)
src/components/admin/qr-sheet/
  ├── templates.ts   — AVERY_TEMPLATES (ported verbatim from dc33) + AxB grid parsing
  ├── styles.ts      — QRStyleOptions type + DC34 preset definitions
  ├── render.ts      — qr-code-styling wrapper: style options + URL + px size → PNG Blob
  └── pdf.ts         — pdf-lib composition: grid page, fold lines, proof pages, filename
```

New dependency: `qr-code-styling` (client-only). `pdf-lib` added to run.human
(browser usage; it is isomorphic). `qrcode` stays for existing uses.

### Unit boundaries

- `templates.ts` — pure data + parsing. In: template string (`"4x6"`,
  `"5160"`, `"avery-5160"`). Out: `SheetLayout` (cells across/down, cell
  width/height in inches, margins, spacing, `isAvery`). No DOM, no deps.
- `styles.ts` — pure data. `QRStyleOptions` (module shape, colors, eye shape +
  color, logo source, error-correction floor) + named DC34 presets.
- `render.ts` — takes `QRStyleOptions` + URL + pixel size, returns PNG Blob via
  qr-code-styling. Owns adaptive error correction (H→Q→M→L; floor Q when a
  logo is set) and the "URL too long" error. Browser-only.
- `pdf.ts` — takes `SheetLayout` + a render function + options
  (`includeProofPages`), returns PDF bytes. Ports dc33's layout math: page 1
  grid + dotted fold lines (custom grids only) + URL header; proof pages 2–5.
  Layout math (cell positions) is pure and unit-testable; drawing is thin.
- `QrSheetDesigner.tsx` — wires the above into a form with live preview;
  triggers a Blob download. No business logic beyond form state.

## Access control: the `qradmin` group

Current state: `lib/admin-gate.ts` exposes `ADMIN_GROUPS = ["admin",
"runadmin"]` for the sync JWT check, and `revalidateAdmin()` in
`config/auth.ts` **hardcodes** the same two groups for the live fail-closed
re-check against run.auth.

Change — parameterize by group list instead of widening the global list:

- `lib/admin-gate.ts`: add `QR_ADMIN_GROUPS = [...ADMIN_GROUPS, "qradmin"]`
  and group-parameterized helpers (`isMemberOf(session, groups)`,
  `requireGroups(session, groups)`); existing `isAdmin`/`requireAdmin` become
  thin wrappers over them, so `/admin` root behavior is byte-identical.
- `config/auth.ts`: add `revalidateGroups(userId, groups)` (same
  fetch-fresh-claims + lockedOut logic, group list passed in);
  `revalidateAdmin` becomes `revalidateGroups(userId, ADMIN_GROUPS)`.
- `app/(protected)/admin/qr/gate.ts`: `gateAdminPage()` switches to
  `QR_ADMIN_GROUPS` for both the sync and live checks.
- `app/api/admin/qr/route.ts`: same switch for its inlined checks.

Scope semantics:

- `qradmin` unlocks **all** of `/admin/qr` (list, code edit, ctf, sheet
  designer, `/api/admin/qr`) — QR-only operators need the code catalog, not
  just the printer.
- `qradmin` does **not** unlock `/admin` root or any other admin surface, and
  the `/admin` nav link (driven by `isAdmin`) stays hidden for qradmin-only
  users — they reach `/admin/qr` by direct URL/bookmark.
- Non-disclosure contract preserved: every denial → 404, never 401/403.
- The group itself is just data in run.auth's AuthProfile groups; assigning it
  happens through the existing run.auth admin console. No run.auth code change.

## Entry points ("any URL anywhere in /admin/qr")

- Designer route: `/admin/qr/sheet?url=<encoded URL>`. Accepts **any URL**,
  not only q.defcon.run codes. Missing/invalid param → empty URL field.
- `/admin/qr` list page: a "Sheet" action per code row linking to the designer
  prefilled with `https://q.defcon.run/<CODE>`.
- `/admin/qr/[code]` edit page: a "Print sheet" button, same prefill.
- The designer's URL field is editable, so arbitrary URLs can be typed in.

## Designer UI

Two-pane layout: controls left, live preview right (one styled QR rendered at
actual cell size plus a miniature page-layout thumbnail). Reuses the shared
Tailwind tokens in `components/admin/qr-ui.ts` for visual consistency with
QrForm.

Controls:

- **URL** text field (prefilled from `?url=`).
- **Layout** — dc33's six preset buttons (Default 7×9, Large 3×3, Medium 4×6,
  Small 6×8, Avery 5160, Avery 22816) + custom `AxB` input + a dropdown of all
  8 Avery templates with dimensions (this replaces dc33's reference cards).
- **Style**:
  - Module shape: square / dots / rounded / classy.
  - Eyes: corner-square shape (square / rounded / dot) + independent eye color.
  - Center logo: none / bundled DC34 marks (dcjack, meshtastic, dc34 —
    the marks that exist as usable repo art; no standalone skull asset
    exists and bunny-head.png has an opaque background) / file upload.
    Uploaded images stay client-side and are embedded straight into the PDF —
    never uploaded to a server. Enabling any logo forces error-correction to H
    and caps the logo at ~22% of QR width.
  - **DC34 template presets** (one click sets shape + colors + logo):
    - *Classic* — black squares on white, no logo.
    - *Run Hacker Run* — dark-teal `#12836f` modules, deep-magenta `#8f1857`
      eyes, DC34 mark logo.
    - *Mesh* — black modules, teal eyes, mesh logo.
    - *Stealth* — near-black modules, dcjack logo.
    Presets keep dark-on-light contrast so codes scan reliably; a contrast
    warning appears when manual color choices get risky (relative luminance of
    modules vs background below a safe threshold).
- **Include proof pages** checkbox (default on).
- **Download PDF** button.

## PDF output

Client-side with pdf-lib, porting dc33's layout math from its 679-line route:

- US-Letter 612×792pt. Page 1: the QR grid. Custom grids get dotted grey fold
  lines (0.5pt, `rgb(0.7,0.7,0.7)`, 3pt dash) between cells; Avery templates
  use exact margins/spacing/label sizes and skip fold lines. URL header line
  top-left (10pt grey).
- QR cells rendered at 90% of the box (padding), from `render.ts` PNG blobs at
  a pixel size matched to print resolution (target ≥300 DPI at cell size).
- **Proof pages** (when enabled), all rendered with the *chosen style* so
  proofs test real-world scannability: page 2 giant centered QR (70% of min
  page dimension); pages 3–4 size comparison (the 14 dc33 grid configs, each
  QR at that template's cell size, labeled `AxB`); page 5 progressive
  data-density test (URL grown character by character, labeled `Base`/`+N`,
  cell size footer).
- Filename convention kept: `qr-sheet-<slug>-<layout>-<WxH>in.pdf` where
  `<slug>` is the q.defcon.run code when the URL is one, else a sanitized
  hostname.

## Error handling

- URL too long even at error-correction L → inline form error; Download
  disabled. (With a logo, floor is Q; error message says to shorten the URL or
  remove the logo.)
- Logo image fails to load/decode → generate without the logo and show a
  warning; never block the download on a bad image.
- Contrast warning (non-blocking) for risky manual color combos.
- Invalid custom grid (`0x9`, `40x40`, garbage) → inline validation; axes
  bounded to 1–12 (dc33 had no explicit bound; 12 is the practical print
  limit before cells drop below reliable scan size).
- PDF generation failure → error state with retry; no partial downloads.

## Testing

- Unit tests (vitest, mirroring `lib/__tests__/qr-admin.test.ts` conventions):
  - `templates.ts`: template-string parsing (grids, Avery with/without prefix,
    invalid input), cell-position math for a grid and an Avery template
    checked against dc33's known-good coordinates.
  - `styles.ts`: preset definitions well-formed; contrast checker thresholds.
  - Gate changes: `requireGroups`/`QR_ADMIN_GROUPS` admit qradmin on QR
    surfaces and continue to deny it on `/admin` root helpers.
- `render.ts`/`pdf.ts` browser behavior verified by local dev run: visual
  check of preview + downloaded PDF, and a physical scan test of each DC34
  preset (phone camera) before ship.

## Explicitly out of scope / dropped from dc33

- Quota system (admin-only tool now).
- Quick-generate link cards and standalone Avery reference cards (dropdown
  covers the reference need).
- The auto-download-on-mount `[id]` page pattern.
- The `/qr/{id}` scan-claim flow (dc34's resolver + rules already own
  redirect behavior; the sheet just prints URLs).
- Mixed/catalog sheets (multiple codes on one sheet) — possible follow-up.
- Persisting sheet designs (stateless, like dc33).
- run.auth changes (`qradmin` is data, not code, on that side).
