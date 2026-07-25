"use client";

/**
 * CtfOtpEnroll — the player-facing `otp-enroll` reward reveal (CTFT-08, Surface B).
 *
 * Rendered ONLY on the visible, authenticated ClaimClient credited-solve branch
 * (and, after 54-04, the admin reveal-preview) — never on the CSS reward channel,
 * which stays reward-free and byte-identical. It hands the solver the enrollment
 * seed for a chained rotating-OTP flag:
 *   - a scannable QR of the raw `otpauth://` string (client-rendered via the
 *     already-present `qrcode` dep, on a white quiet-zone so it stays high-contrast
 *     in either theme);
 *   - the rolling previous / CURRENT / next 6-digit code with a live countdown,
 *     computed in the browser via `adjacentCodesAsync` (Web Crypto, 54-02);
 *   - an "Add to Authenticator" `otpauth://` deep link + a "Copy setup link"
 *     affordance;
 *   - an optional "This unlocks: {nextFlag}" chaining line.
 *
 * Surface B (57-02) restyle: the card is self-contained BESPOKE-DARK — it commits
 * to the mockup's scoped "terminal" palette regardless of the viewer's app theme,
 * so the raw hex below is intentional and correct (the ONE place raw hex is allowed).
 * The QR itself is UNCHANGED (dark modules on a white quiet-zone, frozen
 * qr.toDataURL params) — polish is framing only (rounded border + soft outer glow).
 * ZERO logic change: parseOtpauth, adjacentCodesAsync, the isSupportedAlgorithm
 * fallback (WR-02), the silent no-op on an unparseable seed, the aria-live roll
 * announcement, and the nextFlag conditional are all preserved verbatim.
 *
 * Browser-only crypto: imports ONLY the node-free `ctf-otp-core` (parseOtpauth)
 * and `ctf-otp-client` (adjacentCodesAsync via globalThis.crypto.subtle). It never
 * imports the node-backed `ctf-otp.ts`, so no node crypto reaches the client bundle.
 * A malformed/unparseable otpauth makes the component render nothing (the base
 * solve-success card still shows).
 */

import { useEffect, useMemo, useState } from "react";
import * as qr from "qrcode";
import { parseOtpauth } from "@/lib/ctf-otp-core";
import type { AdjacentCodes, OtpConfig } from "@/lib/ctf-otp-core";
import { adjacentCodesAsync, isSupportedAlgorithm } from "@/lib/ctf-otp-client";
import { dailyClaimHref } from "@/lib/ctf-otp-enroll";

const isDev = process.env.NODE_ENV !== "production";
const region = process.env.NEXT_PUBLIC_REGION_SHORT || "use1";

/**
 * Scoped bespoke-dark palette (57-UI-SPEC "Surface B palette"). Hardcoded hex is
 * intentional here — this card renders dark over EITHER app theme, so it must not
 * depend on HeroUI theme tokens. Do NOT leak these darks outside this component.
 */
const B = {
  card: "#15181d",
  line: "#262b33",
  line2: "#333a44",
  ink: "#e7ecf2",
  muted: "#8b95a3",
  faint: "#616b78",
  cyan: "#38bdf8",
  mint: "#4ade80",
} as const;

interface Props {
  /** The `otpauth://totp/...` enrollment URL (already narrowed by asOtpEnrollEffect). */
  otpauth: string;
  /** Optional NAME of the flag this enrollment unlocks (chaining hint). */
  nextFlag?: string;
  /** Optional NAME of the solved flag/challenge, for the "✓ Correct — {name} solved"
   *  header. Display copy only — absent ⇒ the header falls back to "✓ Correct". */
  flagName?: string;
}

