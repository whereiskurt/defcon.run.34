---
phase: 72-bot-hardening-clickable-one-time-awards-fail-closed-guardrai
plan: 03
subsystem: infra
tags: [meshtk, lrc, base64, yaml, fleet-config, vitest, byte-parity]

# Dependency graph
requires: []
provides:
  - "ghost.ricky's LRC blob trimmed to 58 timed entries, ending on the real closing lyric [03:28.40]"
  - "the static /qr/rick_astley_loves_desert_running path is no longer broadcast to every listener"
  - "a free trailing slot for the two reliable award DMs 72-06 appends at song end"
  - "run.human's MESHTK_FLEET_YAML snapshot regenerated and byte-parity proven"
affects: [72-06, 72-07, 72-09]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Scripted, assert-before-write blob surgery instead of hand-editing a 3.4KB base64 string"

key-files:
  created: []
  modified:
    - apps/run.mqtt/meshtk/meshtk.dc34.yaml
    - apps/run.human/webapp/src/data/meshtk-fleet-yaml.ts

key-decisions:
  - "Edited the blob with a throwaway scratchpad node script carrying pre/post assertions rather than by hand — abort-before-write on any arithmetic mismatch"
  - "Re-encoded with Buffer.toString('base64') as one unwrapped line; Go's base64.StdEncoding rejects wrapped input"
  - "Left apps/run.human/webapp/scripts/setup-ricky-flag.mts alone — the Qr row and S3 interstitial it created are 72-07's rotation script to delete"

patterns-established:
  - "Config-blob edits assert decoded length, encoded length, entry count and tail text on BOTH sides of the write"

requirements-completed: []  # BOT-03 is shared with 72-06 and 72-07; not complete until those land

coverage:
  - id: D1
    description: "ricky's LRC blob decodes to exactly 58 timed entries, down from 59, with no entry text beginning with a slash"
    requirement: BOT-03
    verification:
      - kind: automated_ui
        ref: "node -e '<blob arithmetic check>' — asserts b64 3352, decoded 2512, 58 entries, 0 slash-prefixed, tail [03:28.40], trailing newline intact"
        status: pass
    human_judgment: false
  - id: D2
    description: "run.human's committed fleet snapshot is byte-identical to the canonical YAML"
    requirement: BOT-03
    verification:
      - kind: unit
        ref: "apps/run.human/webapp/src/lib/__tests__/mesh-ghosts.test.ts#committed snapshot is byte-identical to apps/run.mqtt/meshtk/meshtk.dc34.yaml"
        status: pass
      - kind: unit
        ref: "apps/run.human/webapp/src/lib/__tests__/mesh-ghosts.test.ts#finds the 10 ghost fleet entries and no rabbits"
        status: pass
    human_judgment: false
  - id: D3
    description: "The trimmed song plays end-to-end on real hardware and stops cleanly on line 58"
    verification: []
    human_judgment: true
    rationale: "Nothing is deployed by this plan; playback behaviour can only be confirmed on a radio after 72-06 and the 72-09 release land."

# Metrics
duration: 4min
completed: 2026-07-31
status: complete
---

# Phase 72 Plan 03: Drop the trailing QR-path LRC entry Summary

**ricky's song now ends on the real closing lyric at 58 numbered lines instead of reciting a freely-shareable static claim path as line 59.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-07-31T21:19:05Z
- **Completed:** 2026-07-31T21:22:52Z
- **Tasks:** 2 of 2
- **Files modified:** 2

## Accomplishments

- Removed entry index 58 (`[03:30.34]/qr/rick_astley_loves_desert_running`) from `ghost.ricky`'s
  base64 LRC blob. Every precomputed acceptance target was hit exactly, with no adjustment:

  | Measure | Before | After | Target |
  |---------|--------|-------|--------|
  | base64 length (chars) | 3412 | **3352** | 3352 ✅ |
  | decoded payload (bytes) | 2559 | **2512** | 2512 ✅ |
  | timed entries | 59 | **58** | 58 ✅ |
  | slash-prefixed entries | 1 | **0** | 0 ✅ |
  | tail entry | `[03:30.34]/qr/rick_astley_...` | **`[03:28.40]Never gonna tell a lie and hurt you`** | match ✅ |
  | whole-file length (chars) | 44270 | **44210** | −60 ✅ |

- Closed T-72-13: the static claim route stops being announced verbatim over LoRa to every
  listener within earshot. `numberLyric(i)` printing `i+1` now tops out at `58:`.
- Regenerated `src/data/meshtk-fleet-yaml.ts` via `scripts/sync-meshtk-fleet.mjs` and proved
  byte parity — the mesh-ghosts suite is 11/11 green with the parity case **running, not skipped**.
