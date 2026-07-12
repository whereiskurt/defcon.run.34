import { NextRequest } from "next/server";
import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin } from "@/lib/admin-gate";
import { resolveRunHumanMany } from "@/lib/runhuman-resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response(null, { status: 404 });
const BAD_REQUEST = () => new Response(null, { status: 400 });

export async function POST(req: NextRequest) {
  const session = await auth();
  const gate = requireAdmin(session);
  if (!gate.ok) return NOT_FOUND();
  if (!(await revalidateAdmin(session?.user?.id))) return NOT_FOUND();

  const body = await req.json().catch(() => null);
  const userIds = body?.userIds;
  if (
    !Array.isArray(userIds) ||
    userIds.length > 100 ||
    !userIds.every((x) => typeof x === "string" && x.length > 0)
  ) {
    return BAD_REQUEST();
  }

  const refs = await resolveRunHumanMany(userIds);
  return Response.json({ refs }, { headers: { "Cache-Control": "no-store" } });
}
