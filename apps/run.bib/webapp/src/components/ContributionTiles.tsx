"use client";

import { useEffect, useState } from "react";
import SponsorForm from "./SponsorForm";
import { CashRain } from "./CashRain";
import { getRaining, subscribe as subscribeRain } from "@/lib/rain-store";
import { getBurning, subscribe as subscribeBurn } from "@/lib/burn-store";

/**
 * ContributionTiles (Kurt 2026-07-05) — the Sponsor / Donate tile grid, made
 * CLIENT-REACTIVE so ticking or un-ticking the pay-in-person pledge instantly
 * swaps the tiles, disables/re-enables the Sponsor tile, and starts/stops the
 * cash rain over it — WITHOUT a server round-trip.
 *
 * Why a client component: the swap/disable/tile-rain used to be computed from
 * the server-side `hideBuyBib` and only refreshed on reload (we removed
 * router.refresh() to fix the prod cash-rain bug — a stale, eventually-
 * consistent getBib() re-read was killing the optimistic rain). So unchecking
 * left the Sponsor tile dimmed and still raining until a hard refresh. This
 * component instead follows the same rain/burn store singletons the checkbox
 * pushes to, so the tiles track the live pledge exactly.
 *
 * `hideBuyBib` (live) = already paid (hasSponsored, server-static this session)
 * OR pledging in person (raining) OR torched (burning).
 */
export interface ContributionTilesProps {
  /** Server truth: any money already moved on this bib (paid). Static in-session. */
  hasSponsored: boolean;
  /** Seed the live pledge state (server willPayInPerson, gated to the control). */
  initialRaining: boolean;
  /** Seed the live burn state (server bib.burned, pre-transaction). */
  initialBurning: boolean;
  runnerCode?: string;
}

export function ContributionTiles({
  hasSponsored,
  initialRaining,
  initialBurning,
  runnerCode,
}: ContributionTilesProps) {
  // Track the shared stores the ContributionChoice checkbox pushes to. Follow
  // them on AND off (unlike BibForm's one-directional server seed) — the store
  // is the source of truth for live toggles.
  const [raining, setRaining] = useState<boolean>(initialRaining);
  useEffect(() => {
    setRaining((prev) => prev || getRaining());
    return subscribeRain(setRaining);
  }, []);

  const [burning, setBurning] = useState<boolean>(initialBurning);
  useEffect(() => {
    setBurning((prev) => prev || getBurning());
    return subscribeBurn(setBurning);
  }, []);

  const isBurned = burning;
  const hideBuyBib = hasSponsored || raining || isBurned;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {/* Sponsor this bib — order-1 by default; drops below Donate and greys out
        * (disabled + dimmed + inert) once the runner pledges to pay in person or
        * has already paid (hideBuyBib). */}
      <div
        className={hideBuyBib ? "order-2" : "order-1"}
        aria-disabled={hideBuyBib || undefined}
        style={{
          minWidth: 0,
          position: "relative",
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        <div
          style={hideBuyBib ? { opacity: 0.5, pointerEvents: "none" } : undefined}
        >
          <Tile
            kicker="This"
            title="Sponsor this bib"
            body="Contributing to the event helps cover the cost of bibs and other swag. We appreciate your support."
            art={<SponsorArt />}
          >
            <SponsorForm
              variant="bib"
              ctaLabel="Sponsor"
              runnerCode={runnerCode}
              disabled={hideBuyBib}
            />
          </Tile>
        </div>
        {/* Cash rains over the disabled tile — but not when torched (fire, not cash). */}
        {hideBuyBib && !isBurned && <CashRain active />}
      </div>

      {/* Just donate — order-2 by default; rises to order-1 when Sponsor disables. */}
      <div className={hideBuyBib ? "order-1" : "order-2"} style={{ minWidth: 0 }}>
        <Tile
          kicker={hideBuyBib ? "Support" : "or That"}
          title="Just donate"
          body="This long-running event would value any financial support you'd like to give. Every year we try to provide an accessible and memorable event for all."
          art={<DonateArt />}
        >
          <SponsorForm variant="general" ctaLabel="Donate" runnerCode={runnerCode} />
        </Tile>
      </div>
    </div>
  );
}

/**
 * Tile wrapper — centered kicker + art + title + body, CTA (form) below.
 * (Moved out of page.tsx so the client tile grid owns it.)
 */
function Tile({
  kicker,
  title,
  body,
  art,
  children,
}: {
  kicker: string;
  title: string;
  body: string;
  art: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 16,
        borderRadius: 14,
        backgroundColor: "var(--bib-surface)",
        border: "1px solid var(--bib-border)",
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
          paddingBottom: 2,
        }}
      >
        <span
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 11,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "#7a9dff",
          }}
        >
          {kicker}
        </span>
        <div style={{ color: "#7a9dff" }}>{art}</div>
        <h2
          style={{
            fontSize: 20,
            fontWeight: 800,
            margin: 0,
            letterSpacing: "0.01em",
            textAlign: "center",
            color: "var(--bib-ink)",
          }}
        >
          {title}
        </h2>
        <p
          style={{
            margin: 0,
            color: "var(--bib-muted)",
            fontSize: 14,
            lineHeight: 1.5,
            textAlign: "center",
          }}
        >
          {body}
        </p>
      </div>
      <div>{children}</div>
    </section>
  );
}

/** Sponsor tile art — stylized bib silhouette with a "boost" arc. */
function SponsorArt() {
  return (
    <svg width="88" height="88" viewBox="0 0 88 88" fill="none" aria-hidden="true">
      <rect x="20" y="18" width="48" height="56" rx="4" stroke="currentColor" strokeWidth="2" />
      <circle cx="28" cy="26" r="2.5" fill="currentColor" />
      <circle cx="60" cy="26" r="2.5" fill="currentColor" />
      <rect x="26" y="34" width="36" height="22" rx="2" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="1.5" />
      <line x1="26" y1="62" x2="62" y2="62" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" />
      <rect x="32" y="66" width="24" height="6" rx="1" fill="currentColor" fillOpacity="0.4" />
      <path d="M76 14 Q66 6 56 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M56 14 L60 10 M56 14 L60 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Donate tile art — pixel-coin motif. */
function DonateArt() {
  return (
    <svg width="88" height="88" viewBox="0 0 88 88" fill="none" aria-hidden="true">
      <circle cx="52" cy="52" r="20" fill="currentColor" fillOpacity="0.15" />
      <circle cx="44" cy="44" r="24" stroke="currentColor" strokeWidth="2.5" fill="none" />
      <circle cx="44" cy="44" r="18" stroke="currentColor" strokeWidth="1.5" fill="none" strokeDasharray="4 3" />
      <text x="44" y="52" textAnchor="middle" fontSize="24" fontWeight="900" fill="currentColor" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace">$</text>
      <circle cx="20" cy="20" r="2" fill="currentColor" fillOpacity="0.7" />
      <circle cx="72" cy="16" r="1.5" fill="currentColor" fillOpacity="0.5" />
      <circle cx="16" cy="72" r="1.5" fill="currentColor" fillOpacity="0.5" />
    </svg>
  );
}

export default ContributionTiles;
