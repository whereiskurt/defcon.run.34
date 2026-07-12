import Link from "next/link";

import CtfForm from "@/components/admin/CtfForm";
import { cls } from "@/components/admin/qr-ui";
import { gateAdminPage } from "../../gate";

/**
 * /admin/qr/ctf/new — create a CTF challenge. Static route; resolves before the
 * dynamic [challenge] route (which is why `new` is reserved). Gated.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function CtfNewPage() {
  await gateAdminPage();
  return (
    <div className={cls.root}>
      <div className="flex flex-col gap-2">
        <Link href="/admin/qr" className={`${cls.btn} self-start`}>
          ← QR / CTF
        </Link>
        <h1 className={cls.h1}>New CTF challenge</h1>
      </div>
      <CtfForm mode="create" />
    </div>
  );
}