export default function CtfOtpEnroll({ otpauth, nextFlag, flagName }: Props) {
  // Parse once. Defensive: the dispatch already narrowed via parseOtpauth, but a
  // parse failure here must no-op silently (the base success card still shows).
  const parsed: OtpConfig | null = useMemo(() => {
    try {
      return parseOtpauth(otpauth);
    } catch {
      return null;
    }
  }, [otpauth]);

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [codes, setCodes] = useState<AdjacentCodes | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [announce, setAnnounce] = useState("");

  // Render the QR from the RAW otpauth string to a data URL on a white quiet zone.
  useEffect(() => {
    let alive = true;
    qr.toDataURL(otpauth, {
      width: 220,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { light: "#ffffff", dark: "#000000" },
    })
      .then((url) => {
        if (alive) setQrDataUrl(url);
      })
      .catch(() => {
        /* QR failed to render — the manual deep link + copy remain a non-scan path. */
      });
    return () => {
      alive = false;
    };
  }, [otpauth]);

  // Rolling code + countdown. A single 1s interval recomputes the displayed
  // seconds every tick (self-correcting off Date.now, no drift) and re-fetches
  // the adjacent codes only when the period index rolls. Cleared on unmount.
  // WR-02: honor the enrollment URL's algorithm. `adjacentCodesAsync` now supports
  // SHA1/256/512; anything else can't be computed in-browser, so skip the interval
  // and render an explicit note (below) instead of a permanent `······` placeholder.
  const algoSupported = parsed ? isSupportedAlgorithm(parsed.algorithm) : false;

  useEffect(() => {
    if (!parsed || !algoSupported) return;
    const { secret, digits, period, algorithm } = parsed;
    let alive = true;
    let lastPeriodIndex = -1;

    const tick = async () => {
      const now = Math.floor(Date.now() / 1000);
      const idx = Math.floor(now / period);
      if (idx !== lastPeriodIndex) {
        const isFirst = lastPeriodIndex === -1;
        lastPeriodIndex = idx;
        try {
          const next = await adjacentCodesAsync(secret, now, { digits, period, algorithm });
          if (alive) setCodes(next);
        } catch {
          /* leave the last-known codes in place */
        }
        if (alive && !isFirst) setAnnounce("New code available");
      }
      if (alive) setRemaining(period - (now % period));
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [parsed, algoSupported]);

  // Unparseable seed → no-op (the standard solve-success card still shows).
  if (!parsed) return null;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(otpauth);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the deep link is still available */
    }
  };

  // Progress fill: remaining / period, clamped to [0,100]. Driven purely by the
  // EXISTING `remaining` state + parsed `period` — no new timer/interval.
  const progressPct =
    remaining != null ? Math.max(0, Math.min(100, (remaining / parsed.period) * 100)) : 0;

  return (
    <div
      className="w-full max-w-[380px] flex flex-col items-center gap-3.5 text-center"
      style={{
        background: B.card,
        border: `1px solid ${B.line}`,
        borderRadius: 14,
        padding: 18,
      }}
    >
      <h3
        className="font-museo text-lg font-semibold"
        style={{ color: B.mint, lineHeight: 1.3 }}
      >
        {flagName ? `✓ Correct - ${flagName} solved` : "✓ Correct"}
      </h3>

      {/* QR on a fixed white quiet zone - high contrast regardless of theme. The
          quiet-zone card + <img> are UNCHANGED (D2); framing is a rounded border
          + a soft OUTER glow only. Modules and pupils are never touched. */}
      <div
        className="rounded-lg bg-white p-2 flex items-center justify-center min-h-[220px] min-w-[220px]"
        style={{
          border: `1px solid ${B.line}`,
          boxShadow: `0 0 22px rgba(74, 222, 128, 0.14), 0 0 22px rgba(56, 189, 248, 0.10)`,
        }}
      >
        {qrDataUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qrDataUrl}
            alt="Authenticator enrollment QR code"
            aria-label="Authenticator enrollment QR code"
            width={200}
            height={200}
            className="h-[200px] w-[200px]"
          />
        )}
      </div>
      <p className="text-[12.5px]" style={{ color: B.muted, lineHeight: 1.5 }}>
        Scan with your authenticator app
      </p>

      {/* Rolling previous / CURRENT / next code, current as the cyan 40px hero. When
          the enrollment URL declares an algorithm the browser can't compute (not
          SHA1/256/512), show an explicit note instead of a stuck placeholder (WR-02). */}
      {algoSupported ? (
        <div className="flex flex-col items-center gap-1.5 w-full">
          <span
            className="font-mono text-[10.5px] font-semibold uppercase"
            style={{ color: B.faint, letterSpacing: ".08em" }}
          >
            Current code
          </span>
          <div className="flex items-end justify-center gap-3">
            <span
              className="font-mono text-[12px] font-semibold tabular-nums"
              style={{ color: B.muted, lineHeight: 1.2 }}
              aria-hidden="true"
            >
              {codes?.previous ?? "······"}
            </span>
            <span
              className="font-mono font-bold tabular-nums"
              style={{
                color: B.cyan,
                fontSize: 40,
                lineHeight: 1.1,
                letterSpacing: ".12em",
              }}
            >
              {codes?.current ?? "······"}
            </span>
            <span
              className="font-mono text-[12px] font-semibold tabular-nums"
              style={{ color: B.muted, lineHeight: 1.2 }}
              aria-hidden="true"
            >
              {codes?.next ?? "······"}
            </span>
          </div>
          <div
            className="flex justify-between w-full px-1 font-mono text-[10.5px] font-semibold uppercase"
            style={{ color: B.faint, letterSpacing: ".08em" }}
          >
            <span aria-hidden="true">Previous</span>
            <span aria-hidden="true">Next</span>
          </div>

          {/* Gradient countdown bar - REPLACES the plain "New code in Ns" text line.
              Width is driven off the EXISTING `remaining`/`period` state (no new
              timer). The bar is an accessible progressbar so the countdown stays
              available to AT after the visible text line is gone. */}
          <div
            className="w-full rounded-full overflow-hidden mt-1"
            style={{ height: 6, background: B.line2 }}
            role="progressbar"
            aria-label="Time until the code rolls"
            aria-valuemin={0}
            aria-valuemax={parsed.period}
            aria-valuenow={remaining ?? 0}
            aria-valuetext={
              remaining != null ? `New code in ${remaining} seconds` : undefined
            }
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${progressPct}%`,
                background: `linear-gradient(90deg, ${B.cyan}, ${B.mint})`,
                transition: "width 1s linear",
              }}
            />
          </div>

          {/* Announce only on period roll, not every second. */}
          <span className="sr-only" aria-live="polite">
            {announce}
          </span>
        </div>
      ) : (
        <p className="text-[12.5px]" style={{ color: B.muted, lineHeight: 1.5 }}>
          Rolling codes can&apos;t be shown here for{" "}
          <span className="font-mono" style={{ color: B.ink }}>
            {parsed.algorithm}
          </span>{" "}
          - scan the QR or use the setup link, and your authenticator will show the
          code.
        </p>
      )}

      {/* Actions: full-width mint primary deep link + neutral copy affordance. */}
      <div className="flex flex-col items-center gap-2 w-full">
        <a
          href={otpauth}
          className="inline-flex items-center justify-center w-full h-9 rounded-lg font-mono text-[12.5px] font-semibold"
          style={{
            border: `1px solid ${B.mint}`,
            background: "rgba(74, 222, 128, 0.14)",
            color: B.mint,
          }}
        >
          ＋ Add to Authenticator
        </a>
        <button
          type="button"
          onClick={copyLink}
          className="inline-flex items-center justify-center w-full h-9 rounded-lg text-[12.5px] font-semibold"
          style={{
            border: `1px solid ${B.line}`,
            background: "transparent",
            color: B.muted,
          }}
        >
          {copied ? "Copied" : "Copy setup link"}
        </button>
      </div>

      {nextFlag && (
        <p
          className="w-full text-[12.5px] rounded-lg px-3 py-2"
          style={{
            color: B.cyan,
            background: "rgba(56, 189, 248, 0.07)",
            border: "1px solid rgba(56, 189, 248, 0.25)",
            lineHeight: 1.5,
          }}
        >
          🔗 This unlocks:{" "}
          <span className="font-mono" style={{ color: B.cyan }}>
            {nextFlag}
          </span>
        </p>
      )}

      {/* One-tap daily claim: submits the CURRENT rolling code to the chained
          flag through the standard claim route — same thing typing the code
          would do, so unlockAfter + the 24h interval still gate it. The href
          re-renders with each code roll, so it is always the live code. This
          doubles as the how-to: come back tomorrow, read the code from your
          authenticator, submit it again. */}
      {(() => {
        const claimNow = dailyClaimHref(nextFlag, codes?.current, { isDev, region });
        if (!claimNow) return null;
        return (
          <div className="flex flex-col items-center gap-1.5 w-full">
            <a
              href={claimNow}
              className="inline-flex items-center justify-center w-full h-9 rounded-lg font-mono text-[12.5px] font-semibold"
              style={{
                border: `1px solid ${B.cyan}`,
                background: "rgba(56, 189, 248, 0.14)",
                color: B.cyan,
              }}
            >
              🎰 Claim your daily +100 now
            </a>
            <p className="text-[11.5px]" style={{ color: B.faint, lineHeight: 1.5 }}>
              Submits the current code for you. Come back every day and enter the
              code from your authenticator for another +100.
            </p>
          </div>
        );
      })()}
    </div>
  );
}
