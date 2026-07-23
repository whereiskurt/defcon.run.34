"use client";

/**
 * GhostOtpPanel — reveal-on-demand of a meshtk ghost's DERIVED TOTP seed on the
 * /admin/ghosts roster (Phase 67). Hidden by default so no seed is ever in the
 * page's initial render; a click makes a separately-gated `ghost_otp_reveal`
 * round-trip (mirrors CtfForm's ctf_otp_reveal). The revealed otpauth renders
 * through the existing CtfOtpEnroll card — scannable QR + live prev/CURRENT/next
 * codes — which is exactly the "talk to the deployed bot" workflow: scan it into
 * an authenticator, include the current code in your first mesh message.
 */
import { useState } from "react";

import CtfOtpEnroll from "@/components/ctf/CtfOtpEnroll";
import { postQrAction } from "@/components/admin/qr-api";
import { cls } from "@/components/admin/qr-ui";

interface Reveal {
  configured: boolean;
  otpauth?: string;
  secret?: string;
  committedSecret?: string;
}

export default function GhostOtpPanel({
  ghostId,
  ghostName,
}: {
  ghostId: string;
  ghostName: string;
}) {
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function onReveal() {
    setBusy(true);
    setError(null);
    try {
      const res = await postQrAction({ action: "ghost_otp_reveal", ghostId });
      setReveal({
        configured: res.data?.configured === true,
        otpauth: res.data?.otpauth,
        secret: res.data?.secret,
        committedSecret: res.data?.committedSecret,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reveal failed.");
    } finally {
      setBusy(false);
    }
  }

  async function copySecret() {
    if (!reveal?.secret) return;
    try {
      await navigator.clipboard.writeText(reveal.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard denied — the secret is still visible to select manually.
    }
  }

  if (!reveal) {
    return (
      <div className="flex items-center gap-2">
        <button type="button" className={cls.btn} onClick={onReveal} disabled={busy}>
          {busy ? "Deriving…" : "Reveal derived OTP seed"}
        </button>
        {error && <span className="text-[12px] text-danger">{error}</span>}
      </div>
    );
  }

  if (!reveal.configured || !reveal.otpauth || !reveal.secret) {
    return (
      <p className="text-[12px] text-warning">
        MESHTK_GHOST_KEY_SECRET is not configured in this environment — the
        derived seed cannot be computed here. The roster stays read-only either
        way; set the secret (same SSM param as the fleet) to enable reveals.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cls.label + " mb-0"}>Derived seed (what the bot validates)</span>
        <code className="font-mono text-[12px] break-all rounded bg-content2 px-1.5 py-0.5">
          {reveal.secret}
        </code>
        <button type="button" className={cls.btn + " h-7 px-2 text-[11px]"} onClick={copySecret}>
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      {reveal.committedSecret && (
        <p className="text-[11px] text-default-400">
          Committed YAML value <code className="font-mono">{reveal.committedSecret}</code> is
          a decoy HKDF input — it validates nothing once the fleet runs derivation.
        </p>
      )}
      <CtfOtpEnroll otpauth={reveal.otpauth} flagName={ghostName} />
    </div>
  );
}
