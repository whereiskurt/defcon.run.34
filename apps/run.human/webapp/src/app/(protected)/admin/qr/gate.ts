import { notFound } from "next/navigation";

import { auth } from "@/config/auth";
import {
  QR_ADMIN_GROUPS,
  requireGroups,
  revalidateGroups,
} from "@/lib/admin-gate";

/**
 * Shared /admin/qr page gate. Mirrors src/app/admin/page.tsx: sync group
 * check, then a LIVE revalidation keyed by the OIDC sub
 * (session.user.authUserId — NOT the adapter id). Admits QR_ADMIN_GROUPS
 * (admin | runadmin | qradmin) — qradmin unlocks ONLY the /admin/qr area,
 * never /admin root. Every denial → notFound() (404), never a 403, so the
 * route's existence is not advertised. Returns the admin's email for the
 * header when admitted.
 */
export async function gateAdminPage(): Promise<{ email: string | null }> {
  const session = await auth();
  const gate = requireGroups(session, QR_ADMIN_GROUPS);
  if (!gate.ok) notFound();

  const authUserId = session?.user?.authUserId;
  if (!authUserId || !(await revalidateGroups(authUserId, QR_ADMIN_GROUPS)))
    notFound();

  return { email: gate.email };
}
