"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import StyledRunnerQr from "./StyledRunnerQr";
import { flairParams, MILESTONES } from "./flairBands";
import type { Band } from "@/lib/social-rank";

const isDev = process.env.NODE_ENV !== "production";
const region = process.env.NEXT_PUBLIC_REGION_SHORT || "use1";
const prefix = isDev ? "" : `/${region}`;

const MAGENTA = "#c4157a";
const GOLD = "#ffd257";
const GREEN = "#33ff99";

export type SocialInfo = {
  score: number;
  band: Band;
  badges: { bibHolder: boolean; egg: boolean };
  remainingToday: number;
  /** Admin/runadmin only: unlocks attendance mode in the camera scanner. */
  attendance?: boolean;
};

interface Props {
  hash?: string;
  eqrFallback?: string;
  social: SocialInfo;
  alt?: string;
}

/**
 * "Reactor Tuned" social QR flair (sketch 003-D): conic reactor ring, halo
 * bloom, translucent scanline, badge rail, rank readout with NEXT-unlock
 * teaser, gold LEADER state — all driven by the relative rank band from
 * /api/user. The QR itself (StyledRunnerQr) is untouched; every ornament
 * lives outside the white card except the capped translucent scanline.
 *
 * Hidden DC-jack egg: hold the center logo 1.5s (charge ring appears at
 * 200ms) or triple-tap it → POST /api/social-egg (awards CTF points once
 * ever; the response body's `ok` field is the source of truth, not HTTP
 * status — a 200 with `{ ok: false }` means nothing was awarded). No visual
 * cue before discovery.
 */
