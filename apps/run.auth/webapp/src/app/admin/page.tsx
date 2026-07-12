import { notFound } from "next/navigation";
import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin } from "@/lib/admin-gate";
import { scanAuthProfiles, scanAllAccounts } from "@/entities/admin-identity";
import { mergeIdentityRows, sortRows, summaryTiles, type AccountRow } from "@/lib/identity-report";
import AdminConsole from "./AdminConsole";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminIdentitiesPage() {
  const session = await auth();
  const gate = requireAdmin(session);
  if (!gate.ok) notFound();
  if (!(await revalidateAdmin(session?.user?.id))) notFound();

  const [profiles, accounts] = await Promise.all([scanAuthProfiles(), scanAllAccounts()]);
  // scanAllAccounts() returns a FLAT AccountRow[] (no `sk` field) — fold it
  // directly into userId -> AccountRow[] rather than calling
  // groupAccountsByUser (which filters on `sk.startsWith("ACCOUNT#")` and
  // would silently zero every identity's providers).
  const accountsByUser = accounts.reduce<Record<string, AccountRow[]>>((acc, a) => {
    (acc[a.userId] ??= []).push(a);
    return acc;
  }, {});
  const rows = sortRows(mergeIdentityRows(profiles, accountsByUser), "created");
  const tiles = summaryTiles(rows);

  // Full emails ARE handed to the client here: this route is admin-gated with
  // non-disclosure 404 for everyone else and seen only by trusted admins, so the
  // console searches + reveals full emails client-side (see AdminConsole `reveal`).
  return <AdminConsole initialRows={rows} tiles={tiles} adminEmail={gate.email} />;
}
