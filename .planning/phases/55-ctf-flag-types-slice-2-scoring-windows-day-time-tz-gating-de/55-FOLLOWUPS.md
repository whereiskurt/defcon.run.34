# Phase 55 — Deferred Follow-ups (post-deploy UAT)

**Recorded:** 2026-07-15 (autonomous run)
**Phase status:** Code-complete, reviewed, all findings fixed. Verification = 12/12 must-haves; `human_needed` only for browser render + one live-DynamoDB write confirmation (no code gaps). 610/58 vitest green, tsc clean on touched files, covert path byte-identical.

## Deferred to browser/UAT (no jsdom in this repo — inherently browser-only)

| # | Check | Why deferred | How to verify post-deploy |
|---|-------|--------------|---------------------------|
| UAT-1 | **Scoring-window picker render + one-click quick-set** | `use client` component; visual layout + the "DEF CON run hours" chip fill are DOM interactions. | In /admin, open a flag → Scoring window & limits → toggle on, apply "DEF CON run hours", confirm it fills Thu–Sun 06:00–08:00 PT and each field stays editable. |
| UAT-2 | **save→edit rehydration** | Full browser round-trip through DynamoDB. | Save a windowed flag, reopen it, confirm days/times/tz rehydrate; confirm an unknown seeded IANA zone shows as a "(stored)" option and survives re-save (WR-02). |
| UAT-3 | **CR-01 clear-on-disable against a real table** | The `.remove(["scoreWindow"])` path is unit-tested with mocked entities only, not a live DynamoDB write. | Create a flag WITH a window, edit it with the toggle OFF, reload — confirm the stored row has NO scoreWindow (flag is always-open again). |
| UAT-4 | **Live window gate** | End-to-end judge behavior in real time. | With a narrow window set, attempt a solve inside vs outside the window — inside credits, outside is a silent non-solve (indistinguishable from a wrong answer). |

## Notes
- Overnight/wrap-around windows (`to <= from`) are intentionally **rejected at save** (WR-01), not supported — "DEF CON run hours" is a same-day 6–8 AM window. Revisit only if a real overnight window is ever needed.
- Server TOTP algorithm is still SHA1-only (Phase-53 WR-03, unrelated to this slice).
