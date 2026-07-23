"use client";

/**
 * GhostSheetButton — "Print QR sheet" on /admin/ghosts (Phase 67). Reveals the
 * derived otpauth seed for EVERY OTP-bearing ghost via the admin-gated
 * `ghost_otp_reveal` action (one round-trip per ghost — 8 today, trivial),
 * then composes a printable PDF client-side with buildGhostOtpSheetPdf: one
 * styled QR + name label per cell, on a large-cell grid (3×3 default, 3×5
 * alternative — the QrSheetDesigner's small-cell presets scan poorly for
 * otpauth payloads, which are much denser than q.defcon.run URLs).
 *
 * QRs render through the shared renderQrPng in the plain black-on-white
 * "classic" style — no logo, no light pupils (light eye colors break scanners;
 * see the runner-QR-card landmine) — with the adaptive EC ladder.
 *
 * The PDF never touches the server: reveals come from the gated action, the
 * sheet is assembled and downloaded in-browser.
 */
import { useState } from "react";

import { postQrAction } from "@/components/admin/qr-api";
import { cls } from "@/components/admin/qr-ui";
import {
  buildGhostOtpSheetPdf,
  ghostSheetFilename,
  type GhostSheetEntry,
} from "@/components/admin/qr-sheet/ghost-sheet";
import { renderQrPng } from "@/components/admin/qr-sheet/render";
import { parseTemplate } from "@/components/admin/qr-sheet/templates";
import type { QrStyle } from "@/components/admin/qr-sheet/styles";

/** Plain black-on-white modules — maximum scanner compatibility. */
const SHEET_STYLE: QrStyle = {
  moduleShape: "square",
  moduleColor: "#000000",
  background: "#ffffff",
  eyeShape: "square",
  eyeColor: "#000000",
};

const LAYOUTS = [
  { value: "3x3", label: "3×3 (large)" },
  { value: "3x5", label: "3×5 (medium)" },
] as const;

export default function GhostSheetButton({
  otpGhosts,
}: {
  /** OTP-bearing ghosts, server-provided (ids + display names only). */
  otpGhosts: { ghostId: string; name: string }[];
}) {
  const [layoutValue, setLayoutValue] = useState<string>("3x3");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPrint() {
    setBusy(true);
    setError(null);
    try {
      const entries: GhostSheetEntry[] = [];
      for (const g of otpGhosts) {
        const res = await postQrAction({
          action: "ghost_otp_reveal",
          ghostId: g.ghostId,
        });
        if (res.data?.configured !== true || !res.data.otpauth || !res.data.secret) {
          throw new Error(
            "MESHTK_GHOST_KEY_SECRET is not configured — derived seeds unavailable.",
          );
        }
        entries.push({
          url: res.data.otpauth,
          title: g.name,
          subtitle: g.ghostId,
          secret: res.data.secret,
        });
      }

      const layout = parseTemplate(layoutValue);
      if (!layout) throw new Error(`Bad layout ${layoutValue}`);
      const bytes = await buildGhostOtpSheetPdf({
        entries,
        layout,
        renderPng: (u, px, lvl) => renderQrPng(u, SHEET_STYLE, px, lvl ?? "auto"),
      });

      const blob = new Blob([bytes as unknown as ArrayBuffer], {
        type: "application/pdf",
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = ghostSheetFilename(layout);
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate the sheet.");
    } finally {
      setBusy(false);
    }
  }

  if (otpGhosts.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <select
        aria-label="Sheet layout"
        className={cls.select + " w-auto"}
        value={layoutValue}
        onChange={(e) => setLayoutValue(e.target.value)}
        disabled={busy}
      >
        {LAYOUTS.map((l) => (
          <option key={l.value} value={l.value}>
            {l.label}
          </option>
        ))}
      </select>
      <button type="button" className={cls.btn} onClick={onPrint} disabled={busy}>
        {busy ? "Composing…" : `🖨 Print QR sheet (${otpGhosts.length})`}
      </button>
      {error && <span className="text-[12px] text-danger">{error}</span>}
    </div>
  );
}
