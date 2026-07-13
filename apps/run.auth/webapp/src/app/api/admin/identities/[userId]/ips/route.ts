import { NextRequest } from "next/server";
import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin, type SessionLike } from "@/lib/admin-gate";
import { runInsights, ipsOfUserQuery, isSafeUserId, DEFAULT_WINDOW_MS } from "@/lib/insights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response(null, { status: 404 });

async function gateOk(session: SessionLike): Promise<boolean> {
  const gate = requireAdmin(session);
  if (!gate.ok) return false;
  return revalidateAdmin(session?.user?.id);
}

/** Login IPs for one identity over the last 90 days (CloudWatch Logs Insights). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const session = await auth();
  if (!(await gateOk(session))) return NOT_FOUND();

  const { userId } = await params;
  if (!isSafeUserId(userId)) return new Response(null, { status: 400 });

  const end = Date.now();
  const { rows, partial } = await runInsights(ipsOfUserQuery(userId), end - DEFAULT_WINDOW_MS, end);
  const ips = rows.map((r) => ({
    ip: r.ip ?? "",
    logins: Number(r.logins ?? 0),
    firstSeen: r.firstSeen ?? null,
    lastSeen: r.lastSeen ?? null,
    agents: Number(r.agents ?? 0),
  }));
  return Response.json({ ips, partial }, { headers: { "Cache-Control": "no-store" } });
}
