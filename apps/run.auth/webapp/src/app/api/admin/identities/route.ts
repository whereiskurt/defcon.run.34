import { NextRequest } from "next/server";
import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin } from "@/lib/admin-gate";
import { scanAuthProfiles, scanAllAccounts } from "@/entities/admin-identity";
import {
  mergeIdentityRows,
  filterByEmail,
  sortRows,
  toCsv,
  type IdentitySort,
  type IdentityRow,
  type AccountRow,
} from "@/lib/identity-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response(null, { status: 404 });

function maskRow(r: IdentityRow) {
  const { emailFull: _drop, ...rest } = r;
  return rest;
}

/** Fold the already-flattened AccountRow[] (from scanAllAccounts) into userId → AccountRow[]. */
function groupByUserId(accounts: AccountRow[]): Record<string, AccountRow[]> {
  const out: Record<string, AccountRow[]> = {};
  for (const a of accounts) {
    (out[a.userId] ??= []).push(a);
  }
  return out;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  const gate = requireAdmin(session);
  if (!gate.ok) return NOT_FOUND();
  if (!(await revalidateAdmin(session?.user?.id))) return NOT_FOUND();

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const sort = (url.searchParams.get("sort") as IdentitySort) || "created";
  const format = url.searchParams.get("format");

  const [profiles, accounts] = await Promise.all([scanAuthProfiles(), scanAllAccounts()]);
  const accountsByUser = groupByUserId(accounts);
  let rows = sortRows(mergeIdentityRows(profiles, accountsByUser), sort);
  if (q) rows = filterByEmail(rows, q);

  if (format === "csv") {
    const columns = [
      { key: "displayName", header: "displayName" },
      { key: "emailFull", header: "email" },
      { key: "providersJoined", header: "providers" },
      { key: "lastProvider", header: "lastProvider" },
      { key: "createdAtIso", header: "createdAt" },
      { key: "services", header: "services" },
      { key: "lockedOut", header: "lockedOut" },
      { key: "jailed", header: "jailed" },
      { key: "jailLevel", header: "jailLevel" },
      { key: "userId", header: "userId" },
    ];
    const csvRows = rows.map((r) => ({
      ...r,
      providersJoined: r.providers.join("|"),
      createdAtIso: r.createdAt ? new Date(r.createdAt).toISOString() : "",
      services: r.services.join("|"),
    }));
    const today = new Date().toISOString().slice(0, 10);
    return new Response(toCsv(columns, csvRows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="auth-identities-${today}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return Response.json({ rows: rows.map(maskRow) }, { headers: { "Cache-Control": "no-store" } });
}
