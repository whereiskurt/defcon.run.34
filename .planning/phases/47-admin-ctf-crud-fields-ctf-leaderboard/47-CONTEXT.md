# Phase 47: Admin CTF CRUD Fields + CTF Leaderboard - Context

**Gathered:** 2026-07-14
**Status:** Ready for planning
**Source:** PRD Express Path (`docs/superpowers/specs/2026-07-13-ctf-judge-and-covert-channel-design.md` §8) — discuss-phase skipped; design answers scope/decisions/success.

<domain>
## Phase Boundary

Make the greenfield CTF judge/scoring **operable by admins**: extend the existing `/admin/qr` CTF CRUD form with the Phase-44 scoring fields (hash-on-save), migrate existing plaintext answers, and build a CTF-only leaderboard.

**In scope (CTF-10, CTF-11):**
- **CtfForm field extensions** — surface the new `Ctf` scoring fields in the existing admin form: `pointMax`, `pointFloor`, `maxSolves`, `firstBloodBonus`, and `timeTiers[]` (reuse the datetime-local + preset-chip picker already built for QR rules). Answer entry **hashes on save** → `answerHash`; plaintext `answer` is never persisted going forward.
- **Plaintext→answerHash MIGRATION** (deferred here from Phase 44) — a one-time, idempotent migration that hashes any existing `Ctf.answer` plaintext into `answerHash`. Safe to re-run.
- **CTF-only leaderboard** — a new admin page: rank users by `RunUser.ctfScore` (desc), show `ctfSolves`; drill into a challenge to list its `CtfSolve` rows (user, ordinal, points, first-blood, channel, time). Admin-gated. Optional CSV export with the OWASP formula-injection guard.

**Out of scope:**
- The CloudFront behavior that makes the leaderboard reachable at `q.defcon.run/admin/leaderboard` (`q /admin/* → run.human origin`) — that is **Phase 48**. This phase builds the page in run.human's admin under its normal `/use1` basePath; Phase 48 wires the q host to it.
- Judge/scoring/covert changes (Phases 44–46, done).
- The DC33 global/total leaderboard — separate `leaderboard` worktree (integration boundary).
</domain>

<decisions>
## Implementation Decisions (locked from spec §8)

- **Reuse the existing admin surface.** CTF CRUD already lives at `run.defcon.run/use1/admin/qr` with `CtfForm.tsx`, `src/lib/qr-admin.ts` (`ctf_upsert`/`ctf_delete` validation + `ctfAttributes`), and `src/app/api/admin/qr/route.ts` (action dispatcher, `ADMIN_GROUPS` = admin|runadmin gate, 404-on-denial). EXTEND these — do not fork a new admin app.
- **Answer hashing on save** — the form's answer input is hashed with the Phase-44 `hashAnswer` (server-side, in `qr-admin.ts` `ctf_upsert`) → stored as `answerHash`. Never persist plaintext `answer` on new saves. On EDIT, leave `answerHash` unchanged when the admin leaves the answer field blank (don't clobber a set answer with an empty hash); only re-hash when a new answer is entered.
- **timeTiers editor** — reuse the QR-rules datetime-local + preset-chip pattern (`QrForm` time rules: `<input type=datetime-local>` + preset chips; stored UTC-ISO via toLocalInput/fromLocalInput round-trip). Each tier = `{ from, to, ceiling }`. Validate `from < to` and `ceiling` numeric.
- **Migration** — a standalone idempotent Node script (mirror the repo's existing one-off script pattern, e.g. the bib `reset-payment-data.mjs`/reconcile lineage) that scans `Ctf` rows and, for any with a non-empty plaintext `answer` and no `answerHash`, sets `answerHash = hashAnswer(answer)`. Idempotent (skip rows already hashed). Document how to run it against prod (AWS_PROFILE=dc34-application, use1). Do NOT auto-run it in app code.
- **Leaderboard reads** — rank by `RunUser.ctfScore` desc. At event scale (hundreds of users) a `RunUser` scan + in-memory sort is acceptable (mirror the Phase-43 `scanAllRunUsers` pattern). Per-challenge drill-in = query `CtfSolve` by challenge partition (`$run#challenge_<c>`) or by the `gsi1` user index; show ordinal/points/firstBlood/channel/solvedAt.
- **Admin gate** — reuse the existing `isAdmin`/`requireAdmin` (`ADMIN_GROUPS`) + 404-on-denial; the leaderboard page and any API it uses are admin-gated exactly like `/admin/qr`.
- **CSV** — if exported, reuse the existing admin CSV helper with the OWASP formula-injection `csvCell` guard (CTF challenge names + displayNames are attacker-influenced).
- **Page location** — build under the existing `(protected)/admin/` group (e.g. `(protected)/admin/leaderboard`) so Phase 48 can route `q.defcon.run/admin/leaderboard` → this run.human page. Match the `(protected)/admin` HeroUI/Tailwind chrome (`bg-content1`, `font-museo`, teal accent) used by the Phase-43 AdminConsole.
</decisions>

<constraints>
## Constraints & Existing Code (planner: ground by reading the codebase)

- **Existing admin CTF CRUD:** `apps/run.human/webapp/src/components/admin/CtfForm.tsx`, `src/lib/qr-admin.ts` (`CtfInput`, `ctfAttributes`, `upsertCtf`), `src/app/api/admin/qr/route.ts`, `src/app/(protected)/admin/qr/**` pages, and the admin list at `(protected)/admin/qr/page.tsx`.
- **QR-rules datetime picker to reuse:** `QrForm` (search `apps/run.human/webapp/src/components/admin/` for the datetime-local + preset-chip time-rule editor).
- **Phase-43 admin patterns:** `src/lib/admin/*` (isAdmin/requireAdmin/adminApi + `admin-reports.ts` csv `csvCell` guard), `scanAllRunUsers`. Reuse these.
- **Phase-44 hashing + entities:** `src/lib/ctf-hash.ts` (`hashAnswer`), `src/entities/qr.ts` (extended `Ctf`), `src/entities/ctf.ts` (`CtfSolve`), `src/entities/run-user.ts` (`ctfScore`/`ctfSolves`), electroClient.
- **Node/vitest:** `nvm use 23.6.0` before `npx vitest`; node_modules installed. Test: ctf_upsert hashes-on-save + doesn't clobber on blank-edit; migration idempotency (already-hashed skipped); leaderboard sort + per-challenge drill assembly; CSV formula-injection guard.
- **Simplicity-first** (AGENTS.md). No Terraform/CloudFront in this phase. Only new/edited files must be tsc-clean; the 5 pre-existing unrelated errors stay.
</constraints>

<success_criteria>
## Success Criteria (what must be TRUE)

1. The admin CtfForm creates/edits a challenge with `pointMax`/`pointFloor`/`maxSolves`/`firstBloodBonus`/`timeTiers[]`; saving hashes the answer to `answerHash` and never persists plaintext; editing with a blank answer field leaves the existing `answerHash` intact.
2. The migration script hashes existing plaintext `Ctf.answer` → `answerHash`, is idempotent (re-run is a no-op on already-hashed rows), and leaves no plaintext answer required by the judge.
3. The CTF leaderboard ranks users by `ctfScore` (desc) and drills into a challenge's `CtfSolve` rows (ordinal/points/first-blood/channel/time), under the `ADMIN_GROUPS` gate (non-admin → 404). CSV export (if built) applies the formula-injection guard.
4. `tsc` clean on new/edited files; vitest green; the existing CTF suite still passes.
</success_criteria>

<req_ids>
CTF-10, CTF-11
</req_ids>
