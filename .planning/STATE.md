---
gsd_state_version: 1.0
milestone: v2.3
milestone_name: CTF Flag Types & Form Redesign
status: Milestone complete
stopped_at: "Completed 68-02-PLAN.md (v5 PUBLISH parity: setPublishPayload rewrite seam, inspectV5Publish, hop-clamp-to-wire, topic-alias BLOCK, downlink self-echo suppression) — upstream branch feat/mqtt5-dual-codec, NOT pushed/PR'd/deployed"
last_updated: "2026-07-29T06:28:11.568Z"
last_activity: 2026-07-29
progress:
  total_phases: 28
  completed_phases: 17
  total_plans: 72
  completed_plans: 67
  percent: 61
current_phase: 56
current_phase_name: ctf-flag-types-slice-3-wordlist-one-time-codes-ctfcode-entit
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-05)

**Core value:** Participants and organizers have a seamless digital experience for DCR34 -- from device setup to event discovery to route navigation. Milestone v2.2 brings back the DC33 leaderboard-as-activity-table in run.human, shipped hidden behind the admin group until perfected.
**Current focus:** Phase 68 — mqtt-v5-support-in-meshtk-proxy-dual-codec-android-2-8-compa

## Current Position

Milestone v1.9 CMS-Driven UI Copy Catalog — ✅ SHIPPED & ARCHIVED 2026-07-06.
All 5 phases (35-39, 21 plans) complete + verified. Archives:
`.planning/milestones/v1.9-ROADMAP.md` + `v1.9-REQUIREMENTS.md`. ROADMAP.md collapsed;
REQUIREMENTS.md removed (a fresh one comes with the next milestone).
Next: run `/gsd-new-milestone` to define the next milestone.

## Deferred Items

Items acknowledged and deferred at the v1.9 milestone close on 2026-07-06 (all NON-v1.9 —
pre-existing debt from other milestones, surfaced by the global pre-close audit):

| Category | Item | Status |
|----------|------|--------|
| verification | Phase 18 (v1.4 Build-Time Firmware) | human_needed — hardware boot verification pending |
| verification | Phase 19 (v1.4 Deps + DCR34 Branding) | human_needed — live flash-path regression pending |
| verification | Phase 33 (OIDC Silent SSO) | human_needed |
| quick_task | 1-wizard-panel-consistency-uniform-image-b | incomplete (backlog) |
| quick_task | 2-auto-register-flashed-radios-from-run-fl | incomplete (backlog) |

v1.9-internal note: cross-region (cac1) copy convergence was N/A for the shipped topology —
only us-east-1 was deployed for the copy-migrated apps, so there was no second live region to
observe against. The per-region mechanism (master → Litestream worker → revalidate) is
identical and will hold when a 2nd region deploys. Not counted as debt.

Last activity: 2026-07-29

## Roadmap Summary (v1.9)

| Phase | Goal | Requirements |
|-------|------|--------------|
| 35. CMS Copy Catalog Foundation | `ui-string` type + `(key,locale)` uniqueness + API-token read + S3 export hook | COPY-01/02/03/04, FALL-01 |
| 36. Runtime Copy Toolkit | `loadCopy` + Next Data Cache + merged-map `t()` + `CopyProvider`/`useCopy` + cached fallback | TOOL-01/02/03/04/05, FALL-02/03/04 |
| 37. Bib Donate/Sponsor Proof Surface | Wire bib donate/sponsor copy end-to-end (the proof) | MIGR-01 |
| 38. Custom Copy Admin Plugin | Three-column `label·locale·value` admin page + namespace filter + bulk upsert | ADMN-01/02/03 |
| 39. Copy Migration — Remaining Bib + Shared Chrome | Remaining bib copy + shared `common.*` chrome keys | MIGR-02/03 |

Deferred to v2: MIGR-04 (flash/human/auth/gpx migration), I18N-01 (locale population + switcher).

## Accumulated Context

### Roadmap Evolution

- Phase 54 added: CTF Flag Types — Slice 1b Frontend (Admin Form Redesign + otp-enroll QR/Rolling-Code Reward Renderer)
- Phase 55 added: CTF Flag Types — Slice 2 Scoring Windows (Day/Time/TZ Gating + DEF CON Run-Hours Quick Set)
- Phase 56 added: CTF Flag Types — Slice 3 Wordlist One-Time Codes (CtfCode Entity + Atomic Single-Use Claim)
- v2.3 milestone now fully sliced into phases 53 (done) → 54 → 55 → 56; autonomous execution of 54–56 authorized 2026-07-15

