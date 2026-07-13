import { notFound } from "next/navigation";

import QrSheetDesigner from "@/components/admin/QrSheetDesigner";
import { cls } from "@/components/admin/qr-ui";
import { auth } from "@/config/auth";
import {
  QR_ADMIN_GROUPS,
  requireGroups,
  revalidateGroups,
} from "@/lib/admin-gate";

/**
 * /user/qr/sheet — the QR sheet designer OUTSIDE the /admin/* path.
 *
 * Identical tool and identical gate to /admin/qr/sheet (admin | runadmin |
 * qradmin, live-revalidated, denial → 404). It exists so qradmin operators
 * have a working surface when /admin/* is walled off by edge/WAF rules —
 * give someone qradmin and point them here; they never need /admin.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function UserQrSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string | string[] }>;
}) {
  const session = await auth();
  if (!requireGroups(session, QR_ADMIN_GROUPS).ok) notFound();
  const authUserId = session?.user?.authUserId;
  if (!authUserId || !(await revalidateGroups(authUserId, QR_ADMIN_GROUPS)))
    notFound();

  const { url } = await searchParams;
  const raw = typeof url === "string" ? url : "";
  const initialUrl = /^https?:\/\/\S+$/.test(raw) ? raw : "";

  return (
    <div className={cls.root}>
      <div className="flex flex-col gap-2">
        <h1 className={cls.h1}>
          QR sheet designer<span className="teal-dot">.</span>
        </h1>
        <p className={cls.sub}>
          Style a QR code and download a printable US-Letter PDF — grids with
          fold lines, or Avery label stock. Everything renders in your browser.
        </p>
      </div>
      <QrSheetDesigner initialUrl={initialUrl} />
    </div>
  );
}