export default function SocialQrFlair({ hash, eqrFallback, social, alt }: Props) {
  const p = flairParams(social.band.tier);
  const flair = p.gold ? GOLD : MAGENTA;
  const flairSoft = p.gold
    ? "rgba(255, 210, 87, 0.55)"
    : "rgba(196, 21, 122, 0.55)";

  // ---- egg state -----------------------------------------------------------
  const [eggClaimed, setEggClaimed] = useState(social.badges.egg);
  const [eggToast, setEggToast] = useState<string | null>(null);
  const [holding, setHolding] = useState(false);
  const [burst, setBurst] = useState(0);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taps = useRef<number[]>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string, ms: number) => {
    setEggToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setEggToast(null), ms);
  }, []);

  const claimEgg = useCallback(
    async (via: "hold" | "tap") => {
      if (eggClaimed) {
        showToast("COVERT CHANNEL ALREADY DRAINED", 1800);
        return;
      }
      setEggClaimed(true); // optimistic; server row is the source of truth
      setBurst((n) => n + 1);
      try {
        const res = await fetch(`${prefix}/api/social-egg`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ via }),
        });
        // The server always answers HTTP 200 — a non-solve is `{ ok: false }`
        // in the BODY, not an HTTP error. Branch on the body, never res.ok.
        const body: { ok?: boolean; points?: number } | null = await res
          .json()
          .catch(() => null);
        if (body?.ok) {
          const award =
            typeof body.points === "number" && body.points > 0
              ? ` // +${body.points} CTF`
              : "";
          showToast(`⚑ COVERT CHANNEL FOUND${award}`, 4200);
        } else {
          setEggClaimed(false); // not actually awarded — allow a retry
          showToast("COVERT CHANNEL SEALED — TRY AGAIN", 2200);
        }
      } catch {
        setEggClaimed(false);
        showToast("COVERT CHANNEL SEALED — TRY AGAIN", 2200);
      }
    },
    [eggClaimed, showToast]
  );

  const cancelHold = useCallback(() => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (cueTimer.current) clearTimeout(cueTimer.current);
    setHolding(false);
  }, []);

  const onEggDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const now = Date.now();
      taps.current = taps.current.filter((t) => now - t < 900);
      taps.current.push(now);
      if (taps.current.length >= 3) {
        taps.current = [];
        cancelHold();
        void claimEgg("tap");
        return;
      }
      cueTimer.current = setTimeout(() => setHolding(true), 200);
      holdTimer.current = setTimeout(() => {
        cancelHold();
        void claimEgg("hold");
      }, 1500);
    },
    [cancelHold, claimEgg]
  );

  useEffect(() => () => cancelHold(), [cancelHold]);

  // ---- badges --------------------------------------------------------------
  const badges: Array<{
    id: string;
    glyph: string;
    cap: string;
    name: string;
    state: "earned" | "locked";
    color: "amber" | "magenta" | "green";
  }> = [];
  if (eggClaimed) {
    badges.push({ id: "egg", glyph: "⚑", cap: "EGG", name: "COVERT CHANNEL", state: "earned", color: "amber" });
  }
  if (social.badges.bibHolder) {
    badges.push({ id: "bib", glyph: "BIB", cap: "HOLDER", name: "BIB HOLDER", state: "earned", color: "amber" });
  }
  for (const m of MILESTONES) {
    badges.push({
      id: m.id,
      glyph: m.glyph,
      cap: m.cap,
      name: m.name,
      state: social.score >= m.threshold ? "earned" : "locked",
      color: m.color,
    });
  }

  const ticks = [0, 1, 2, 3, 4, 5];

  return (
    <div className="sqf-root" data-gold={p.gold ? "1" : "0"}>
      <style>{`
        .sqf-root { --sqf-flair: ${flair}; --sqf-flair-soft: ${flairSoft}; display: flex; flex-direction: column; align-items: center; gap: 12px; }
        .sqf-wrap { position: relative; padding: 34px; }
        .sqf-halo { position: absolute; inset: 4px; border-radius: 40px; pointer-events: none;
          background: radial-gradient(closest-side, var(--sqf-flair-soft), transparent 72%);
          filter: blur(34px); opacity: ${p.haloOpacity}; transition: opacity 0.6s ease; }
        ${p.gold ? ".sqf-halo { animation: sqf-breathe 3s ease-in-out infinite; }" : ""}
        @keyframes sqf-breathe { 0%,100% { opacity: 0.8; } 50% { opacity: 1; } }
        .sqf-reactor { position: absolute; inset: 12px; border-radius: 34px; pointer-events: none;
          opacity: ${p.reactorOpacity}; transition: opacity 0.5s; filter: blur(12px); }
        .sqf-reactor::before { content: ''; position: absolute; inset: 0; border-radius: inherit;
          background: conic-gradient(from 0deg, transparent 0 10%, var(--sqf-flair) 22%, transparent 38%, transparent 55%, var(--sqf-flair) 70%, transparent 88%);
          animation: sqf-spin ${p.spinSecs}s linear infinite; }
        .sqf-reactor::after { content: ''; position: absolute; inset: 20px; border-radius: 20px; background: var(--heroui-content1, #14141c); }
        @keyframes sqf-spin { to { transform: rotate(360deg); } }
        .sqf-ring { position: absolute; inset: 2px; pointer-events: none; overflow: visible; }
        .sqf-ring .track { fill: none; stroke: rgba(128,128,140,0.25); stroke-width: 2.5; }
        .sqf-ring .tube { fill: none; stroke: var(--sqf-flair); stroke-linecap: round; transition: stroke-dashoffset 0.6s ease, stroke 0.4s; }
        .sqf-ring .blur1 { stroke-width: 9; filter: blur(6px); opacity: 0.7; }
        .sqf-ring .crisp { stroke-width: 2.8; }
        .sqf-tick { fill: rgba(128,128,140,0.4); transition: fill 0.3s; }
        .sqf-tick.on { fill: ${p.gold ? "var(--sqf-flair)" : GREEN}; }
        .sqf-scan { position: absolute; left: 34px; right: 34px; top: 34px; pointer-events: none; z-index: 2;
          height: ${p.scanHeight}px; border-radius: ${Math.ceil(p.scanHeight / 2)}px; filter: blur(3px);
          background: linear-gradient(90deg, transparent, ${p.gold ? "rgba(255,210,87,0.85)" : "rgba(51,255,153,0.8)"}, transparent);
          opacity: ${p.scanOpacity}; ${p.scanHeight > 0 ? `animation: sqf-sweep ${p.gold ? 1.8 : 3.2}s linear infinite;` : ""} }
        @keyframes sqf-sweep { 0% { transform: translateY(0); opacity: 0; } 8% { opacity: ${p.scanOpacity}; } 92% { opacity: ${p.scanOpacity}; } 100% { transform: translateY(220px); opacity: 0; } }
        .sqf-chip { position: absolute; top: 6px; left: 50%; transform: translateX(-50%); z-index: 3; white-space: nowrap;
          font-family: ui-monospace, Menlo, monospace; font-size: 10px; letter-spacing: 0.2em; font-weight: 800; color: #1a1405;
          background: linear-gradient(180deg, #ffe9a8, #ffd257); border-radius: 999px; padding: 4px 14px;
          box-shadow: 0 0 16px rgba(255,210,87,0.8); }
        .sqf-card { position: relative; z-index: 1; border-radius: 10px; overflow: hidden;
          ${p.haloOpacity > 0.5 ? `box-shadow: 0 0 ${Math.round(24 * p.haloOpacity)}px var(--sqf-flair-soft);` : ""} }
        .sqf-hotspot { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
          width: 78px; height: 78px; z-index: 6; border-radius: 50%; -webkit-tap-highlight-color: transparent; user-select: none; touch-action: none; }
        .sqf-press { position: absolute; inset: 6px; border-radius: 50%; border: 3px solid ${GREEN}; opacity: 0; transform: scale(0.4); pointer-events: none; }
        .sqf-hotspot.holding .sqf-press { animation: sqf-press 1.3s ease-in forwards; }
        @keyframes sqf-press { 0% { opacity: 0.6; transform: scale(0.4); } 100% { opacity: 1; transform: scale(1); box-shadow: 0 0 26px rgba(51,255,153,0.9); } }
        .sqf-burst { position: absolute; top: 50%; left: 50%; margin: -5px 0 0 -5px; width: 10px; height: 10px; z-index: 7; border-radius: 50%; pointer-events: none; opacity: 0; }
        .sqf-burst.go { animation: sqf-burst 0.8s ease-out forwards; }
        @keyframes sqf-burst { 0% { opacity: 1; box-shadow: 0 0 0 0 rgba(51,255,153,0.9), 0 0 0 0 rgba(196,21,122,0.7); } 100% { opacity: 0; box-shadow: 0 0 50px 70px rgba(51,255,153,0), 0 0 25px 110px rgba(196,21,122,0); } }
        .sqf-rail { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; padding: 8px 14px;
          border: 1px solid ${p.badgeGlow >= 16 ? "var(--sqf-flair)" : "rgba(128,128,140,0.3)"}; border-radius: 999px;
          ${p.badgeGlow >= 16 ? "box-shadow: 0 0 16px var(--sqf-flair-soft);" : ""} transition: border-color 0.4s, box-shadow 0.4s; }
        .sqf-bglow { transition: filter 0.4s ease; ${p.badgeGlow > 0 ? `filter: drop-shadow(0 0 ${p.badgeGlow}px var(--sqf-flair-soft));` : ""} }
        .sqf-bglow.locked { filter: none; }
        ${p.gold ? ".sqf-bglow:not(.locked) { animation: sqf-bbreathe 2.4s ease-in-out infinite; } @keyframes sqf-bbreathe { 0%,100% { filter: drop-shadow(0 0 8px var(--sqf-flair-soft)); } 50% { filter: drop-shadow(0 0 20px var(--sqf-flair)); } }" : ""}
        .sqf-badge { width: 46px; height: 46px; position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center;
          font-family: ui-monospace, Menlo, monospace; user-select: none;
          clip-path: polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%); background: rgba(30,30,40,0.9); }
        .sqf-badge::before { content: ''; position: absolute; inset: 0;
          clip-path: polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%, 50% 6%, 12% 28%, 12% 72%, 50% 94%, 88% 72%, 88% 28%, 50% 6%); }
        .sqf-badge .g { font-size: 12px; font-weight: 800; z-index: 1; color: #e8e8f0; }
        .sqf-badge .c { font-size: 6.5px; letter-spacing: 0.08em; color: #8b8b9c; z-index: 1; }
        .sqf-badge.amber::before { background: #ffb347; } .sqf-badge.amber .g { color: #ffb347; }
        .sqf-badge.magenta::before { background: ${MAGENTA}; }
        .sqf-badge.green::before { background: ${GREEN}; } .sqf-badge.green .g { color: ${GREEN}; }
        .sqf-badge.locked { opacity: 0.35; }
        .sqf-badge.locked::before { background: repeating-linear-gradient(45deg, rgba(128,128,140,0.5) 0 4px, transparent 4px 8px); }
        .sqf-readout { font-family: ui-monospace, Menlo, monospace; text-align: center; line-height: 1.8; }
        .sqf-readout .lvl { font-size: 15px; letter-spacing: 0.12em; font-weight: 700; ${p.gold ? "color: var(--sqf-flair);" : ""} }
        .sqf-readout .sub { font-size: 11px; opacity: 0.6; }
        .sqf-readout .teaser { font-size: 10px; letter-spacing: 0.06em; opacity: 0.75; }
        .sqf-readout .teaser b { color: ${GREEN}; font-weight: 400; }
        .sqf-toast { position: fixed; left: 50%; bottom: 48px; transform: translateX(-50%); z-index: 60;
          font-family: ui-monospace, Menlo, monospace; font-size: 12px; letter-spacing: 0.08em; text-align: center;
          background: rgba(20,20,28,0.95); border: 1px solid ${GREEN}; border-radius: 8px; padding: 10px 18px;
          color: ${GREEN}; box-shadow: 0 0 12px rgba(51,255,153,0.5); }
      `}</style>

      <div className="sqf-wrap">
        <div className="sqf-halo" />
        {p.reactorOpacity > 0 && <div className="sqf-reactor" />}
        {p.gold && <div className="sqf-chip">♛ SOCIAL LEADER</div>}
        <svg className="sqf-ring" viewBox="0 0 300 300">
          <rect className="track" x="8" y="8" width="284" height="284" rx="22" />
          {p.ringFill > 0 && (
            <>
              <rect
                className="tube blur1"
                x="8" y="8" width="284" height="284" rx="22"
                pathLength={100}
                strokeDasharray={100}
                strokeDashoffset={100 - p.ringFill}
              />
              <rect
                className="tube crisp"
                x="8" y="8" width="284" height="284" rx="22"
                pathLength={100}
                strokeDasharray={100}
                strokeDashoffset={100 - p.ringFill}
              />
            </>
          )}
          <g>
            {ticks.map((i) => (
              <circle
                key={i}
                className={`sqf-tick${i < p.ticksOn ? " on" : ""}`}
                cx={24 + i * 50.4}
                cy={4}
                r={3}
              />
            ))}
          </g>
        </svg>
        {p.scanHeight > 0 && <div className="sqf-scan" />}
        <div className="sqf-card">
          <StyledRunnerQr
            hash={hash}
            eqrFallback={eqrFallback}
            alt={alt ?? "Your Social QR"}
            className="max-w-[220px]"
          />
        </div>
        <div
          className={`sqf-hotspot${holding ? " holding" : ""}`}
          onPointerDown={onEggDown}
          onPointerUp={cancelHold}
          onPointerLeave={cancelHold}
          aria-hidden="true"
        >
          <div className="sqf-press" />
        </div>
        <div key={burst} className={`sqf-burst${burst > 0 ? " go" : ""}`} />
      </div>

      <div className="sqf-rail">
        {badges.map((b) => (
          <div
            key={b.id}
            className={`sqf-bglow${b.state === "locked" ? " locked" : ""}`}
            title={b.name}
          >
            <div className={`sqf-badge ${b.color}${b.state === "locked" ? " locked" : ""}`}>
              <span className="g">{b.glyph}</span>
              <span className="c">{b.cap}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="sqf-readout">
        <div className="lvl">
          {p.gold ? "♛ " : ""}
          {social.band.label}
        </div>
        <div className="sub">
          SOCIAL SCORE {social.score}
          {social.band.total > 0 ? ` · FIELD OF ${social.band.total}` : ""}
        </div>
        {p.teaser && (
          <div className="teaser">
            {p.teaser.startsWith("NEXT") ? (
              <>
                <b>{p.teaser.split(":")[0]}</b>:{p.teaser.split(":").slice(1).join(":")}
              </>
            ) : (
              p.teaser
            )}
          </div>
        )}
      </div>

      {eggToast && <div className="sqf-toast">{eggToast}</div>}
    </div>
  );
}