### Decisions

See PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [v1.9]: Words-only scope — each app keeps its own React header/menu and reads labels by shared `common.*` key; no shared component library
- [v1.9]: No Redis / no revalidation webhook — eventual consistency (~15 min) rides the existing master/worker + Litestream topology + time-based `revalidate:N`
- [v1.9]: Model our own `locale` column (not native Strapi i18n plugin) for the three-column admin grid
- [v1.9]: Fallback must be cached — resolver (Strapi → S3 export → committed snapshot) is wrapped in the Next.js Data Cache so a destroyed CMS never costs a slow failed call per load
- [v1.9]: bib donate/sponsor is the proof surface — hardest case (client-side, interpolated, modal-heavy) validates the whole approach; the plane can land after Phase 37
- [v1.4]: Latest-stable firmware resolved at build time (not runtime) — preserves zero-runtime-dependency guarantee
- [v1.3]: NLB-only for mqtt.defcon.run (no CloudFront -- MQTT is raw TCP)
- [Phase ?]: Kept Strapi attribute name 'locale' despite Strapi reserving it (marked Private, dropped required/default); Plans 02/38 depend on the exact name so drive locale via the Plan 38 custom admin, not the default content-manager
- [Phase ?]: 35-02: (key,locale) uniqueness via lifecycle 4xx guard + idempotent DB unique-index backstop (Litestream-safe hasTable guard)
- [Phase ?]: 35-02: FALL-01 copy.json S3 export is master-only + S3-env-guarded, full-catalog regeneration on every create/update/delete; excludes notes
- [Phase 35]: 35-03: read-only API token auto-covers ui-string find/findOne (no grant widening); verified 200/200/403/403/403/403/403 matrix
- [Phase ?]: [Phase 36-01]: No literal import 'server-only' — Next 16 vendors it internally; server-only enforced by convention (call-time env, never NEXT_PUBLIC_*, only resolved map to client)
- [Phase ?]: [Phase 36-01]: loadCopy wraps resolveCopy in unstable_cache (revalidate:300, tags:['copy']) so the resolved map incl. fallback is cached — fallback as cheap as happy path
- [Phase ?]: [Phase 36-01]: runtime resolver does one bulk Strapi fetch (pageSize=1000); pagination lives only in the manual copy:snapshot script, never in build (D-04)
- [Phase ?]: 36-02: renderCopy returns React nodes and relies on React text-node escaping (no manual escape) so escape-first holds without double-escaping
- [Phase ?]: 36-02: copy links require explicit http/https/mailto scheme; javascript:/data:/relative URLs drop href and render label as plain text
- [Phase ?]: CopyProvider passes only the resolved copy map client-side; never the server-only lib/copy resolver, token, or CMS URL (grep-gated)
- [Phase ?]: [Phase 37-01]: copy-snapshot.json is the authored source of truth for all 62 bib.* keys (SC-4 floor); import-copy.mjs upserts them into Strapi via a write-only STRAPI_WRITE_TOKEN, distinct from the runtime read-only token
- [Phase ?]: 37-02: server donate/sponsor surface reads catalog via loadCopy+t; reconcile note split around <code>{runnerCode}</code>
- [Phase ?]: 37-03: DonateModal submit CTA interpolated in-component via nested t() (bib.checkout.cta { label, amount }) — SC-2 proven on client
- [Phase ?]: 37-04: ContributionChip async server component via loadCopy; orderform needs no edit
- [Phase ?]: Phase 38-01 bulk-upsert reuses Phase-35 lifecycle write path (uniqueness guard + S3 export) via strapi.db.query inside one transaction; pure bulk-validate.ts holds intra-batch rules
- [Phase ?]: [Phase 38-02]: Copy Catalog admin page mounted via the first register()/addMenuLink injection in the repo (alongside app.tsx config+SSO bootstrap); resolves at /{region}/admin/copy-catalog
- [Phase ?]: [Phase 38-02]: added src/admin/tsconfig.json (admin preset) + excluded src/admin from server tsconfig — standard Strapi-5 split for the first JSX admin page; Vite bundles the admin so npm run build is the import/JSX gate
- [Phase ?]: [Phase 38-02]: admin fetch client targets /api/ui-strings + /api/ui-strings/bulk-upsert (no auto /api prepend); per-row errors map back by payload index, new ids reconciled by (key,locale)
- [Phase ?]: 39-01: Copy floor scoped to exactly what Wave 2 consumes (common.* chrome, bib.txn.*, bib.admin.*); admin dashboard/access-denied/signin pages stay literal.
- [Phase ?]: 39-01: common.header.donate re-homes the donate trigger; bib.donate.trigger left seeded until 39-04 re-points bib header/menu.
- [Phase 39]: 39-02: run.human copy toolkit installed (ported verbatim from run.bib, D-05); snapshot floor carries byte-identical common.* union (D-07); CopyProvider mounted in both group layouts; zero human.* easy wins authored (D-06 bias-to-defer)
- [Phase ?]: 39-04: TransactionHistory async loadCopy+t; AdminActions useCopy() (module consts removed) — words byte-identical
- [Phase ?]: 53-01: bucket-in-sk atomic ledger + QrValidationError extracted to dependency-free qr-errors.ts for pure helpers
- [Phase 53]: 53-02: verifyTotp built over totpAt across a +/- skew window with length-guarded crypto.timingSafeEqual (NEW; the meshtk Go had generation only); ctf-otp.ts is pure (node:crypto only), never logs secret/guess
- [Phase ?]: 53-03: CtfStore flag-types ops OPTIONAL (static seam stays type-clean); absent op == locked/degraded non-solve; globalMax off atomic ordinal
- [Phase 54]: 54-01: pure client-safe ctf-form-model seam — presetToAdvanced (5 distinct preset tuples so inferChallengeType round-trips), previewPoints delegates to computePoints (preview===judge parity, no duplicate curve), redactCtfSecrets strips otp.secret+effect before server→client prop (SC-2 boundary); imports ONLY @/lib/ctf-scoring, never the judge module. 19 tests, full suite 498 green.
- [Phase 54]: 54-02: split ctf-otp into node-free ctf-otp-core.ts (shared base32Decode→Uint8Array, DataView counterBytes, RFC-4226 truncateHotp, parseOtpauth, DEFAULT_* + types) re-exported by node ctf-otp.ts (every Phase-53 signature intact, existing tests untouched); new browser ctf-otp-client.ts adjacentCodesAsync via globalThis.crypto.subtle HMAC-SHA1 — no node import, no server-module import, no new dependency — parity-tested vs sync adjacentCodes across a secret×time×period matrix + RFC-6238 anchor. Full suite 536 green.
- [Phase 54]: 54-03: first client effect.kind handler — ctf-otp-enroll.ts asOtpEnrollEffect narrows unknown JudgeResult.effect → OtpEnrollEffect|null (kind+non-empty-otpauth+parseOtpauth in try/catch; never throws), new CtfOtpEnroll.tsx "use client" reward card (real QR via existing qrcode dep on a white quiet zone + rolling prev/CURRENT/next code + self-correcting 1s countdown via 54-02 adjacentCodesAsync + otpauth deep link + copy-setup-link + conditional next-flag), dispatched ONLY in ClaimClient's solved&&points>0 branch. Covert-invariant disk-read test (covert-egg/EggTrigger/CtfCelebration/ctf-covert-css/assets-theme carry no reward token) + git-diff-stat gate prove covert channel byte-untouched. 15 new tests. LANDMINE: an inadvertent `git stash` (prohibited — shared across worktrees) shelved the uncommitted ClaimClient edit; recovered via targeted `git stash apply stash@{0}` + drop, sibling stashes preserved, zero loss.
- [Phase 56]: 56-03: admin Wordlist option (CTFT-14) — Phase 56 COMPLETE (3/3), v2.3 milestone slices all built. A third answer-type segment (Static · Rotating OTP · Wordlist) in CtfForm reveals a write-only, add-only "One-time codes" bulk textarea; on save the non-blank lines are hashed SERVER-side via the SAME hashAnswer salt seam the judge (56-02) claims against (a loaded code and a submitted guess hash identically) and appended add-only to the 56-01 CtfCode pool; editing a wordlist flag shows a read-only "N codes loaded · M unclaimed" line. qr-admin gains CtfInput.codes (write-only plaintext lines), pure hashCodeBatch (trim/blank-drop/in-batch de-dup ⇒ {codeHashes,added,duplicates}, DB-free = the unit-test surface), add-only loadCtfCodes (CtfCode.create per hash, swallow dup/existence collision — never overwrites claimedBy, never logs plaintext), and getCtfCodeCounts (query.primary pages:all → loaded/unclaimed aggregate only); upsertCtf appends codes after the Ctf row create/patch for both create and edit. ctf-form-model: inferAnswerType returns wordlist (unknown/absent ⇒ static), answerType union widened on Loaded/RedactedCtfRecord, non-secret codeCounts added to both contracts and carried through redactCtfSecrets verbatim (like scoreWindow) — no plaintext code field ever introduced. Edit page fetches getCtfCodeCounts for wordlist flags and spreads codeCounts into redactCtfSecrets so the count line rehydrates without any code crossing to the client (SC3). onSave omits the static answer in the wordlist branch (answers live in the pool). DEVIATION (Rule 3, blocking): widened the Ctf entity answerType enum [static,otp]→[static,otp,wordlist] (Slice 1a deliberately deferred it) to clear 2 NEW tsc errors on upsertCtf's .set/create — the run.qr resolver .mjs Ctf mirror omits answerType entirely, so ZERO byte-parity impact (key-parity 13 tests re-run green). Phase-53 no-flip-after-solve guard honored for free: ctf-flag-types.isRepeatable already treats wordlist as repeatable, so assertAnswerTypeTransition rejects a static↔wordlist flip on a solved flag with no code change. Native <textarea cls.textarea> (matches the Effect field) — zero new deps; covert path untouched. SC3 grep gate green (RedactedCtfRecord exposes only codeCounts; form reads initial.codeCounts, never initial.codes). Full webapp suite 635 green (+9: 5 hashCodeBatch + 4 form-model); touched files tsc-clean (2 pre-existing out-of-scope errors untouched). Commits bf90e823/82787016/39588467.
- [Phase 56]: 56-02: judge wordlist branch (CTFT-13) — wired the `wordlist` answer type end-to-end behind the store seam. New OPTIONAL CtfStore.claimCode + defaultStore impl: `CtfCode.patch({challenge,codeHash}).set({claimedBy,claimedAt}).where((attr,op)=>op.notExists(attr.claimedBy))` — the atomic single-use claim is BOTH the wordlist answer validation AND the idempotency guard (used/unknown/absent-op ⇒ claimed:false; catch mirrors claimSolve — rethrows a present-and-unclaimed row so the judge degrades to non-solve). judgeSolve: dispatch computes codeHash = guessHash ?? hashAnswer(guess) then validates BY the claim; a DEDICATED wordlist finalize is placed BEFORE the isRepeatable block so wordlist NEVER calls claimScoreEvent (a player may redeem multiple DISTINCT codes) — allocate ordinal, honor globalMax (capped/points:0/no-accrue), computePoints, recordScoreEvent keyed bucket=codeHash, accrue, carry effect only on points>0. answerType union widened static|otp|wordlist (narrowCtf narrows wordlist); isRepeatable(wordlist)===true (CTFT-06 flip guard aware). **PLAN-CHECKER CORRECTION: recordScoreEvent patch→upsert** — the wordlist path has NO pre-existing CtfScoreEvent row (claimScoreEvent bypassed), so a `.patch()` would ConditionalCheckFailed → NON_SOLVE (a valid first-time code claimed but not scored); upsert (create-then-set) is idempotent for the repeatable path too. The in-memory Map fake can't catch create-vs-patch — confirmed by reading the ElectroDB call. Used/unknown ⇒ shared NON_SOLVE + identical ctfJudgeLog('no-solve'), guess/codeHash never in the log payload (asserted). Covert grep gate (ctf-wordlist-covert-invariant.test.ts) proves no wordlist/CtfCode/claimCode/codeHash token in the 5 covert modules; covert files byte-untouched since 56-01. Two-claimers-one-wins race proven at the store seam (Map fake, no await between check and set). Full webapp suite 626 green (+15); touched files tsc-clean (2 pre-existing out-of-scope errors untouched). Commits 5731a89d/d4894337/ba6fc94f.
- [Phase 56]: 56-01: CtfCode single-use wordlist entity (CTFT-12) — new ElectroDB entity in entities/ctf.ts (pk=challenge, sk=codeHash; attrs codeHash [salted, same hashAnswer seam answers use], claimedBy?/claimedAt? absent-until-claimed, createdAt) mirroring the CtfScoreEvent block. DELIBERATELY no plaintext `code` attribute (T-56-01-01 mitigated at schema level — a table read never hands over redeemable codes) and NO updatedAt (a claim is a one-time set). primary index ONLY, no byUser GSI (claim is by the exact (challenge, codeHash) key; the sk=codeHash makes once-per-code single-use a single conditional update on attribute_not_exists(claimedBy) — two concurrent claimers collide, exactly one wins, no read-then-write race — the atomicity 56-02 relies on). CtfCodeItem hand-authored contract added. Key-parity test pins $run#challenge_sao / $ctfcode_1#codehash_deadbeef (encoder lowercases the codehash label + value) as the 56-02 claim target. Schema-only — the conditional-patch claim lands in 56-02 behind the judge store seam. Full webapp suite 611 green; touched files tsc-clean (2 pre-existing out-of-scope errors untouched).
- [Phase 55]: 55-03: admin day/time/tz scoring-window picker (CTFT-11) — Phase 55 COMPLETE (3/3). Replaced the Phase-54 Slice-2 placeholder note in CtfForm §4 with the real picker: enable toggle ("Restrict scoring to a time window"), 7 Sun–Sat weekday chips (reusing cls.segment tokens, role=switch), Opens/Closes type="time" inputs, PT/ET/UTC `<select>` (stores the IANA id, resolved by the 55-01 bridge), and the accent "DEF CON run hours" quick-set chip (fills Thu–Sun 06:00–08:00 PT via scoreWindowToFormState(DEFCON_RUN_HOURS) then stays individually editable — presets pre-fill, never lock, mirroring applyPreset). Rehydrates on edit from initial.scoreWindow; onSave computes formStateToScoreWindow(...) and spreads `...(scoreWindow?{scoreWindow}:{})` so OFF ⇒ no key ⇒ no-clobber. Non-blocking "window-gated" chip on the live preview (window affects WHETHER it scores, not the value). NO player-facing window UI (covert-safe). qr-admin: scoreWindow added to CtfInput + ctfAttributes emits it verbatim only when provided (no-clobber), NOT part of the CTFT-06 flip guard — a window-only edit of a solved flag is never rejected (asserted by test: scoreWindow-only input emits no answerType/perPlayerMax/otp keys). Zero new deps; covert path untouched. Full webapp suite 591 green; touched files tsc-clean (2 pre-existing out-of-scope errors untouched).
- [Phase 55]: 55-02: judge scoring-window gate (CTFT-10) inserted as step 3 in judgeSolve — AFTER unlock (1b), BEFORE attempt-cap (2) — so a closed window short-circuits before the state-mutating cap bump + answer validation. Reuses the shared NON_SOLVE + the identical ctfJudgeLog('no-solve') (structurally no guess param), so a closed/invalid-tz window is byte-identical to a wrong answer on BOTH channels (T-53-04-01 held with ZERO covert-file edit — grep-gated). Consumes 55-01's pure isWithinScoreWindow (DST/tz correctness in one seam). narrowCtf carries row.scoreWindow verbatim, fail-closed coerce. 7-case judge test (backward-compat/inside/outside+no-leak/DST/order/covert). Full suite 588 green; ctf-judge.ts tsc-clean.
- [Phase 54]: 54-04: CtfForm design-A redesign (Phase 54 DONE, 4/4) — 7 ordered section cards (Name → challenge-type segmented presets → Answer type Static/Rotating-OTP → Scoring window & limits → Unlock & chaining → hand-rolled Advanced disclosure → live scoring preview). Dead standalone `Points` field REMOVED (grep-verified setPoints==0). Live preview binds previewPoints (54-01 adapter → computePoints; judge-parity, no duplicate scorer). Secrets write-only end-to-end: edit page routes getCtf row through redactCtfSecrets (raw `record as CtfRecord` cast GONE; no `secret` token on edit page); CtfForm's CtfRecord aliased to RedactedCtfRecord so the safe shape is the only accepted prop; answer/otp-secret/reward-otpauth/effect never prefilled, blank-on-save keeps stored (no-clobber). applyPreset pre-fills Advanced knobs via presetToAdvanced but never locks them. Static Reward → OTP enrollment configurator: write-only otpauth composes {kind:"otp-enroll",otpauth,nextFlag?} (precedence over raw Effect JSON), Reveal preview REUSES the 54-03 CtfOtpEnroll card. Wordlist NOT rendered; Slice-2 day/time/tz = placeholder note only (D5). New shared qr-ui tokens cls.segment/segmentActive/segmentIdle/chip/rewardCard (slices 55/56 inherit). Zero new deps. Full webapp suite 551 green; touched files tsc-clean (2 pre-existing out-of-scope errors in dropdown-user.tsx + checkin.test.ts untouched).
- [Phase 68]: 68-01 — MQTT v5 dual-codec seam landed UPSTREAM (/Users/khundeck/working/meshtk, branch feat/mqtt5-dual-codec, commits ec96e8f/54ddfbb/3d1a152/8aa70ec; NOT pushed, PR'd, vendor-synced or deployed). Pinned paho.golang **v0.22.0 not latest**: it needs x/net v0.27.0, BELOW meshtk's existing v0.38.0, so the vendor diff is 18 added files and nothing else moves — v0.23.0 would have dragged a 62-file x/net+x/sys+x/crypto upgrade into a phase whose hard requirement is 'do not destabilize', and its only relevant fix (reason-only DISCONNECT parsing) is INERT here because the design never parses DISCONNECT. **Frame-capture relay** is the load-bearing call: readFrame reads only the version-independent fixed header and forwards captured bytes verbatim, so packets paho.golang cannot parse (zero-length DISCONNECT e000 = EOF) or would inflate (short PUBACK 40021234 -> 400412340000) never tear a connection down; ONLY CONNECT and CONNACK are ever parsed. Protocol version travels **by construction** (handleProxyV5 spawns handleBackendV5) because a ConnTrack lookup races the CONNACK — the entry does not exist until the CONNECT is inspected but the downlink goroutine starts before that. 3.1.1 blast radius: proxy.go +7/-2 (one branch: ver>5 keeps 0x84, ver==5 enters handleProxyV5), rules.go +7/-0 (nil-guard only), inspect.go additive fields only (RawPacket.MQTT5, ConnectionInfo.ProtocolVersion). **The v4 golden was committed at 54ddfbb BEFORE any source edit and git log shows that file has exactly ONE commit** — so '3.1.1 is byte-for-byte unchanged' is a checkable fact, not a claim; the fixture carries HopLimit 7/HopStart 9 so RewriteHopLimit+RemarshalEnvelope actually run and the pinned bytes hold the CLAMPED values (48 03 / 78 07), and it also pins the per-packet PacketDecider outcome so a silent rule-match flip cannot hide behind matching bytes. Removed a **process-killing panic**: AllowMQTTControl dereferenced ip.Raw.MQTT unconditionally and a v5 packet leaves it nil — a panic in the read loop takes the whole server, not one connection. Closed a live gap: mosquitto 2.0 advertises TopicAliasMaximum=10 by default, so a v5 client could publish with an EMPTY topic + Topic Alias, blinding every topic rule and msh/... log line while the broker resolved it and fanned out normally — stripped BOTH directions (200900000622000a210014 -> 2006000003210014). Reject codes now version-correct: 0x87 bad/empty creds, 0x8C enhanced auth refused BEFORE the backend dial (matches mosquitto's own answer), 0x84 reserved for levels >5 — answering 0x84 to a level-5 CONNECT is exactly what made mqttastic retry-loop. AUTH_REJECT grammar kept verbatim (2 lines); enhanced auth gets its own action=MQTT5_AUTH_METHOD so research assumption A3 is greppable alone; new action=MQTT5_CONNECT makes Android v5 adoption measurable. **Nothing ships from this plan alone by design** — uplink v5 PUBLISH fails closed (action=BLOCK, reason=v5_publish_inspection_pending) until 68-02. DEVIATIONS (2, both Rule 3 blocking): (1) 'go mod tidy'/'go mod vendor' DROP a module nothing imports, so an isolated dependency commit carrying no code is unachievable in Go — added a 1-line blank-import anchor (mqtt5_dep.go) in ec96e8f, deleted in 3d1a152 once proxy_v5.go imported the codec for real; (2) net.Pipe is unbuffered and ControlPacket.WriteTo emits several Writes, so a single peer.Read deadlocked the CONNACK tests — fixed with io.ReadFull under a deadline. 13 new v5 tests + the golden; full meshtk suite green; every plan grep and both numstat budgets satisfied literally. LANDMINE for 68-04: the monorepo vendored snapshot is stale — branch from origin/main, never from release/2026-07-26-230957, or the sync REVERTS meshtk#22/#23.
- [Phase 68]: 68-02 — v5 PUBLISH parity landed UPSTREAM (/Users/khundeck/working/meshtk, branch feat/mqtt5-dual-codec, commits 4ee0cf9/5c31631/c70e2f9/82ac220/ae792d0/2c3a9cb; NOT pushed, PR'd, vendor-synced or deployed). 68-01's fail-closed 'v5_publish_inspection_pending' placeholder is GONE. **setPublishPayload** is the single codec-dispatched rewrite seam: RewritePayloadString and RemarshalEnvelope both ended in a bare 'switch p := (*ip.Raw.MQTT).(type)' that PANICS on a v5 packet (Raw.MQTT nil) — and had it merely failed to match, the hop clamp and payload censor would have been SILENT NO-OPS for every Android client while rules reported Rewrote (meshtk#22 exactly). It now returns an ERROR on a non-PUBLISH instead of silently doing nothing; provably no v4 regression because RemarshalEnvelope is only reachable from RewriteHopLimit, whose matcher requires a decoded ServiceEnvelope. **InspectorPacket.WireRewritten** makes forwarding EXPLICITLY once: re-encode iff the flag is set, else relay the captured frame — writing both, or mutating the struct while forwarding the original, is that bug class in both directions. Hop clamp proved on the WIRE: IN/OUT frames differ in exactly 2 bytes (4807 7809 -> 4803 7807) with topic, 0x32 first byte, packet id 1234, MessageExpiry and User property byte-identical — the assertion meshtk#22 lacked. inspectV5Publish's SetConnTrack call is LOAD-BEARING: the CONNECT forwarded to the broker carries the swapped proxy identity, so without it Track.Username is empty and RequireMQTTUserName would Block EVERY publish on an authenticated connection. Rules engine needed ZERO v5 awareness (rules.go still just the 68-01 nil-guard, +7/-0) because rules read ip.Raw.Meshtastic, not MQTT types. Uplink parse failure RELAYS + logs action=MQTT5_PARSE_FAIL mqtt_type=PUBLISH (accepted risk T-68-02-06: killing a session over one unmodelled property is worse; mosquitto ACL still constrains the swapped identity) while CONNECT parse failure still fails closed. Topic-alias uplink = action=BLOCK reason=topic_alias_uplink (fixture 300b00000323000368656c6c6f) — layered under 68-01's TopicAliasMaximum strip. **Downlink is NEVER re-encoded**: Properties.SubscriptionIdentifier is a single *int while MQTT 5.0 permits several on one PUBLISH (overlapping subs), so a round trip would silently drop all but one; the parse is read-only and only Payload+Topic are needed. logDownlink split into a 2-line wrapper over logDownlinkEnvelope, kept IN proxy.go (plan allowed either file) so the 3.1.1 diff is a 4-line rename not a 50-line move — proxy.go now +26/-6 vs origin/main. The extraction is proved behavior-preserving by the 68-01 golden: TestV4SessionForwardBytesGolden still passes and proxy_v4_golden_test.go is 0 added/0 deleted vs 54ddfbb, so the golden was NOT adjusted to fit the change. ZERO pre-existing test files edited. Read-deadline invariant asserted behaviorally (TestV5DownlinkDeadlineOnBackendSocket wraps both sockets in a counting net.Conn; client deadline touched 0 times). 15 new tests, full meshtk suite + go vet green. PLAN-SHAPE ADAPTATIONS (5, no behavior change): logDownlink stayed in proxy.go; uplink body extracted as handleV5PublishUplink so it is drivable with a captured frame + writerConn instead of a scripted session; extra non-PUBLISH-error test; hop-clamp fixture is a DECODED NODEINFO envelope because an encrypted one trips BlockInvalidEncryption and a TEXT_MESSAGE one reaches RewriteHelloGoodbye -> RewritePayloadString which nil-derefs ip.Meshtastic.Cipher and PANICS (pre-existing 3.1.1 landmine, deliberately NOT fixed — out of scope); small writeToBackend helper. LEFT: MQV5-06 local mosquitto e2e, MQV5-07 PR/vendor-sync/deploy/Kurt APK UAT.

### Pending Todos

None.

### Blockers/Concerns

- [v1.4 / Phase 19 — HARDWARE-IN-LOOP]: **tlora-t3s3 flashMode 'dio' boot** — verify the explicit branch (`use-flash.ts:104-106`) produces a bootable tlora-t3s3 device. Only remaining v1.4 open item — Kurt didn't have a tlora-t3s3 during 2026-07-02 hardware verification.
- 39-06 Task 2 live SC-3 proof pending operator: run copy:import with STRAPI_WRITE_TOKEN in both apps, then edit one common.* CMS row and confirm wording changes in BOTH bib and run.human live

## Session Continuity

Last session: 2026-07-29T06:27:17.383Z
Stopped at: Completed 68-02-PLAN.md (v5 PUBLISH parity: setPublishPayload rewrite seam, inspectV5Publish, hop-clamp-to-wire, topic-alias BLOCK, downlink self-echo suppression) — upstream branch feat/mqtt5-dual-codec, NOT pushed/PR'd/deployed
Resume file: None — 68-02 done. Next: 68-03 in /Users/khundeck/working/meshtk on feat/mqtt5-dual-codec

## Operator Next Steps

- Plan the first v1.9 phase with `/gsd-plan-phase 35`

## Performance Metrics

| Phase | Plan | Duration | Notes |
|-------|------|----------|-------|
| Phase 33 P01 | 30m | 3 tasks | 7 files |
| Phase 33 P02 | 25min | 3 tasks | 7 files |
| Phase 33 P03 | 12min | 2 tasks | 14 files |
| Phase 33 P04 | ~25m | 2 tasks | 1 files |
| Phase 33 P06 | 8min | 2 tasks | 15 files |
| Phase 35 P01 | 5m | 3 tasks | 5 files |
| Phase 35 P02 | 8m | 3 tasks | 5 files |
| Phase 35 P03 | 6m | 2 tasks | 1 files |
| Phase 36 P01 | 50min | 2 tasks | 7 files |
| Phase 36 P02 | 6 | 1 tasks | 2 files |
| Phase 36 P03 | 15min | 2 tasks | 3 files |
| Phase 37 P01 | 12min | 3 tasks | 4 files |
| Phase 37 P02 | 12m | 3 tasks | 4 files |
| Phase 37 P03 | 6min | 3 tasks | 5 files |
| Phase 37 P04 | 15m | 3 tasks | 3 files |
| Phase 37 P05 | ~12m | 3 tasks | 5 files |
| Phase 38 P01 | 15min | 2 tasks | 4 files |
| Phase 38 P02 | ~7min | 2 tasks | 4 files |
| Phase 39 P39-01 | 5m | 3 tasks | 3 files |
| Phase 39 P39-02 | ~6m | 3 tasks | 10 files |
| Phase 39 P39-03 | 8m | 2 tasks | 3 files |
| Phase 39 P39-04 | ~10m | 2 tasks | 2 files |
| Phase 39 P05 | 3min | 2 tasks | 4 files |
| Phase 53 P02 | 3min | 2 tasks (TDD RED/GREEN) | 2 files |
| Phase 53 P03 | 8min | 2 tasks | 2 files |
| Phase 54 P01 | ~10m | 2 tasks (TDD RED/GREEN) | 2 files |
| Phase 54 P02 | ~15m | 2 tasks (refactor + TDD RED/GREEN) | 4 files |
| Phase 54 P03 | ~20m | 3 tasks (TDD RED/GREEN + 2 feat) | 5 files |
| Phase 54 P04 | ~20m | 3 tasks (feat) | 3 files |
| Phase 55 P01 | 4min | 3 tasks | 5 files |
| Phase 55 P02 | 4min | 2 tasks (TDD RED/GREEN) | 2 files |
| Phase 55 P03 | 4min | 2 tasks (feat) | 3 files |
| Phase 56 P01 | ~2min | 2 tasks (feat + test) | 2 files |
| Phase 56 P02 | ~7min | 3 tasks (feat + feat + test) | 5 files |
| Phase 56 P03 | ~8min | 3 tasks (TDD RED/GREEN + TDD + feat) | 7 files |
| Phase 66 P02 | ~7min | 3 tasks (feat + test + feat) | 3 files |
| Phase 66 P04 | 20 | 2 tasks | 2 files |
| Phase 68 P01 | 17min | 3 tasks | 10 files |
| Phase 68 P02 | 11min | 3 tasks | 6 files |
