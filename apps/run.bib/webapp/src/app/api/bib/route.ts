import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/config/auth";
import {
  createBib,
  getBib,
  isBibNameChange,
  NameLockedError,
  updateBibName,
  updateBibWillPayInPerson,
  updateBibBurned,
} from "@/entities/bib";
import { consumeQuota, type QuotaTier } from "@/lib/quota-client";
import { generateUniqueRunnerCode } from "@/lib/runner-code";
import { verifyBibSolution } from "@/lib/altcha";

/**
 * /api/bib — read / idempotent create / edit the signed-in user's bib.
 *
 * All three handlers derive ownerSub from `session.user.id` (populated by
 * config/auth.ts callbacks from the OIDC `sub` claim). Client-supplied
 * ownerSub is never trusted — the signed-in identity is the only PK source.
 */

/**
 * Design contract: PATCH accepts one or both of `nameOnBib` and
 * `willPayInPerson`. At least one must be present so a completely empty
 * body still 400s (rejects accidental no-op patches). Fields are applied
 * in sequence: nameOnBib first (may throw 409 name_locked), then
 * willPayInPerson. If nameOnBib throws, willPayInPerson is not applied.
 *
 * `nameOnBib` retains the 32-char cap enforced server-side.
 * `willPayInPerson` (Phase 22-05) is a bare boolean pledge — no other
 * validation; the semantics of "will pay in person" are opaque to the
 * schema and interpreted downstream (admin report).
 */
/**
 * Silently strip non-printable-ASCII (emojis, combining marks, RTL controls,
 * etc.) from the name — Kurt 2026-07-02: the bib printer can't render them,
 * so we normalize on write rather than block the request. Also runs on the
 * client (BibForm.onChange); the server is the source of truth in case a
 * caller bypasses the UI.
 */
const stripNonAscii = (s: string) => s.replace(/[^\x20-\x7E]/g, "");

const patchBodySchema = z
  .object({
    nameOnBib: z
      .string()
      .max(24)
      .transform((s) => stripNonAscii(s).slice(0, 24))
      .optional(),
    willPayInPerson: z.boolean().optional(),
    // "🔥 Fuck your bib" opt-out (Kurt 2026-07-05). true burns (free name reset +
    // pledge off), false un-burns. Handled by updateBibBurned, independent of the
    // name/pledge branches.
    burned: z.boolean().optional(),
    // ALTCHA proof-of-work payload (base64). Required — verified server-side
    // before any mutation (Kurt 2026-07-03 friction control).
    altcha: z.string().min(1),
  })
  .refine(
    (data) =>
      data.nameOnBib !== undefined ||
      data.willPayInPerson !== undefined ||
      data.burned !== undefined,
    {
      message:
        "PATCH body must include at least one of nameOnBib, willPayInPerson, or burned",
    }
  );

