"use client";

import { useState } from "react";

/**
 * DonateCard — the shared give/pay card. Two presentations off one component:
 *
 *  • TILE (bare=true): the orderform Sponsor tile control set — top total bar +
 *    ±$5 stepper + quick chips + doubled Pay button. UNCHANGED (Kurt 2026-07-11
 *    "leave tile as-is"); the surrounding Tile already provides card + kicker+art.
 *
 *  • MODAL (bare=false): the "Just donate" modal + /donate page. Refined-C —
 *    periwinkle line-art `art` + mono `kicker` (matching the Get-this-bib tile),
 *    title/subhead, ±$5 stepper, a quiet "Your support · $X" summary line, bold
 *    real Stripe/Venmo brand marks, and a single full-width CTA. No chips.
 *
 * PRESENTATIONAL + PORTABLE: no checkout, no copy catalog, no app-specific
 * imports (copy via props, colors as hex, marks + coin inlined). Duplicated
 * byte-identical into run.human / run.flash. Keep the three copies in sync.
 */

const C = {
  card1: "#13131c",
  card2: "#0f0f17",
  border: "#24242f",
  border2: "#2c2c38",
  raise: "#1b1b26",
  raise2: "#181820",
  ink: "#e7e7f1",
  muted: "#8f8fa8",
  faint: "#6c6c80",
  mint: "#6CCDB8",
  mint2: "#8fe0cd",
  teal: "#37d3a6",
  blue: "#7a9dff",
  stripe: "#635BFF",
  venmo: "#008CFF",
  err: "#ff8a8a",
};
const MONO = "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace";

/** Real Stripe brand mark (simple-icons), brand-colored. */
function StripeMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill={C.stripe} aria-hidden>
      <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z" />
    </svg>
  );
}

/** Real Venmo brand mark (simple-icons), brand-colored. */
function VenmoMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill={C.venmo} aria-hidden>
      <path d="M21.772 13.119c-.267 0-.381-.251-.38-.655 0-.533.121-1.575.712-1.575.267 0 .357.243.357.598 0 .533-.13 1.632-.689 1.632Zm.502-3.377c-1.677 0-2.405 1.285-2.405 2.658 0 1.042.421 1.874 1.693 1.874 1.717 0 2.438-1.406 2.438-2.763 0-1.025-.462-1.769-1.726-1.769Zm-3.833 0c-.558 0-.964.17-1.393.477-.154-.275-.462-.477-.932-.477-.542 0-.947.219-1.247.437l-.04-.364H13.54l-.688 4.354h1.506l.479-3.053c.129-.065.323-.154.518-.154.145 0 .267.049.267.267 0 .056-.016.145-.024.218l-.429 2.722h1.498l.478-3.053c.138-.073.324-.154.51-.154.146 0 .268.049.268.267 0 .056-.017.145-.025.218l-.429 2.722h1.499l.461-2.908c.025-.153.049-.388.049-.549 0-.582-.267-.97-1.037-.97Zm-6.871 0c-.575 0-.98.219-1.287.421l-.017-.348H8.962l-.689 4.354H9.78l.478-3.053c.13-.065.324-.154.518-.154.147 0 .268.049.268.242 0 .081-.024.227-.032.299l-.422 2.666h1.499l.462-2.908c.024-.153.049-.388.049-.549 0-.582-.268-.97-1.03-.97Zm-5.631 1.834c.041-.485.413-.824.697-.824.162 0 .299.097.299.291 0 .404-.713.533-.996.533Zm.843-1.834c-1.604 0-2.382 1.39-2.382 2.698 0 1.01.478 1.817 1.814 1.817.527 0 1.07-.113 1.418-.282l.186-1.26c-.494.25-.874.347-1.271.347-.365 0-.64-.194-.64-.687.826-.008 2.252-.347 2.252-1.453 0-.687-.494-1.18-1.377-1.18Zm-4.239.267c.089.186.146.412.146.743 0 .606-.429 1.494-.777 2.06l-.373-2.989L0 9.969l.705 4.2h1.757c.77-1.01 1.718-2.448 1.718-3.554 0-.347-.073-.622-.235-.889l-1.402.283Z" />
    </svg>
  );
}

/** Periwinkle line-art donation coin — the modal's hero graphic (matches the
 * Get-this-bib tile's #7a9dff line-art language). Default `art` for the modal. */
