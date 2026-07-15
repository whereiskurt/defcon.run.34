import Link from "next/link";
import { notFound } from "next/navigation";

import { getCtf } from "@/lib/qr-admin";
import CtfForm from "@/components/admin/CtfForm";
import {
  redactCtfSecrets,
  type LoadedCtfRecord,
} from "@/components/admin/ctf-form-model";
import { cls } from "@/components/admin/qr-ui";
import { gateAdminPage } from "../../gate";

/**
 * /admin/qr/ctf/[challenge] — edit a CTF challenge. Gated. 404s if the challenge
 * does not exist (the static /admin/qr/ctf/new route handles creates).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function CtfEditPage({
  params,
}: {
  params: Promise<{ challenge: string }>;
}) {
  await gateAdminPage();
  const { challenge } = await params;

  const record = await getCtf(challenge);
  if (!record) notFound();

  return (
    <div className={cls.root}>
      <div className="flex flex-col gap-2">
        <Link href="/admin/qr" className={`${cls.btn} self-start`}>
          ← QR / CTF
        </Link>
        <h1 className={cls.h1}>
          Edit challenge{" "}
          <span className="text-primary font-mono">{record.challenge}</span>
        </h1>
      </div>
      {/* Redact write-only fields (otp seed + effect payload) before the record
          ever crosses to the "use client" form as a prop (T-54-04-01). */}
      <CtfForm mode="edit" initial={redactCtfSecrets(record as LoadedCtfRecord)} />
    </div>
  );
}
