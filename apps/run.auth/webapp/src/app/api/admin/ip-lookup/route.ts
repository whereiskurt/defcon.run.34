import { NextRequest } from "next/server";
import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin, type SessionLike } from "@/lib/admin-gate";
import { runInsights, usersOfIpQuery, isValidIp, DEFAULT_WINDOW_MS } from "@/lib/insights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response(null, { status: 404 });

async function gateOk(session: SessionLike): Promise<boolean> {
  const gate = requireAdmin(session);
  if (!gate.ok) return false;
  return revalidateAdmin(session?.user?.id);
}

/** Identities that logged in from a given IP over the last 90 days. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!(await gateOk(session))) return NOT_FOUND();

  const ip = (new URL(req.url).searchParams.get("ip") ?? "").trim();
  if (!isValidIp(ip)) return new Response(null, { status: 400 });

  const end = Date.now();
  const { rows, partial } = await runInsights(usersOfIpQuery(ip), end - DEFAULT_WINDOW_MS, end);
  const users = rows.map((r) => ({
    userId: r.userId ?? "",
    email: r.email ?? null,
    logins: Number(r.logins ?? 0),
    firstSeen: r.firstSeen ?? null,
    lastSeen: r.lastSeen ?? null,
  }));
  return Response.json({ users, partial }, { headers: { "Cache-Control": "no-store" } });
}
