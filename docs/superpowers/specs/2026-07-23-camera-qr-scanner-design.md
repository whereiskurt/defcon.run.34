# In-browser camera QR scanner — "Scan a runner" on whoami

Date: 2026-07-23 · Status: APPROVED (Kurt — "build it fully autonomously") ·
Branch: `feat/camera-qr-scanner`
Depends on: runner social QR feature (LIVE, #926-#929; spec
`2026-07-22-runner-social-qr-design.md`).

## Goal

A **camera button in the expanded "Your Social QR" section on whoami** that
opens an in-browser camera viewfinder, decodes another runner's QR, closes the
camera, and (via a tap-through) opens the award page (`/r?p=…`) in a **new
tab** where the mutual-scan award fires. No app install, no OS camera round
trip.

## Research (done 2026-07-23)

DC33/DC32 have **NO camera scanner to port** — verified by exhaustive sweep of
`~/working/defcon.run.33` (zero hits for getUserMedia / BarcodeDetector /
jsQR / zxing / html5-qrcode / facingMode; only generation-side `qrcode` lib).
Their QR game relied on the phone's native camera app opening `/qr/[uniqueId]`
URLs. Greenfield build.

## Design

### Decode engine (progressive)
- **`BarcodeDetector`** (`formats: ["qr_code"]`) when `"BarcodeDetector" in
  window` — native, fast (Chrome/Android, Edge).
- **jsQR fallback** everywhere else — **this is the primary real-world path**
  (iPhone Safari has no BarcodeDetector and dominates con traffic). Add
  dependency `jsqr` (^1.4.0, ~10KB, zero deps) to run.human webapp. Canvas
  loop: draw current video frame to an offscreen canvas
  (`getContext("2d", { willReadFrequently: true })`), `jsQR(imageData…)` at
  ~8-10 fps via rAF-throttle. Downscale frames to max 640px on the long edge
  before decode (CPU).

### Camera lifecycle
- `navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal:
  "environment" } }, audio: false })`.
- Stop ALL tracks on: successful decode, modal close, component unmount, page
  hide. Never leave the camera light on.
- Permission denied / no camera / insecure context → friendly card in the
  modal ("Camera unavailable — use your phone's camera app on the QR
  instead"), never a crash. HTTPS required (prod is; dev localhost is exempt).

### URL validation (`parseRunnerQr.ts`, pure + unit-tested)
Accept ONLY runner-QR shapes; return a **local, same-origin** award path
(skip the q. resolver hop entirely):
- `https://q.<domain>/r/<16-hex>` → `{ kind:"token", value }`
- `https://run.<domain>/<region>/r?p=<16-hex>` (any region segment) → token
- `https://run.<domain>/<region>/r?h=<64-hex>` (legacy stored eqr) →
  `{ kind:"hash", value }`
- Anything else → null ⇒ UI shows "Not a runner QR — keep it in frame" and
  keeps scanning (decode loop continues; 1.5s debounce on repeated misses so
  the message doesn't flicker).
Award URL built as `${prefix}/r?p=<token>` / `?h=<hash>` where prefix is the
standard `isDev ? "" : "/{region}"`.

### UX flow (popup-blocker-safe new tab)
1. Whoami → expanded Social QR → new **"Scan a runner"** `Button`
   (`Camera` lucide icon) beside "Save QR card".
2. HeroUI `Modal`: full-width video viewfinder, magenta corner-bracket scan
   region overlay (reuses the flair visual vocabulary), "Cancel".
3. On decode: camera stops + tracks released immediately; modal flips to
   success state: "🐰 Runner found!" + **"Claim connection"** button.
4. Tap "Claim connection" → `window.open(awardUrl, "_blank",
   "noopener")` — inside the tap gesture, so popup blockers allow it — and
   the modal closes. (`window.open` from the async decode callback would be
   blocked; the tap-through is deliberate.) "Scan another" secondary button
   reopens the camera.
5. The new tab is the existing `/r` page: award fires there (all dedup/cap/
   self-scan handling already server-side). Zero new award logic.

### Files
- Add dep: `apps/run.human/webapp/package.json` → `"jsqr": "^1.4.0"`.
- Create `src/components/qr/parseRunnerQr.ts` + `parseRunnerQr.test.ts`
  (accept/reject table incl. wrong domain, wrong length, uppercase hex,
  extra params, the rickroll bare `/r`).
- Create `src/components/qr/QrScannerModal.tsx` ('use client'):
  props `{ isOpen, onClose }`; owns camera + decode loop + states
  (`requesting` / `scanning` / `found` / `denied` / `unsupported`).
- Modify `(protected)/whoami/page.tsx`: button + modal mount in the Social QR
  section (copy keys `socialqr.scan.*` via copyOr).

### Testing / gates
- vitest: parseRunnerQr table; decode-loop helper pure parts if extracted.
- tsc / lint / `next build` clean; full suite green.
- Manual UAT (Kurt): iPhone Safari camera permission + decode + new-tab
  award; Android Chrome (BarcodeDetector path).

### Rollout
Standard: PR → admin-merge → buildpub run.human use1 → Release PR →
`deploy.yml` CI → verify live. No infra, no data ops, run.bib untouched.

## Out of scope (v1)
Torch/flash toggle, zoom, image-file upload fallback, scan-from-screenshot,
scanning on the /r page itself, PWA install prompts.
