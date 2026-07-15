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
 * Browser-only crypto: imports ONLY the node-free `ctf-otp-core` (parseOtpauth)
 * and `ctf-otp-client` (adjacentCodesAsync via globalThis.crypto.subtle). It never
 * imports the node-backed `ctf-otp.ts`, so no node crypto reaches the client bundle.
 * A malformed/unparseable otpauth makes the component render nothing (the base
 * solve-success card still shows).
 */

import { useEffect, useMemo, useState } from "react";
import * as qr from "qrcode";
import { cls } from "@/components/admin/qr-ui";
import { parseOtpauth } from "@/lib/ctf-otp-core";
import type { AdjacentCodes, OtpConfig } from "@/lib/ctf-otp-core";
import { adjacentCodesAsync, isSupportedAlgorithm } from "@/lib/ctf-otp-client";

interface Props {
  /** The `otpauth://totp/...` enrollment URL (already narrowed by asOtpEnrollEffect). */
  otpauth: string;
  /** Optional NAME of the flag this enrollment unlocks (chaining hint). */
  nextFlag?: string;
}

export default function CtfOtpEnroll({ otpauth, nextFlag }: Props) {
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

  return (
    <div className={`${cls.card} w-full max-w-[380px] p-4 flex flex-col items-center gap-4 text-center`}>
      <h3 className="font-museo text-lg font-semibold text-success">
        You unlocked an authenticator code
      </h3>

      {/* QR on a fixed white quiet zone — high contrast regardless of theme. */}
      <div className="rounded-lg bg-white p-2 flex items-center justify-center min-h-[220px] min-w-[220px]">
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
      <p className={cls.sub}>Scan with your authenticator app</p>

      {/* Rolling previous / CURRENT / next code, current as the mono hero. When the
          enrollment URL declares an algorithm the browser can't compute (not
          SHA1/256/512), show an explicit note instead of a stuck placeholder (WR-02). */}
      {algoSupported ? (
        <div className="flex flex-col items-center gap-1">
          <span className={cls.label}>Current code</span>
          <div className="flex items-end justify-center gap-3">
            <span className="font-mono text-[13px] text-default-400" aria-hidden="true">
              {codes?.previous ?? "······"}
            </span>
            <span className="font-mono text-[28px] font-semibold tracking-wide text-primary">
              {codes?.current ?? "······"}
            </span>
            <span className="font-mono text-[13px] text-default-400" aria-hidden="true">
              {codes?.next ?? "······"}
            </span>
          </div>
          <div className="flex justify-between w-full px-1 text-[10px] uppercase tracking-wide text-default-400">
            <span aria-hidden="true">Previous</span>
            <span aria-hidden="true">Next</span>
          </div>
          <p className="text-[12.5px] text-default-500">
            New code in{" "}
            <span aria-hidden="true">{remaining ?? "—"}s</span>
          </p>
          {/* Announce only on period roll, not every second. */}
          <span className="sr-only" aria-live="polite">
            {announce}
          </span>
        </div>
      ) : (
        <p className="text-[12.5px] text-default-500">
          Rolling codes can&apos;t be shown here for{" "}
          <span className="font-mono text-foreground">{parsed.algorithm}</span> — scan
          the QR or use the setup link, and your authenticator will show the code.
        </p>
      )}

      {/* Actions: primary deep link + copy affordance. */}
      <div className="flex flex-col items-center gap-2 w-full">
        <a href={otpauth} className={`${cls.btnPrimary} w-full justify-center`}>
          Add to Authenticator
        </a>
        <button type="button" onClick={copyLink} className={`${cls.btn} w-full justify-center`}>
          {copied ? "Copied" : "Copy setup link"}
        </button>
        <p className="text-[12.5px] text-default-400">Or tap Add to Authenticator</p>
      </div>

      {nextFlag && (
        <p className="text-sm text-default-500">
          This unlocks: <span className="font-mono text-foreground">{nextFlag}</span>
        </p>
      )}
    </div>
  );
}
