import { notFound } from "next/navigation";

import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin } from "@/lib/admin-gate";

/**
 * Shared /admin/qr page gate. Mirrors src/app/admin/page.tsx exactly: sync
 * requireAdmin, then a LIVE revalidateAdmin keyed by the OIDC sub
 * (session.user.authUserId — NOT the adapter id). Every denial → notFound()
 * (404), never a 403, so the route's existence is not advertised. Returns the
 * admin's email for the header when admitted.
 */
export async function gateAdminPage(): Promise<{ email: string | null }> {
  const session = await auth();
  const gate = requireAdmin(session);
  if (!gate.ok) notFound();

  const authUserId = session?.user?.authUserId;
  if (!authUserId || !(await revalidateAdmin(authUserId))) notFound();

  return { email: gate.email };
}