export function DonateCoinArt() {
  return (
    <svg width="72" height="72" viewBox="0 0 88 88" fill="none" aria-hidden style={{ color: "#7a9dff" }}>
      <circle cx="52" cy="52" r="20" fill="currentColor" fillOpacity="0.15" />
      <circle cx="44" cy="44" r="24" stroke="currentColor" strokeWidth="2.5" fill="none" />
      <circle cx="44" cy="44" r="18" stroke="currentColor" strokeWidth="1.5" fill="none" strokeDasharray="4 3" />
      <text x="44" y="53" textAnchor="middle" fontSize="26" fontWeight="900" fill="currentColor" fontFamily={MONO}>$</text>
      <circle cx="20" cy="20" r="2" fill="currentColor" fillOpacity="0.7" />
      <circle cx="72" cy="16" r="1.5" fill="currentColor" fillOpacity="0.5" />
      <circle cx="16" cy="72" r="1.5" fill="currentColor" fillOpacity="0.5" />
    </svg>
  );
}

export interface DonateCardCopy {
  supportLabel: string;
  title: string;
  subhead: string;
  stepHint: string;
  payWith: string;
  card: string;
  venmo: string;
  venmoNote?: string;
  runnerLabel: string;
  copyLabel: string;
  copiedLabel: string;
  payNow: string;
  payShort: string;
  roundUp: string;
  redirecting: string;
  /** Mono uppercase kicker over the modal hero (e.g. "Support"). Modal only. */
  kicker?: string;
}

export interface DonateCardProps {
  amountCents: number;
  minCents: number;
  maxCents: number;
  onAmount: (cents: number) => void;
  provider: "stripe" | "venmo";
  onProvider: (p: "stripe" | "venmo") => void;
  offerVenmo?: boolean;
  runnerCode?: string;
  submitting?: boolean;
  disabled?: boolean;
  error?: string | null;
  onSubmit: () => void;
  copy: DonateCardCopy;
  /** Tile embed — drop chrome + render the current tile control set (unchanged). */
  bare?: boolean;
  /** Modal hero graphic (defaults to the DonateCoinArt when omitted). */
  art?: React.ReactNode;
}

const STEP = 500; // $5
const snap5 = (c: number) => Math.round(c / STEP) * STEP;