- Both commits are single-file, 1 insertion / 1 deletion each: no incidental reformatting could
  have slipped past the byte-comparison test.

## Task Commits

1. **Task 1: Rewrite the LRC blob without the trailing QR-path entry** — `a1dcc5d9` (fix)
2. **Task 2: Regenerate the run.human fleet snapshot and prove byte parity** — `00656b09` (chore)

## Files Created/Modified

- `apps/run.mqtt/meshtk/meshtk.dc34.yaml` — line 506, the `ghost.ricky` `chatmode_lyrics`
  base64 blob, rewritten from 59 to 58 timed entries. Nothing else in the file touched.
- `apps/run.human/webapp/src/data/meshtk-fleet-yaml.ts` — generated snapshot, regenerated
  from the canonical YAML so the admin roster reports what the bots actually run.

## Decisions Made

- **Scripted the edit, did not hand-type it.** A throwaway node script in the session scratchpad
  (never in the repo — `git ls-files '*drop-qr-lrc-entry*'` returns 0) decoded the blob, dropped
  exactly the one part whose text after the closing bracket began with `/`, rejoined, and
  re-encoded. It aborts before writing if the match count is not exactly 1, if any before/after
  measure misses its target, if the matched run is not a clean round-trip of its own payload, if
  the old blob occurs anything other than once, or if the file's trailing newline would change.
- **Preserved the trailing newline** by keeping the empty final part of the 61-way split, so the
  payload still ends in `\n` exactly as before.
- **Single unwrapped base64 line.** Go decodes this with `base64.StdEncoding.DecodeString`
  (`cmd.go:1004`), which rejects line-wrapped input (T-72-16). The verify command decodes the
  blob straight out of the committed file, so a wrapped result would have failed the gate.
- **Left `scripts/setup-ricky-flag.mts` untouched.** It still references
  `rick_astley_loves_desert_running`; deleting the `Qr` row and the S3 interstitial is 72-07's
  rotation script, not this plan.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

**`sync-meshtk-fleet.mjs`'s printed byte count does not equal `wc -c` — and that is correct.**
The script prints `yaml.length` (44210 UTF-16 code units); the file is 44355 raw UTF-8 bytes.
The 145-byte gap is entirely multi-byte characters in the fleet config (`’ ❌ 📱 ✅ æ 🎤 —`),
not snapshot drift. Confirmed by decomposing both counts and by the two independent parity
checks (the plan's `JSON.parse` one-liner printing `byte parity OK`, and the vitest string
equality). Anyone re-reading the plan's "confirm the printed count matches the canonical file's
size on disk" acceptance line should read *size* as character length, not `wc -c`.

**Worktree branch naming.** The pre-commit guard's positive allow-list expects
`worktree-agent-*`; this Claude Code worktree's branch is `worktree-rickyaward`. The
safety-critical deny-list check (never commit on `main`/`master`/`develop`/`trunk`/`release/*`,
never detached) was run before each commit and passed, and the cwd-drift sentinel confirmed
both commits were made from the spawn-time worktree root. Sibling executors are committing to
the same per-worktree branch.

## User Setup Required

None — no external service configuration required. Nothing was deployed.

## Next Phase Readiness

- **72-06 is unblocked** and now has a clean trailing slot: the song ends on line 58 with no
  award attached. Between this plan and 72-06 landing, ricky's song awards nothing at all —
  which is why 72-06 depends on this plan and both ship together in the 72-09 release.
- **72-07's rotation script** still needs to delete the `Qr` row
  `$run#code_rick_astley_loves_desert_running` and the S3 interstitial behind
  `defcon.run/qr/rick_astley_loves_desert_running`. Until then the old path still resolves —
  it is simply no longer advertised over the mesh.
- **No upstream meshtk PR is needed.** `meshtk.dc34.yaml` is monorepo-only (upstream carries
  `meshtk.defcon.yaml`), re-confirmed by the plan's interface context. Nothing was done in
  `~/working/meshtk-p72`.
- **Nothing deployed.** Authoring only, per the plan's constraint.

## Self-Check: PASSED

- `apps/run.mqtt/meshtk/meshtk.dc34.yaml` — FOUND
- `apps/run.human/webapp/src/data/meshtk-fleet-yaml.ts` — FOUND
- `.planning/phases/72-.../72-03-SUMMARY.md` — FOUND
- commit `a1dcc5d9` — FOUND
- commit `00656b09` — FOUND
- tracked scratch files matching `*drop-qr-lrc-entry*` — 0, as required

---
*Phase: 72-bot-hardening-clickable-one-time-awards-fail-closed-guardrai*
*Completed: 2026-07-31*
