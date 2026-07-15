import { Entity } from "electrodb";
import { electroClient, ELECTRO_TABLE } from "./client";

/**
 * QR / CTF admin entities (run.human side).
 *
 * These are TS mirrors of the resolver's ElectroDB entities in
 * `apps/run.qr/lambda/resolver/lib/entities.mjs`. The resolver (q.defcon.run)
 * READS `Qr`/`Ctf` on the hot path; the rollup Lambda owns `Qrstat` writes.
 * run.human is the ADMIN side — it creates/edits `Qr`/`Ctf` and READS `Qrstat`
 * for analytics. All three live on the SHARED `run-human-electro` table
 * (`service: "run"`), so run.human's existing electro credentials (which already
 * write RunUser etc.) can write here with no IAM change.
 *
 * ── LOAD-BEARING CONTRACT ───────────────────────────────────────────────────
 * Keep `model.entity` / `version` / `service` and the index `field:` names +
 * composite keys BYTE-IDENTICAL to the resolver `.mjs`. ElectroDB derives the
 * DynamoDB pk/sk from these; if they drift even slightly, the resolver reads the
 * wrong key and every scan 404s forever. This parity is locked down by
 * `src/entities/__tests__/qr-key-parity.test.ts`.
 *
 * CASING (also load-bearing): the resolver UPPERCASES the scanned code before
 * `Qr.get({code})` (parse-path.mjs → index.mjs), so the admin layer MUST store
 * `code` UPPERCASE (see lib/qr-admin.ts normalizeCode). The resolver does NOT
 * read `Ctf` at all — it forwards `/ctf/<challenge>/<value>` verbatim — so Ctf
 * rows are data-prep for the future Phase-5 judge, stored lowercase-normalized.
 */

// ---------------------------------------------------------------------------
// Qr — one row per short code (mirror of resolver entities.mjs)
// ---------------------------------------------------------------------------