export function DonateCard({
  amountCents,
  minCents,
  maxCents,
  onAmount,
  provider,
  onProvider,
  offerVenmo = true,
  runnerCode,
  submitting = false,
  disabled = false,
  error,
  onSubmit,
  copy,
  bare = false,
  art,
}: DonateCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);

  const locked = disabled || submitting;
  const clamp = (c: number) => Math.min(maxCents, Math.max(minCents, snap5(c)));
  const apply = (c: number) => {
    if (locked) return;
    onAmount(clamp(c));
  };
  const dollars = Math.round(amountCents / 100);
  const payText = `$${(amountCents / 100).toFixed(2)}`;

  const commitEdit = () => {
    const n = Number.parseInt(draft.replace(/[^0-9]/g, ""), 10);
    if (Number.isFinite(n)) apply(n * 100);
    setEditing(false);
  };

  const capLabel: React.CSSProperties = {
    display: "block",
    font: "700 11px/1 system-ui, sans-serif",
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: C.faint,
  };

  // ---- shared stepper (both layouts) ----
  const stepBtn = (delta: number, glyph: string, label: string) => (
    <button
      type="button"
      onClick={() => apply(amountCents + delta)}
      disabled={locked}
      aria-label={label}
      style={{
        width: 56, height: 56, flex: "none", borderRadius: 12,
        border: `1px solid ${C.border2}`, background: C.raise, color: C.ink,
        font: `800 26px/1 ${MONO}`, cursor: locked ? "not-allowed" : "pointer",
      }}
    >
      {glyph}
    </button>
  );
  const stepper = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.raise2, border: `1px solid ${C.border2}`, borderRadius: 12, padding: 8, marginTop: 12 }}>
      {stepBtn(-STEP, "–", "Decrease $5")}
      <div style={{ flex: 1, textAlign: "center", minWidth: 0 }}>
        {editing ? (
          <span style={{ font: `800 34px/1 ${MONO}`, color: C.ink }}>
            <span style={{ color: C.muted, fontSize: 22 }}>$</span>
            <input
              autoFocus inputMode="numeric" value={draft}
              onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
              onBlur={commitEdit}
              onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditing(false); }}
              aria-label="Amount in US dollars"
              style={{ width: `${Math.max(2, draft.length || 2)}ch`, font: `800 34px/1 ${MONO}`, color: C.ink, background: "transparent", border: "none", borderBottom: `2px solid ${C.mint}`, outline: "none", padding: 0 }}
            />
          </span>
        ) : (
          <button
            type="button"
            onClick={() => { if (locked) return; setDraft(String(dollars)); setEditing(true); }}
            disabled={locked} aria-label="Edit amount"
            style={{ background: "transparent", border: "none", cursor: locked ? "default" : "text", padding: 0, font: `800 34px/1 ${MONO}`, color: C.ink, fontVariantNumeric: "tabular-nums" }}
          >
            <span style={{ color: C.muted, fontSize: 22 }}>$</span>
            {dollars.toLocaleString()}
          </button>
        )}
        <div style={{ font: "600 10px/1 system-ui, sans-serif", letterSpacing: "0.1em", textTransform: "uppercase", color: C.faint, marginTop: 6 }}>
          {copy.stepHint}
        </div>
      </div>
      {stepBtn(STEP, "+", "Increase $5")}
    </div>
  );

  // ---- payment method (bold marks for modal, subtle for tile) ----
  const payment = (bold: boolean) => (
    <>
      <span style={{ ...capLabel, margin: "18px 0 10px" }}>{copy.payWith}</span>
      <div style={{ display: "grid", gridTemplateColumns: offerVenmo ? "1fr 1fr" : "1fr", gap: 8 }}>
        <PmPill on={provider === "stripe"} disabled={locked} onClick={() => !locked && onProvider("stripe")} label={copy.card}
          mark={bold ? <span style={{ width: 34, height: 34, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(99,91,255,0.16)" }}><StripeMark /></span>
                     : <span style={{ font: "900 15px/1 system-ui", color: C.stripe }}>S</span>} />
        {offerVenmo && (
          <PmPill on={provider === "venmo"} disabled={locked} onClick={() => !locked && onProvider("venmo")} label={copy.venmo}
            mark={bold ? <span style={{ width: 34, height: 34, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,140,255,0.16)" }}><VenmoMark /></span>
                       : <span style={{ font: "900 12px/1 system-ui", color: C.venmo }}>venmo</span>} />
        )}
      </div>
      {offerVenmo && provider === "venmo" && copy.venmoNote && (
        <p style={{ fontSize: 12, color: C.muted, margin: "8px 0 0" }}>{copy.venmoNote}</p>
      )}
    </>
  );

  const runnerRow = runnerCode ? (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.raise2, border: `1px solid ${C.border2}`, borderRadius: 11, padding: "11px 13px", marginTop: 12 }}>
      <span style={{ font: "700 10px/1 system-ui", letterSpacing: "0.12em", textTransform: "uppercase", color: C.faint }}>{copy.runnerLabel}</span>
      <span style={{ font: `800 15px/1 ${MONO}`, color: C.teal, flex: 1 }}>{runnerCode}</span>
      <button type="button"
        onClick={() => { try { navigator.clipboard?.writeText(runnerCode); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* no clipboard */ } }}
        style={{ font: "700 11px/1 system-ui", background: C.raise, border: `1px solid ${C.border2}`, color: C.ink, borderRadius: 7, padding: "6px 10px", cursor: "pointer" }}>
        {copied ? copy.copiedLabel : copy.copyLabel}
      </button>
    </div>
  ) : null;

  const bigPay = (
    <button type="button" onClick={onSubmit} disabled={locked}
      style={{ width: "100%", border: 0, borderRadius: 13, cursor: locked ? "wait" : "pointer", color: "#06110d", marginTop: 16,
        background: locked ? C.mint : `linear-gradient(180deg, ${C.mint2}, ${C.mint})`,
        boxShadow: `0 14px 30px -12px ${C.mint}, 0 0 0 1px rgba(108,205,184,0.4)`, opacity: locked && !submitting ? 0.6 : 1 }}>
      <span style={{ display: "flex", alignItems: "center", justifyContent: submitting ? "center" : "space-between", gap: 8, padding: "18px 22px" }}>
        {submitting ? (
          <span style={{ font: "800 16px/1 system-ui", width: "100%", textAlign: "center" }}>{copy.redirecting}</span>
        ) : (
          <>
            <span style={{ font: "800 20px/1 system-ui" }}>{copy.payNow}</span>
            <span style={{ font: `800 22px/1 ${MONO}`, fontVariantNumeric: "tabular-nums" }}>{payText}</span>
          </>
        )}
      </span>
    </button>
  );

  const errorNode = error ? <div role="alert" style={{ fontSize: 13, color: C.err, marginTop: 10 }}>{error}</div> : null;

  // ================= MODAL (refined-C) =================
  if (!bare) {
    return (
      <div style={{ background: `linear-gradient(180deg, ${C.card1}, ${C.card2})`, border: `1px solid ${C.border}`, borderRadius: 18, padding: "20px 18px", color: C.ink, boxSizing: "border-box", width: "100%" }}>
        <div style={{ textAlign: "center" }}>
          {copy.kicker && <span style={{ font: `700 11px/1 ${MONO}`, letterSpacing: "0.2em", textTransform: "uppercase", color: C.blue }}>{copy.kicker}</span>}
          <div style={{ display: "flex", justifyContent: "center", margin: "6px 0 2px" }}>{art ?? <DonateCoinArt />}</div>
          {copy.title && <div style={{ font: "800 22px/1.15 system-ui", marginTop: 2 }}>{copy.title}</div>}
          {copy.subhead && <p style={{ margin: "6px auto 0", maxWidth: "34ch", color: C.muted, fontSize: 12.5 }}>{copy.subhead}</p>}
        </div>
        {stepper}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, padding: "2px 4px" }}>
          <span style={{ ...capLabel }}>{copy.supportLabel}</span>
          <span style={{ font: `800 18px/1 ${MONO}`, color: C.mint, fontVariantNumeric: "tabular-nums" }}>{payText}</span>
        </div>
        {payment(true)}
        {runnerRow}
        {bigPay}
        {errorNode}
      </div>
    );
  }

  // ================= TILE (bare) — current layout, unchanged =================
  const compactPay = (
    <button type="button" onClick={onSubmit} disabled={locked}
      style={{ width: "auto", border: 0, borderRadius: 10, cursor: locked ? "wait" : "pointer", color: "#06110d",
        background: locked ? C.mint : `linear-gradient(180deg, ${C.mint2}, ${C.mint})`, boxShadow: `0 8px 18px -8px ${C.mint}`, opacity: locked && !submitting ? 0.6 : 1 }}>
      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "10px 16px" }}>
        {submitting ? <span style={{ font: "800 15px/1 system-ui" }}>{copy.redirecting}</span>
          : <span style={{ font: "800 15px/1 system-ui" }}>{copy.payShort}&nbsp;<span style={{ fontFamily: MONO }}>{payText}</span></span>}
      </span>
    </button>
  );
  const chip = (onClick: () => void, label: string) => (
    <button type="button" onClick={onClick} disabled={locked}
      style={{ font: `800 13px/1 ${MONO}`, color: C.teal, background: "rgba(55,211,166,0.09)", border: "1px solid rgba(55,211,166,0.35)", borderRadius: 999, padding: "10px 14px", cursor: locked ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}>
      {label}
    </button>
  );
  return (
    <div style={{ width: "100%", boxSizing: "border-box", opacity: disabled ? 0.55 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: C.raise2, border: `1px solid ${C.border2}`, borderRadius: 12, padding: "9px 9px 9px 14px", marginBottom: 8 }}>
        <span style={capLabel}>{copy.supportLabel}</span>
        {compactPay}
      </div>
      {stepper}
      <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 10, flexWrap: "wrap" }}>
        {chip(() => apply(amountCents + STEP), copy.roundUp)}
        {chip(() => apply(5000), "$50")}
        {chip(() => apply(10000), "$100")}
      </div>
      {payment(false)}
      {runnerRow}
      {bigPay}
      {errorNode}
    </div>
  );
}

function PmPill({ on, disabled, onClick, mark, label }: { on: boolean; disabled: boolean; onClick: () => void; mark: React.ReactNode; label: string; }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={on}
      style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: 13, borderRadius: 11,
        background: on ? "rgba(108,205,184,0.08)" : C.raise2, border: `1.5px solid ${on ? C.mint : C.border2}`, color: C.ink,
        font: "800 15px/1 system-ui, sans-serif", cursor: disabled ? "not-allowed" : "pointer" }}>
      {mark}
      {label}
    </button>
  );
}

export default DonateCard;
