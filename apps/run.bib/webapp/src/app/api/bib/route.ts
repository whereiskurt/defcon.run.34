import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/config/auth";
import {
  createBib,
  getBib,
  NameLockedError,
  updateBibName,
} from "@/entities/bib";
import { generateUniqueRunnerCode } from "@/lib/runner-code";

/**
 * /api/bib — read / idempotent create / edit the signed-in user's bib.
 *
 * All three handlers derive ownerSub from `session.user.id` (populated by
 * config/auth.ts callbacks from the OIDC `sub` claim). Client-supplied
 * ownerSub is never trusted — the signed-in identity is the only PK source.
 */

// Design contract: PATCH accepts nameOnBib with a 32-char cap and trim.
const patchBodySchema = z.object({
  nameOnBib: z.string().max(32),
});

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

  try {
    const bib = await updateBibName(session.user.id, parsed.data.nameOnBib);
    return NextResponse.json({ bib }, { status: 200 });
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
