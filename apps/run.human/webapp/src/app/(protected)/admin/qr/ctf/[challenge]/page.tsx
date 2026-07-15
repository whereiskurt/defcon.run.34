import Link from "next/link";
import { notFound } from "next/navigation";

import { getCtf, getCtfCodeCounts } from "@/lib/qr-admin";
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

  // Wordlist flags (Slice 3, CTFT-14): fetch the aggregate pool status so the form
  // can render the "N codes loaded · M unclaimed" line. Only counts cross to the
  // client — a plaintext code is NEVER read back (the CtfCode entity stores only
  // hashes). Non-wordlist flags skip the read entirely.
  const codeCounts =
    record.answerType === "wordlist"
      ? await getCtfCodeCounts(record.challenge)
      : undefined;

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
          ever crosses to the "use client" form as a prop (T-54-04-01). The wordlist
          codeCounts (aggregate, non-secret) ride through so the count line renders —
          plaintext codes are never attached (only hashes exist server-side). */}
      <CtfForm
        mode="edit"
        initial={redactCtfSecrets({ ...(record as LoadedCtfRecord), codeCounts })}
      />
    </div>
  );
}
