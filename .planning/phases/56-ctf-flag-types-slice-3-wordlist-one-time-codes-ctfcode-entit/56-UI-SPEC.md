# Phase 56 — UI Design Contract (Wordlist Answer-Type Option)

**Status:** APPROVED (authored inline; extends the Phase-54 UI-SPEC — same locked design system)
**Scope:** ONE new choice + its controls in the existing **Answer type** section of `CtfForm.tsx` — the **Wordlist** option alongside Static / Rotating OTP. No player-facing UI (players just submit a code through the normal claim flow; a used/unknown code is a silent non-solve — deliberately no player-visible "already used" surface, to preserve covert indistinguishability).

## Design system
Reuse Phase-54 tokens verbatim (`qr-ui.ts` / `cls.*`, HeroUI). No new component library, no new dependency. The Wordlist controls sit in the same Answer-type section as the Static answer field and the OTP-secret field, styled identically.

## Component inventory (HeroUI, matching the sibling answer-type controls)
- **Answer-type selector** — the existing segmented control gains a third segment: **Static · Rotating OTP · Wordlist**. Selecting Wordlist reveals the bulk-code controls and hides the Static answer / OTP-secret inputs.
- **Bulk code textarea** — a `Textarea` labeled **"One-time codes"**, one code per line, helper: **"One code per line. Each code can be claimed once, first-come. Codes are hashed on save — they are never stored or shown in plaintext."** This is a **write-only, add-only** input: on save the non-empty lines are hashed and appended to the pool; the textarea does NOT prefill existing codes on edit (they are unreadable — only hashes exist).
- **Loaded/remaining count** — a read-only line under the textarea: **"{N} codes loaded · {M} unclaimed"** (claimed = loaded − unclaimed), shown when editing a wordlist flag that already has a pool. On create it shows nothing until first save.
- **(Optional) per-line validation hint** — trim blanks, de-duplicate within the pasted batch, and show a small "{k} added, {d} duplicates skipped" confirmation after save (non-blocking).

## Copywriting
- Segment label: **"Wordlist"**; sub-hint on select: **"A pool of single-use codes, consumed first-come."**
- Textarea helper (above) — states the hash-on-save + never-plaintext contract explicitly for the admin.
- Count line: **"{N} codes loaded · {M} unclaimed."**
- Empty state (create, no codes yet): **"Paste codes above — they’ll be hashed and added when you save."**

## Interaction / states
- Switching answer type to Wordlist and back is guarded by the Phase-53 edit-semantics rule (`assertAnswerTypeTransition`) — do NOT allow flipping answer type once solves exist (would split history); surface the existing inline error, consistent with Static↔OTP.
- Bulk load is **additive**: saving appends new hashed codes to the pool; it never deletes or reveals existing codes. (Code removal / pool reset is out of scope for this slice.)
- The textarea is cleared after a successful save (its contents were one-shot input, now hashed into the pool).
- Accessibility: textarea + count line labeled; the new segment has an accessible name; ≥40px targets consistent with the Phase-54 admin surface.

## Out of scope (deferred)
- No player-facing "code already used" messaging (covert-safe silence).
- No per-code management UI (list/delete/reset) — add-only bulk load this slice.

## 6-dimension self-check
1. **Copywriting** — specific, states the hash-on-save/never-plaintext + first-come contract. PASS.
2. **Visuals** — reuses the Answer-type section hierarchy; the count line is the informational focal point. PASS.
3. **Color** — HeroUI semantic tokens only; no new accent use. PASS.
4. **Typography** — inherits Phase-54 roles; no new sizes. PASS.
5. **Spacing** — inherits the section's 4px base + documented half-steps. PASS.
6. **Registry safety** — HeroUI reuse only; no shadcn/registry, no new dep. PASS.