/**
 * GET /api/bib
 *
 * Returns the signed-in user's bib. If no bib exists yet, returns
 * `{ hasCreated: false }` (200) so the client can decide to POST-to-create.
 * The client SHOULD NOT infer 404 == "no bib" — 200 with a flag is the
 * contract.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const bib = await getBib(session.user.id);
  if (!bib) {
    return NextResponse.json({ hasCreated: false }, { status: 200 });
  }
  return NextResponse.json({ hasCreated: true, bib }, { status: 200 });
}

/**
 * POST /api/bib
 *
 * Idempotent create: if the user already has a bib, returns it verbatim.
 * Generates a fresh unique runnerCode via generateUniqueRunnerCode() and
 * relies on createBib's ConditionalCheckFailedException path to short-circuit
 * on collision.
 *
 * Body is ignored (Zod-validated as empty to reject accidental client
 * payloads that might imply the client can supply ownerSub or runnerCode).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Reject non-empty bodies defensively — client should not be sending
  // anything on POST. An empty body / no content-type is fine.
  try {
    const contentLength = req.headers.get("content-length");
    if (contentLength && Number(contentLength) > 0) {
      const raw = await req.text();
      if (raw.trim().length > 0 && raw.trim() !== "{}") {
        return NextResponse.json(
          { error: "invalid_body", detail: "POST /api/bib takes no fields" },
          { status: 400 }
        );
      }
    }
  } catch {
    // fall through — an unparseable body is still fine so long as we don't
    // proceed with mystery data.
  }

  const ownerSub = session.user.id;

  // Fast path: bib already exists, skip runnerCode generation entirely.
  const existing = await getBib(ownerSub);
  if (existing) {
    return NextResponse.json(
      { hasCreated: true, bib: existing, created: false },
      { status: 200 }
    );
  }

  try {
    const runnerCode = await generateUniqueRunnerCode();
    const bib = await createBib(ownerSub, runnerCode);
    // createBib returns the pre-existing bib if a race lost the create call;
    // treat it as success either way.
    return NextResponse.json(
      { hasCreated: true, bib, created: true },
      { status: 201 }
    );
  } catch (err) {
    console.error("[run.bib] POST /api/bib failed:", err);
    return NextResponse.json(
      { error: "create_failed" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/bib
 *
 * Body: `{ nameOnBib: string }` (0..32 chars, trimmed server-side).
 * - 400 if body doesn't match schema.
 * - 404 if the user has no bib yet (create with POST first).
 * - 409 with `{error: "name_locked"}` when nameLocked=true (admin locked).
 */
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_body", detail: "expected application/json" },
      { status: 400 }
    );
  }

  const parsed = patchBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", detail: parsed.error.issues },
      { status: 400 }
    );
  }

  // ALTCHA proof-of-work gate — reject before any mutation if the solution is
  // missing / invalid / expired (Kurt 2026-07-03 friction control).
  if (!(await verifyBibSolution(parsed.data.altcha))) {
    return NextResponse.json({ error: "altcha_failed" }, { status: 400 });
  }

  const services = (session.user as { services?: string[] }).services ?? [];
  const tier: QuotaTier = services.includes("admin") ? "admin" : "upload";

  try {
    // Apply nameOnBib first — may throw NameLockedError (mapped to 409).
    // We only patch what the caller supplied; missing fields stay untouched.
    let bib = null as Awaited<ReturnType<typeof updateBibName>> | null;
    let renamesRemaining: number | undefined;
    if (parsed.data.nameOnBib !== undefined) {
      // Only a real change (differs from stored) consumes a rename from the
      // central bibname_change quota (run.auth). No-op saves are free.
      if (await isBibNameChange(session.user.id, parsed.data.nameOnBib)) {
        const q = await consumeQuota(
          session.user.id,
          "bibname_change",
          1,
          tier
        );
        if (!q.success) {
          return NextResponse.json(
            { error: "rename_quota_exceeded", renamesRemaining: q.remaining },
            { status: 429 }
          );
        }
        renamesRemaining = q.remaining;
      }
      bib = await updateBibName(session.user.id, parsed.data.nameOnBib);
    }
    let togglesRemaining: number | undefined;
    if (parsed.data.willPayInPerson !== undefined) {
      // Turning the pledge ON drives the fun cash-rain — consume one from the
      // central bib_toggle quota (Kurt 2026-07-05, capped at 30). Turning it OFF
      // is free. On exhaustion, 429 so the client reverts the checkbox and shows
      // a friendly "that's plenty of cash" note.
      if (parsed.data.willPayInPerson === true) {
        const q = await consumeQuota(session.user.id, "bib_toggle", 1, tier);
        if (!q.success) {
          return NextResponse.json(
            { error: "toggle_quota_exceeded", togglesRemaining: q.remaining },
            { status: 429 }
          );
        }
        togglesRemaining = q.remaining;
      }
      // Phase 22-05: pledge is orthogonal to nameLocked, so we do NOT skip
      // this write if the name was locked — a locked-name bib may still
      // toggle the pledge (participant switches to in-person plan).
      bib = await updateBibWillPayInPerson(
        session.user.id,
        parsed.data.willPayInPerson
      );
    }
    if (parsed.data.burned !== undefined) {
      // Burn / un-burn. updateBibBurned does the FREE name-clear + pledge drop
      // when burning (no bibname_change quota) — independent of the branches
      // above, so a { burned: true } patch torches the bib on its own.
      bib = await updateBibBurned(session.user.id, parsed.data.burned);
    }
    return NextResponse.json(
      { bib, renamesRemaining, togglesRemaining },
      { status: 200 }
    );
  } catch (err) {
    if (err instanceof NameLockedError) {
      return NextResponse.json({ error: "name_locked" }, { status: 409 });
    }
    if (err instanceof Error && err.message.startsWith("No bib found")) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    console.error("[run.bib] PATCH /api/bib failed:", err);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
}
