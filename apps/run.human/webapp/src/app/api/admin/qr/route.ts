import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin } from "@/lib/admin-gate";
import {
  upsertQr,
  deleteQr,
  upsertCtf,
  deleteCtf,
  QrValidationError,
  type QrInput,
  type CtfInput,
} from "@/lib/qr-admin";

/**
 * POST /api/admin/qr — QR / CTF admin mutations (Phase-4 admin CRUD).
 *
 * Action-based body `{ action, ... }`, mirroring /api/admin/quota. Gated
 * identically to /admin: sync requireAdmin, then live revalidateAdmin keyed by
 * the OIDC sub (session.user.authUserId — NOT the adapter id). Per the
 * non-disclosure contract EVERY denial collapses to a bodiless 404, never a
 * 401/403, so the route's existence is not advertised.
 *
 * Actions:
 *   - qr_upsert   { qr: QrInput }        create/update a code (validates https)
 *   - qr_delete   { code: string }       delete a code
 *   - ctf_upsert  { ctf: CtfInput }      create/update a challenge
 *   - ctf_delete  { challenge: string }  delete a challenge
 *
 * QrValidationError → 400; anything else → 500 (logged, generic message).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const notFound = () => new NextResponse(null, { status: 404 });

interface AdminQrRequest {
  action: "qr_upsert" | "qr_delete" | "ctf_upsert" | "ctf_delete";
  qr?: QrInput;
  ctf?: CtfInput;
  code?: string;
  challenge?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── Gate (fail-closed; every denial → 404) ────────────────────────────────
  const session = await auth();
  if (!requireAdmin(session).ok) return notFound();
  const authUserId = session?.user?.authUserId;
  if (!authUserId || !(await revalidateAdmin(authUserId))) return notFound();

  // ── Dispatch ──────────────────────────────────────────────────────────────
  try {
    const body: AdminQrRequest = await request.json();

    switch (body.action) {
      case "qr_upsert": {
        if (!body.qr) return bad("qr payload is required");
        const code = await upsertQr(body.qr);
        return ok(`Saved code ${code}.`, { code });
      }
      case "qr_delete": {
        if (!body.code) return bad("code is required");
        await deleteQr(body.code);
        return ok(`Deleted code ${body.code.toLowerCase()}.`);
      }
      case "ctf_upsert": {
        if (!body.ctf) return bad("ctf payload is required");
        const challenge = await upsertCtf(body.ctf);
        return ok(`Saved challenge ${challenge}.`, { challenge });
      }
      case "ctf_delete": {
        if (!body.challenge) return bad("challenge is required");
        await deleteCtf(body.challenge);
        return ok(`Deleted challenge ${body.challenge.toLowerCase()}.`);
      }
      default:
        return bad("Unknown action.");
    }
  } catch (error) {
    if (error instanceof QrValidationError) {
      return bad(error.message);
    }
    console.error("[admin/qr] Error:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 }
    );
  }
}

function ok(message: string, data?: unknown): NextResponse {
  return NextResponse.json({ success: true, message, ...(data ? { data } : {}) });
}

function bad(message: string): NextResponse {
  return NextResponse.json({ success: false, message }, { status: 400 });
}
