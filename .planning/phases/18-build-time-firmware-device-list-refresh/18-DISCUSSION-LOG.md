# Phase 18 Discussion Log

**Date:** 2026-07-01
**Phase:** 18 — Build-Time Firmware & Device List Refresh
**Milestone:** v1.4 Flash Service Refresh
**Mode:** Headless autonomous (no human present) — decisions made by Claude within phase scope and locked ROADMAP.md / REQUIREMENTS.md constraints.

For the authoritative distilled context, see `18-CONTEXT.md`. This log records the reasoning trail behind each decision so a future reviewer can audit the choices.

---

## Areas discussed

Five gray areas were surfaced from the ROADMAP.md success criteria and the current code state. All five were addressed autonomously — there is no user selection step in headless mode.

### Area 1 — Firmware artifact: factory vs app-only

**Options considered:**
- A) Switch to `firmware-{target}-{version}.factory.bin` at `0x00` (single-blob with bootloader + partition table + app).
- B) Keep app-only `.bin` at `0x00` (current behavior, flagged as risky by STATE.md).
- C) Multi-artifact flash (bootloader + partitions + app at separate offsets).

**Chosen: A.**

**Reasoning:** STATE.md explicitly lists FLSH-08 as an open risk — current app-only-at-`0x00` may not boot. Factory image is the flasher.meshtastic.org standard. Option C multiplies complexity and drift risk with upstream Meshtastic packaging. The flash pipeline already writes at `0x0` (see `use-flash.ts:98`), so the switch is a rename + zip-extraction change, not a pipeline change. Verification of "boots and connects" is a hard gate before this phase can be called done.

### Area 2 — Version resolution strategy

**Options considered:**
- A) API mandatory; build-arg override; **fail hard if API unreachable and no override**.
- B) API mandatory with hardcoded fallback to a "last known good" constant.
- C) Build-arg required; API only as a helper.

**Chosen: A.**

**Reasoning:** A silent fallback (Option B) defeats FLSH-06's "no hardcoded version anywhere" criterion. Option C makes routine "just build main" fragile — humans forget to pass args. Option A keeps `docker build` reproducible (build-arg for rollback), gives "clean build → current stable" by default, and surfaces upstream API outages loudly instead of freezing on stale versions. STATE.md's "no runtime dependency" invariant is not violated because the API call is build-time only.

### Area 3 — Version injection mechanism

**Options considered:**
- A) `NEXT_PUBLIC_FIRMWARE_VERSION` env var; delete hardcoded constant; assert non-empty at build.
- B) Generated `firmware.ts` module written by a build script.
- C) Both — write env var and generate a versioned module.

**Chosen: A.**

**Reasoning:** `NEXT_PUBLIC_` is the standard Next.js pattern already in use in this Dockerfile (see `NEXT_PUBLIC_ASSET_PREFIX`, `NEXT_PUBLIC_VERSION_APP`). Option B introduces a code-generation step that pollutes git diffs and duplicates the env-var indirection Next.js already provides. Option C is a superset with no added benefit. Assertion on empty is critical — silent empty would produce broken firmware URLs at runtime. UI placement of the version chip is deferred to Phase 19 (branding/UX) — Phase 18 only guarantees the value is compiled into the bundle.

### Area 4 — Hardware list regeneration + recommended-set placement

**Two sub-decisions:**

**4a — Regeneration timing:**
- A) Dedicated Dockerfile stage running a Node fetcher + matching `scripts/generate-hardware-list.sh`.
- B) `postinstall` script.
- C) `prebuild` npm script.

**Chosen: A.** Mirrors the firmware-download pattern (Dockerfile stage + parallel dev script) — no new mental model for future maintainers. `postinstall` fires on every `npm install`, which is too eager. `prebuild` couples data regeneration to Next's build lifecycle in a way that's harder to override.

**4b — Where does `RECOMMENDED_SLUGS` live?**
- A) Keep in `src/config/devices.ts` (current runtime lookup).
- B) Bake into `hardware-list.json` at build time.

**Chosen: A.** Preserves the clean separation between raw upstream data (JSON) and DCR34 opinion (code). Prevents merge-conflict pain when Meshtastic revises the JSON. Existing `isRecommended()` already sorts recommended first at runtime, so no runtime code changes are needed.

**Additional decision:** Keep `public/data/hardware-list.json` tracked in git as a snapshot. Regenerated on every clean build regardless, but tracked so PRs show upstream Meshtastic drift and dev-without-network still works.

### Area 5 — Offline guarantee enforcement

**Options considered:**
- A) Build-time grep assertion on `.next/` output for meshtastic hostnames.
- B) Runtime network-isolation test (spin up container with no network, run smoke test).
- C) Documented + reviewed only.

**Chosen: A.**

**Reasoning:** Cheapest defense-in-depth. Runtime isolation (B) is worth doing at Phase 19 acceptance since dependency bumps could reintroduce fetches, but for Phase 18 the surface is unchanged — we're only *adding* build-time API calls, not runtime ones. Grep on built output catches accidents (e.g., a debug `console.log(URL)` shipping a hostname string). Documented-only (C) has no teeth.

---

## Deferred ideas (surfaced but out of phase)

| Idea | Why deferred |
|---|---|
| Cache last-known-stable in the build environment | Build-arg override already handles rollback; caching layer is v1.6+ hardening. |
| Automated hardware-in-the-loop CI boot test | Requires physical device attached to CI. Manual verification checklist for now. |
| Two-track firmware channel (stable + beta) | Explicitly rejected by v1.4 milestone ("no firmware version picker"). Do not build. |

---

## Autonomous decisions made outside gray-area menu

- **Delete the hardcoded `FIRMWARE_VERSION` constant** rather than leaving a fallback — cleaner, and STATE.md invariants demand no hidden pins.
- **Fail the build on empty `NEXT_PUBLIC_FIRMWARE_VERSION`** — a Next.js env with an empty value would silently produce broken URLs. Loud failure over silent breakage.
- **Assertion greps against both `.next/standalone` and `.next/static`** — client bundles can end up in either.
- **Document offline-verification in `apps/run.flash/README.md`** as part of the release checklist — not a CI job, per the milestone's minimal-CI-change principle.

---

## Confidence and open risks

- **HIGH confidence:** Areas 2, 3, 4, 5 — all straightforward pattern extensions of existing code.
- **MEDIUM confidence:** Area 1 (factory image) — the *decision* is clear (spec-recommended path), but the *verification* (device boots and connects) is a hardware test that must be executed physically. STATE.md flags this as the highest open risk for v1.4. Plan phase should schedule the boot test **before** claiming FLSH-06/07 done.

No further discussion needed. Ready for research / plan.
