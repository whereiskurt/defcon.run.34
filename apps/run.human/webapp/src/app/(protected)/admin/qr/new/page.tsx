import Link from "next/link";

import QrForm from "@/components/admin/QrForm";
import { cls } from "@/components/admin/qr-ui";
import { gateAdminPage } from "../gate";

/**
 * /admin/qr/new — create a QR code. Static route; resolves before the dynamic
 * [code] route (which is why NEW is reserved as a code). Gated.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function QrNewPage() {
  await gateAdminPage();
  return (
    <div className={cls.root}>
      <div className="flex flex-col gap-2">
        <Link href="/admin/qr" className={`${cls.btn} self-start`}>
          ← QR / CTF
        </Link>
        <h1 className={cls.h1}>New QR code</h1>
      </div>
      <QrForm mode="create" />
    </div>
  );
}
