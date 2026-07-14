# Phase 48: CloudFront + Integration Exposure - Context

**Gathered:** 2026-07-14
**Status:** Ready for planning
**Source:** PRD Express Path (`docs/superpowers/specs/2026-07-13-ctf-judge-and-covert-channel-design.md` §9, §11) — discuss-phase skipped; design answers scope/decisions/success.

<domain>
## Phase Boundary

The final wiring: make the covert path and the q-hosted admin leaderboard resolve correctly + uncached through CloudFront, and expose the CTF signal the separate DC33 total-score migration consumes.

**CRITICAL DELIVERY CONSTRAINT — this milestone goes TO A PR, NOT A DEPLOY.** This phase AUTHORS + VALIDATES infrastructure; it does **NOT** `terragrunt apply` / `terraform apply` / deploy anything. CloudFront behavior changes touch PRODUCTION distributions and cannot be verified without an apply we are deliberately NOT doing. So: author the Terraform where it can be done safely, `terraform validate` it, and where a blind edit to a production distro would be risky, produce a precise **deploy-spec** (exact path pattern, origin, cache/origin-request policy, behavior ordering) for a human to apply under review — do not commit an untested, potentially site-breaking HCL edit and call it verified.

**In scope (CTF-12, CTF-13, CTF-14):**
- **CTF-12 — covert-path CloudFront behavior** on the run.defcon.run distribution: an ordered cache behavior for the covert path `/use1/assets/theme` (the extension-less path Phase 46 chose) that routes to the **app/ALB origin** (NOT an S3/`*.css` static behavior), with **CachingDisabled** and **session-cookie forwarding**, at a precedence that a `*.css`/static behavior cannot intercept. FIRST discover whether/where this distribution is Terraform-managed in this repo.
- **CTF-13 — q `/admin/*` behavior** on the q.defcon.run distribution (`modules/qr-resolver`, distro E4SID56HIMXZW): an ordered behavior routing `/admin/*` to the **run.human ALB origin** (cookie-forward, no-cache) so `q.defcon.run/admin/leaderboard` renders the Phase-47 run.human page under its `ADMIN_GROUPS` gate — without turning the resolver Lambda into an app server. This likely needs the run.human ALB added as an additional origin on the q distro.
- **CTF-14 — integration exposure**: document (and confirm queryable) the `RunUser.ctfScore` + `CtfSolve` read the DC33 total-score mapper (separate `leaderboard` worktree) consumes. A markdown doc describing the exact keys/shape/query; do NOT build the global board.

**Out of scope:** ANY apply/deploy; the DC33 global leaderboard itself; app/judge/scoring/covert code (44–47, done).
</domain>

<decisions>
## Implementation Decisions (locked from spec §9, §11)

- **No apply, no deploy.** Author + `terraform validate` (module-level, which needs no AWS creds). Do NOT run `terragrunt plan`/`apply` against real AWS or CI. The PR carries the infra for review; a human applies it deliberately later.
- **Covert path routing (CTF-12):** target the app/ALB origin behavior; `CachingDisabled` (or a cache policy whose key makes it per-request); forward the session cookie (the app behaviors already use an AllViewerExceptHostHeader-style policy — reuse it). Ensure no higher-precedence `*.css`/static behavior grabs `/use1/assets/theme` first (it's extension-less specifically to avoid this — confirm against the actual behavior list).
- **q `/admin/*` routing (CTF-13):** add an ordered behavior on the q.defcon.run distro (`modules/qr-resolver/v1.0.0`) for `/admin/*` → run.human ALB origin, cookie-forward + no-cache; leave the default resolver behavior untouched. This mirrors the existing origin/behavior patterns already in that module.
- **If a production-distro edit can't be authored safely blind** (e.g. the run.defcon.run distro isn't cleanly TF-managed here, or the mixed-origin behavior list makes a safe insertion non-obvious without an apply-test): author what is safe, and for the rest write a precise **DEPLOY-SPEC.md** (path pattern, origin, policies, ordering, and the exact terragrunt unit + apply command) rather than committing a risky untested change. Flag it clearly.
- **Integration exposure (CTF-14):** a short doc (e.g. `docs/ctf-score-integration.md`) giving the DC33 mapper the exact read: `RunUser.ctfScore`/`ctfSolves` (rollup) + `CtfSolve` rows (source of truth) — entity, table `run-human-electro`, pk/sk composites (`$run#challenge_<c>` / `$ctfsolve_1#user_<sub>`, gsi1 `$run#user_<sub>`), and a sample query. Confirm the shapes against `src/entities/ctf.ts` + `run-user.ts`. Do NOT couple our writes to their schema.
</decisions>

<constraints>
## Constraints & Existing Code (planner: ground by reading the infra)

- **q.defcon.run distro / resolver module:** `infra/terraform/modules/qr-resolver/v1.0.0/*.tf` (`main.tf`, `transport.tf` = ALB→Lambda + CloudFront), live unit `infra/terraform/live/site/region/us-east-1/qr-resolver/terragrunt.hcl`. Distro E4SID56HIMXZW, account 427284555693.
- **run.defcon.run distribution:** DISCOVER where it is defined. Search `infra/terraform/` for the run-human / run.defcon.run CloudFront distribution, its ALB origin, its S3 origins (landing/assets), and its ordered behaviors (`/use1/*` app behavior, `/` S3, static). It may live in a `run-human`/`site` module or a services unit — find it before proposing an edit. If it is NOT Terraform-managed in this repo, say so and switch that piece to DEPLOY-SPEC.
- **Terraform/Terragrunt versions:** Terraform 1.14, Terragrunt 0.97 (per AGENTS.md). `terraform validate` at the module dir is the safe gate. `terraform fmt` for style.
- **Reuse existing module patterns** (origins, cache/origin-request policies, ordered behaviors) already in `qr-resolver`/the run.human distro — do not invent new policy shapes if reusable ones exist.
- **Entities to confirm for CTF-14:** `apps/run.human/webapp/src/entities/ctf.ts` (CtfSolve), `src/entities/run-user.ts` (ctfScore/ctfSolves).
- **Simplicity-first** (AGENTS.md). No app code changes in this phase.
</constraints>

<success_criteria>
## Success Criteria (what must be TRUE)

1. The covert-path CloudFront behavior (`/use1/assets/theme` → app/ALB origin, CachingDisabled, cookie-forward, no `*.css` intercept) is either authored + `terraform validate`-clean, OR precisely specified in DEPLOY-SPEC.md when a safe blind edit isn't possible — with the reason stated.
2. The q `/admin/*` → run.human ALB origin behavior (cookie-forward, no-cache) is authored + `terraform validate`-clean (or DEPLOY-SPEC'd), leaving the default resolver behavior untouched.
3. `docs/ctf-score-integration.md` documents the exact `ctfScore`/`CtfSolve` read (entity, keys, sample query) for the DC33 mapper, confirmed against the committed entities; the global board is explicitly NOT built here.
4. NOTHING is applied/deployed. Any authored Terraform is `terraform validate`-clean (+ `terraform fmt`); the phase output clearly states apply is a deliberate human follow-up.
</success_criteria>

<req_ids>
CTF-12, CTF-13, CTF-14
</req_ids>