export const Qr = new Entity(
  {
    model: {
      entity: "Qr",
      version: "1",
      service: "run",
    },
    attributes: {
      code: { type: "string", required: true },
      type: { type: "string", default: "redirect" },
      destination: { type: "string" },
      // Loose list-of-maps: entries differ by `kind` (time vs param). All
      // sub-properties optional so either shape validates. resolveDestination()
      // in the resolver owns the semantics.
      rules: {
        type: "list",
        items: {
          type: "map",
          properties: {
            kind: { type: "string" },
            from: { type: "string" },
            to: { type: "string" },
            match: { type: "string" },
            dest: { type: "string" },
          },
        },
      },
      enrich: {
        type: "map",
        properties: {
          preserveQuery: { type: "boolean" },
          appendParam: { type: "boolean" },
          utm: {
            type: "map",
            properties: {
              source: { type: "string" },
              medium: { type: "string" },
              campaign: { type: "string" },
            },
          },
        },
      },
      enabled: { type: "boolean", default: true },
      owner: { type: "string" },
      notes: { type: "string" },
      createdAt: {
        type: "string",
        default: () => new Date().toISOString(),
        readOnly: true,
      },
      updatedAt: {
        type: "string",
        default: () => new Date().toISOString(),
        watch: "*",
        set: () => new Date().toISOString(),
      },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["code"] },
        sk: { field: "sk", composite: [] },
      },
      byOwner: {
        index: "gsi1pk-gsi1sk-index",
        pk: { field: "gsi1pk", composite: ["owner"] },
        sk: { field: "gsi1sk", composite: ["updatedAt"] },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);

// ---------------------------------------------------------------------------
// Ctf — one row per challenge (mirror of resolver entities.mjs)
// ---------------------------------------------------------------------------

export const Ctf = new Entity(
  {
    model: {
      entity: "Ctf",
      version: "1",
      service: "run",
    },
    attributes: {
      challenge: { type: "string", required: true },
      // `answerHash` supersedes the plaintext `answer` as the stored secret; the
      // Phase-44 judge validates a salted hash against it. `answer` is kept as an
      // optional legacy attribute so existing rows still load — the
      // plaintext→answerHash migration lands in Phase 47 (NOT here).
      answer: { type: "string" },
      answerHash: { type: "string" },
      points: { type: "number" },
      // Scoring curve (Phase 44, CTF-01). See CONTEXT §Scoring / computePoints.
      pointMax: { type: "number" }, // curve ceiling when no time tier is active
      pointFloor: { type: "number" }, // curve floor
      // ⚠️ DISTINCT from `globalMax` (below). `maxSolves` is the scoring-curve
      // denominator N (the linear-decline divisor AND the per-solve cap on the
      // CtfSolve/ordinal path); it shapes how points decay per solver. It is NOT
      // the hard global scoring cutoff — that is `globalMax` (flag-types Slice 1a).
      maxSolves: { type: "number" }, // cap AND curve denominator (N)
      firstBloodBonus: { type: "number" }, // flat bonus for n == 1
      // --- Flag-types framework (Slice 1a, CTFT-01) — ALL OPTIONAL/ADDITIVE ------
      // A shipped row with NONE of these behaves exactly as a `static` flag today.
      // `answerType` absent ⇒ the judge reads it as "static". `wordlist` (Slice 3,
      // CTFT-14) is a pool of single-use codes claimed from the CtfCode entity —
      // run.human-internal, so the resolver `.mjs` mirror (which omits answerType
      // entirely) is unaffected.
      answerType: { type: ["static", "otp", "wordlist"] as const },
      // Shared TOTP secret the judge verifies against (CTFT-02). `period` default
      // is 120s (meshtk convention), NOT the RFC-typical 30. `secret` is base32.
      otp: {
        type: "map",
        properties: {
          secret: { type: "string" }, // base32-encoded shared secret
          digits: { type: "number" }, // code length (default 6)
          period: { type: "number" }, // seconds per window (default 120 — meshtk)
          algorithm: { type: "string" }, // HMAC hash (SHA1 now; SHA256/512 later)
          skew: { type: "number" }, // ± windows accepted on verify
        },
      },
      // Prerequisite challenge NAME (the unlock gate). ⚠️ This is the challenge
      // NAME, not an id — renaming the prereq silently breaks the chain. Acceptable
      // at DC scale; called out here so the mutability is not a surprise.
      unlockAfter: { type: "string" },
      // Min hours between a player's scoring solves (repeatable cadence gate).
      perPlayerIntervalHours: { type: "number" },
      // Max scoring solves per player (repeatable flags).
      perPlayerMax: { type: "number" },
      // ⚠️ DISTINCT from `maxSolves` (above). `globalMax` is the HARD GLOBAL
      // scoring cutoff across ALL players (0/absent = unlimited); once the global
      // ordinal exceeds it the flag awards nothing. It is NOT the curve denominator
      // N — that is `maxSolves`.
      globalMax: { type: "number" },
      // Additive/optional (Slice 2, CTFT-09) day/time/tz scoring window. Absent ⇒
      // always-scorable, so NO shipped row's behavior changes (no migration). The
      // judge (Slice 2) evaluates `now` in `tz` via Intl (DST automatic); outside
      // the window ⇒ non-solve indistinguishable from a wrong answer.
      // ⚠️ `days` are 0=Sun..6=Sat; `from`/`to` are WALL-CLOCK "HH:MM" (DISTINCT
      // from `timeTiers`' UTC-ISO from/to below); `tz` is an IANA zone id. No default.
      scoreWindow: {
        type: "map",
        properties: {
          days: { type: "list", items: { type: "number" } },
          from: { type: "string" },
          to: { type: "string" },
          tz: { type: "string" },
        },
      },
      // Active window's `ceiling` overrides `pointMax` (UTC-ISO from/to strings).
      timeTiers: {
        type: "list",
        items: {
          type: "map",
          properties: {
            from: { type: "string" },
            to: { type: "string" },
            ceiling: { type: "number" },
          },
        },
      },
      // Internal atomic ordinal allocator (ADD solveCount 1 → n). Default 0.
      solveCount: { type: "number", default: () => 0 },
      // Permissive: effect payload shape varies per challenge.
      effect: { type: "any" },
      maxAttempts: { type: "number" },
      rateLimitWindow: { type: "number" },
      // Collectible "CTF Cards" board art: a slug resolving to a static asset at
      // /ctf-cards/<slug>.(webp|svg). Data-only — the resolver never reads it, so
      // it is absent from the .mjs mirror's read path (kept in parity as a plain
      // optional string). Unlocked tiles render it; locked tiles never receive it.
      cardImage: { type: "string" },
      enabled: { type: "boolean", default: true },
      createdAt: {
        type: "string",
        default: () => new Date().toISOString(),
        readOnly: true,
      },
      updatedAt: {
        type: "string",
        default: () => new Date().toISOString(),
        watch: "*",
        set: () => new Date().toISOString(),
      },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["challenge"] },
        sk: { field: "sk", composite: [] },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);

// ---------------------------------------------------------------------------
// Qrstat — scan/handoff counters (mirror of resolver entities.mjs, READ-only here)
// ---------------------------------------------------------------------------

export const Qrstat = new Entity(
  {
    model: {
      entity: "Qrstat",
      version: "1",
      service: "run",
    },
    attributes: {
      code: { type: "string", required: true },
      bucket: { type: "string", required: true },
      count: { type: "number", default: 0 },
      lastSeen: { type: "string" },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["code"] },
        sk: { field: "sk", composite: ["bucket"] },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);
