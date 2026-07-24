# Ghost bots: Bedrock LLM + decoupled, hidden flag challenges + two-sided guardrails

**Date:** 2026-07-24
**Status:** Design approved (pending spec review)
**Repos touched:** `meshtk` (Go), `defcon.run.34` (terraform, run.human, CTF script, meshtk config overlay)
**Supersedes / builds on:** the derived-OTP / derived-flag-code work (meshtk #10–#14), `project_ghost_admin_roster_derived_otp.md`

---

## 1. Problem

Today each CTF ghost's entire behavior lives in one cleartext YAML string,
`OpenAISystemPrompt` in `apps/run.mqtt/meshtk/meshtk.dc34.yaml`. That single
string carries three things that should not be together:

1. **Persona** — the character's voice and mannerisms (fine to be public).
2. **The challenge mechanic** — the trigger topic a player must raise and the
   instruction to reveal a code. This is fully readable in the repo, so anyone
   with repo access knows exactly how to solve every ghost.
3. **The answer** — historically the literal flag string. It is already
   decoy-hardened (the committed value is an HKDF input; the real code is derived
   at load via `otp.DeriveFlagCode`), but the reveal still depends on the LLM
   emitting an exact 8-char string, which is fragile.

Additionally:

- The LLM is **OpenAI** (`gpt-4o-mini`, `api.openai.com`), and **no OpenAI key is
  wired in prod** — so the flag reveal is currently blocked end-to-end.
- There is **no content moderation** on either the inbound player message or the
  outbound ghost reply. These are public-facing bots at DEF CON; an
  un-guardrailed jailbreak that makes a ghost emit something offensive is a
  reputational risk.

## 2. Goals

- **G1.** Replace OpenAI with **Amazon Bedrock** (Claude Haiku 4.5), authed by the
  ECS task role — no API key to wire. Keep the **Anthropic first-party API** as an
  operator-flippable backup; remove OpenAI entirely.
- **G2.** Remove the flag answer from the persona prompt. Inject it via a
  `{{code}}` template that is filled from configuration + derivation.
- **G3.** Persona prompts become **pure character** (voice, mannerisms, catch
  phrases) — safe to keep in cleartext YAML.
- **G4.** The prompt/challenge must still encode the **trigger** a player raises to
  earn the reveal.
- **G5.** Hide the **whole interaction** (trigger + reveal mechanic + decoy code)
  from repo readers by routing it through the existing SOPS → SSM → env-var secret
  path (the same path `MESHTK_GHOST_KEY_SECRET` already uses).
- **G6.** Keep the revealed code **in sync with CTF scoring** (`answerHash`).
- **G7.** Add **two-sided guardrails**: every inbound player message is checked
  before it reaches the model/trigger logic, and every LLM-generated reply is
  checked before it is sent over the mesh.

## 3. Non-goals

- Re-keying the ghost **node keypairs** (the `nodes.*.json` decoy-key path). That
  remains deliberately untouched to avoid churning live NodeDB entries.
- Changing the OTP unlock mechanic (period, window, derivation). Unchanged.
- Building a general LLM gateway (Bifrost) or standing up a new service.
- Moderating the **deterministic reveal** text for sensitive-info redaction (it
  contains the flag code by design — see §6.3).

---

## 4. Architecture overview

A ghost's definition splits into three layers, each solving a distinct goal:

| Layer | Content | Location | Secrecy |
|---|---|---|---|
| **Persona** | voice, mannerisms, catch-phrases | `meshtk.dc34.yaml` `SystemPrompt` | cleartext, public-safe |
| **Challenge** | `triggers[]`, `revealTemplate` (`{{code}}`), `committedCode` (decoy) | `MESHTK_FLAG_CHALLENGES` env (SOPS → SSM → ECS) | hidden from repo |
| **Code** | the real 8-char answer | derived at runtime, never stored | `DeriveFlagCode(secret, id, committedCode)` |

Runtime flow in the unlocked-chat branch:

```
inbound DM (radio already OTP-unlocked)
  │
  ▼
ApplyGuardrail(INPUT)  ──blocked──▶ send canned in-character refusal, return
  │ pass
  ▼
message matches a challenge trigger (case-insensitive substring)?
  │ yes ──▶ fill {{code}} with DERIVED code, send revealTemplate, return
  │          (code filled server-side; it NEVER enters the LLM; OUTPUT guard skipped)
  │ no
  ▼
LLM chat: MESHTK_ANTHROPIC_KEY set ? Anthropic-direct : Bedrock   (Claude Haiku 4.5)
  │
  ▼
ApplyGuardrail(OUTPUT) ──blocked──▶ send canned in-character refusal, return
  │ pass
  ▼
chunk to 60 chars, send over mesh
```

Key properties:
- The **flag code never enters the model context**, so prompt-extraction attacks
  on the bot cannot leak it, and the model cannot mistype/paraphrase it.
- Guardrails are a **standalone stage** (not inline on `Converse`), so they cover
  **both** the Bedrock and Anthropic-direct backends identically.

---

## 5. Detailed design — meshtk (Go)

### 5.1 Config model (`pkg/config/config.go`)

- **Remove** the per-fleet `FlagCode string` and `OpenAIKey string` fields, and
  repurpose/rename `OpenAISystemPrompt` → `SystemPrompt` (persona only).
- Add a runtime-only (not YAML) structure for challenges, loaded from the env
  blob:

  ```go
  type FlagChallenge struct {
      Triggers       []string `json:"triggers"`
      RevealTemplate string   `json:"revealTemplate"` // must contain "{{code}}"
      CommittedCode  string   `json:"committedCode"`  // decoy; HKDF input
  }
  // parsed from MESHTK_FLAG_CHALLENGES: map[fleetID]FlagChallenge
  ```

### 5.2 Load-time derivation (`internal/app/fleet/cmd.go` `NewFleets`)

- Read `MESHTK_FLAG_CHALLENGES` (JSON). For each fleet entry with a matching
  challenge, compute `derivedCode = otp.DeriveFlagCode(ghostSecret, id,
  challenge.CommittedCode)` and stash `{triggers, revealTemplate, derivedCode}` on
  the runtime fleet struct. `ghostSecret` resolution is unchanged (env fallback
  from #14).
- **Delete** the current `strings.ReplaceAll(prompt, fc, derivedFlag)` block —
  the code is no longer injected into the prompt at all.
- Derivation failure is **fail-closed** for that ghost's challenge (no trigger
  reveal) but does not blank the persona.

### 5.3 Trigger detection + deterministic reveal

- In the unlocked branch, after the INPUT guardrail passes and before any LLM
  call: if `containsAny(lower(userMessage), challenge.triggers)`, then
  `reveal := strings.ReplaceAll(challenge.revealTemplate, "{{code}}",
  derivedCode)` and `sendPKIReplyReliable(...)`, then return. Mirrors the existing
  OTP `strings.Contains` detection style. Reveal is idempotent (safe to re-fire).

### 5.4 LLM client

Replace `callOpenAIGPT` with two Claude backends and a selector:

- `callClaudeBedrock(ctx, message, system) (string, error)` — `bedrockruntime`
  **Converse** API, Claude Haiku 4.5 inference profile, `maxTokens≈150`,
  `temperature≈0.8`. Credentials via the default chain = ECS task role (same chain
  the DynamoDB keycache already uses; no key). Confirm exact Bedrock model ID /
  inference-profile string at build (`us.anthropic.claude-haiku-4-5-*`;
  `ca-central-1` may need a cross-region inference profile).
- `callClaudeAnthropic(ctx, message, system, key) (string, error)` — `POST
  https://api.anthropic.com/v1/messages`, model `claude-haiku-4-5`, headers
  `x-api-key` + `anthropic-version`.
- **Selection rule:** `MESHTK_ANTHROPIC_KEY` non-empty → Anthropic-direct; else →
  Bedrock. (Operator flips to the backup purely by setting the key in SSM.)
- Rename `handleGPTChat` → `handleLLMChat`; delete `callOpenAIGPT`, `OpenAIKey`,
  and every `MESHTK_OPENAI_KEY` reference.
- The `chatmode_unlocked` routing marker (`\`OPENAI=<url>\``) is repurposed:
  route to `handleLLMChat` whenever the ghost has a non-empty persona
  `SystemPrompt`; the ChatGPT share-URL string is removed from the YAML.

### 5.5 Guardrail stage (Bedrock Guardrails)

- `guardText(ctx, text string, source guardrailSource) (allowed bool, replacement
  string)` — calls `bedrockruntime.ApplyGuardrail` with the configured
  `GuardrailIdentifier` + `GuardrailVersion` and `Source = INPUT|OUTPUT`. On
  `Action == GUARDRAIL_INTERVENED`, return `allowed=false`.
- Wiring: INPUT guard on **every** inbound unlocked message; OUTPUT guard on
  **LLM-generated** replies only (the deterministic reveal is exempt — see §6.3).
- On block, send a short in-character canned refusal (per-ghost or a shared
  default, `<230` chars), not the offending text.
- If `MESHTK_GUARDRAIL_ID` is unset, guardrails are **skipped** (dev/local
  parity) and a warning is logged once.

### 5.6 Tests

- Table test for trigger detection (case/substring, multiple triggers, no-match).
- Reveal-template render test (`{{code}}` substitution; missing placeholder is a
  config error surfaced at load).
- Challenge-blob parse test (well-formed, missing ghost, malformed JSON →
  fail-closed).
- LLM backend selection test (key set vs unset picks the right path) — with the
  HTTP/Bedrock calls behind a small interface so they can be faked.

---

## 6. Detailed design — infra (defcon.run.34 terraform)

### 6.1 Challenge secret (SOPS → SSM → env)

- Add `flag-challenges` (a JSON string, the whole `MESHTK_FLAG_CHALLENGES` blob)
  to `infra/terraform/live/site/.secrets.sops.json` and to the `keys=[...]` list
  in `site.hcl` (alongside `ghost-key-secret`).
- Add SSM param `/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/mqtt/flag-challenges`.
- Inject env `MESHTK_FLAG_CHALLENGES` (`valueFrom` that param) on **both**:
  - `services/run.mqtt/service.hcl` (the ghosts container), and
  - `services/run.human/service.hcl` (so `/admin/ghosts` can display the trigger
    + derived code to the operator).

### 6.2 Bedrock access

- Create `aws_bedrock_guardrail` (+ a published version) with content filters
  tuned for the hacker-culture audience (see §6.3), plus `bedrock:InvokeModel`
  and `bedrock:ApplyGuardrail` on the **run-mqtt-ghosts task role** for the Haiku
  inference-profile + guardrail ARNs.
- **Manual, one-time:** enable Claude Haiku model access in the Bedrock console
  (account `427284555693`, `us-east-1`; `ca-central-1` via cross-region profile).
  Document in the plan as an out-of-band prerequisite.
- Add SSM param + env `MESHTK_ANTHROPIC_KEY` **created but empty** → prod stays on
  Bedrock by default; setting it flips to the direct-API backup.

### 6.3 Guardrail tuning (domain fit)

The ghosts are hacker personas — they are *supposed* to discuss 2600, phreaking,
exploits, "hack the planet." Configuration:

- **Keep:** prompt-attack/jailbreak filter, hate/harassment/sexual/violence
  content filters, PII detection.
- **Loosen/disable:** the generic "misconduct / illicit-activity" category (it
  trips on legitimate hacker-culture talk).
- **Denied topics (narrow):** real credentials, doxxing/PII of real people,
  actionable instructions to attack real infrastructure.
- **Reveal exemption:** the deterministic flag reveal is **not** run through the
  OUTPUT guard, because a PII/sensitive-info filter would redact the flag code.

---

## 7. Detailed design — CTF scoring sync

- The revealed code = `DeriveFlagCode(ghostSecret, id, committedCode)`. Since the
  committed codes keep their current values, the **derived codes are unchanged**,
  and the CTF `answerHash`es synced in the prior work still match — **no CTF data
  change is required** unless a committed code is rotated.
- `apps/run.human/webapp/scripts/rekey-ctf-otp-derived.mts` `--flags` mode gets a
  small update to source committed codes from the challenge JSON blob instead of
  the YAML `FlagCode` field. Re-run `--flags` only when a committed code rotates.

## 8. Detailed design — run.human admin roster

- `apps/run.human/webapp/src/lib/mesh-ghosts.ts`: read committed codes + triggers
  from `MESHTK_FLAG_CHALLENGES` (env) instead of the YAML `FlagCode` field; keep
  deriving the real code with `deriveFlagCode` for display on the roster card.
- The card shows the operator: persona summary, OTP reveal (existing), **trigger
  phrase(s)**, and the **derived flag code**.

---

## 9. Config example (the shape of the challenge blob)

`MESHTK_FLAG_CHALLENGES` (SOPS-stored, one JSON object keyed by ghost Id):

```json
{
  "ghost.goldstein": {
    "triggers": ["hack the planet", "hacking the planet"],
    "revealTemplate": "👻 You found a flag! Secret code: {{code}}",
    "committedCode": "hackers4evr"
  }
}
```

`meshtk.dc34.yaml` for the same ghost, after the change (persona only):

```yaml
SystemPrompt: "You are Emmanuel Goldstein, voice of 2600 ... calm, subversive,
  DIY ethics. From time to time, naturally drop the phrase 'hack the planet'.
  Keep replies under 230 characters."
```

The 8 CTF ghosts (goldstein, mudge, condor, sharp, ladyada, hopper, turing,
gibson) each get their inline trigger/reveal extracted into the blob and their
persona prompt cleaned. ricky/dt (lyrics-only, no flag) are unaffected.

---

## 10. Risks / open items

- **Bedrock model ID / region:** exact Haiku inference-profile string confirmed at
  build; `ca-central-1` may require a cross-region inference profile or the
  ghosts there fall back via `MESHTK_ANTHROPIC_KEY`.
- **Latency:** input-guard + LLM + output-guard ≈ up to 3 Bedrock round-trips.
  Acceptable — mesh chat already paces at 500ms/chunk; not latency-critical.
- **Guardrail over-blocking:** hacker-culture false positives; mitigated by §6.3
  tuning. Validate against real persona transcripts before the con.
- **Deploy path:** all deploys via GitHub Actions (meshtk merge → `buildpub.yml`
  run.mqtt; run.human via release + `deploy.yml`). No local terragrunt apply.
  meshtk in CI is freshly cloned from `github.com/whereiskurt/meshtk` main +
  overlaid with the dc34 config, so merging the meshtk PR ships the Go change.

## 11. Rollout order

1. meshtk PR: config model, LLM backends, trigger-reveal, guardrail stage, tests.
2. defcon.run.34 PR: SOPS `flag-challenges` + `MESHTK_ANTHROPIC_KEY`(empty) +
   Bedrock guardrail resource + IAM + env wiring (run.mqtt & run.human) + YAML
   persona cleanup + `mesh-ghosts.ts` + rekey script `--flags` source update.
3. Enable Haiku model access in Bedrock console (manual prereq).
4. Deploy meshtk fleet (buildpub) + run.human (release/deploy).
5. UAT: OTP unlock → chat (Bedrock persona) → raise trigger topic → receive
   derived code → submit → CTF chain solves. Verify guardrail blocks a jailbreak
   attempt on both INPUT and OUTPUT.
