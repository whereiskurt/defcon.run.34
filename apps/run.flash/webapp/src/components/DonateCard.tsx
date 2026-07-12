"use client";

import { useState } from "react";

/**
 * DonateCard — the shared "give-more" pay card (Riff C: big ±$5 stepper +
 * doubled Pay button). Kurt 2026-07-11: this is THE donate/pay design used
 * everywhere — the bib Sponsor tile, the header donate modal, and the /donate
 * page, across run.bib / run.human / run.flash.
 *
 * PRESENTATIONAL + PORTABLE BY CONTRACT: it owns NO checkout, NO copy catalog,
 * NO app-specific imports. Amount is a controlled prop; the caller runs the
 * actual Stripe/Venmo checkout in `onSubmit`. All labels come in via `copy` and
 * all colors are explicit hex (no --bib-* tokens) so the file is byte-identical
 * when duplicated into run.human / run.flash (this monorepo duplicates shared UI
 * per app rather than shipping a package). Keep the three copies in sync.
 *
 * Give-more UX:
 *   - Amount is the hero: a large monospace figure with big − / + $5 controls.
 *   - Tap the figure to type an exact amount (snaps to $5, clamped to min/max).
 *   - Quick chips: round up +$5, and jump to $50 / $100.
 *   - The Pay button is DOUBLED — a compact "Pay $X" up top and the full-width
 *     "Pay Now $X.00" at the bottom — both fire the same onSubmit.
 * All amounts snap to $5 in the UI; the caller still clamps to its own contract
 * (whole-cents Zod bounds) before checkout, so the API invariants are untouched.
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
  stripe: "#635bff",
  venmo: "#3d95ce",
  err: "#ff8a8a",
};
const MONO = "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace";

export interface DonateCardCopy {
  /** Small caps label over the top total bar, e.g. "Your support". */
  supportLabel: string;
  title: string;
  subhead: string;
  /** Caption under the stepper, e.g. "per bib · $5 steps". */
  stepHint: string;
  payWith: string;
  card: string;
  venmo: string;
  venmoNote?: string;
  runnerLabel: string;
  copyLabel: string;
  copiedLabel: string;
  /** Full CTA verb, e.g. "Pay Now". */
  payNow: string;
  /** Compact CTA verb for the top bar, e.g. "Pay". */
  payShort: string;
  /** Quick "round up" chip label, e.g. "round up +$5". */
  roundUp: string;
  redirecting: string;
}

export interface DonateCardProps {
  amountCents: number;
  minCents: number;
  maxCents: number;
  /** Setter — DonateCard always passes a $5-snapped, clamped value. */
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
  /**
   * Drop the outer card chrome (gradient/border/padding) — used when embedded
   * in a surface that already IS the card (the orderform Sponsor tile), to
   * avoid a card-in-a-card double border.
   */
  bare?: boolean;
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

  const stepBtn = (delta: number, glyph: string, label: string) => (
    <button
      type="button"
      onClick={() => apply(amountCents + delta)}
      disabled={locked}
      aria-label={label}
      style={{
        width: 56,
        height: 56,
        flex: "none",
        borderRadius: 12,
        border: `1px solid ${C.border2}`,
        background: C.raise,
        color: C.ink,
        font: `800 26px/1 ${MONO}`,
        cursor: locked ? "not-allowed" : "pointer",
      }}
    >
      {glyph}
    </button>
  );

  const chip = (onClick: () => void, label: string, strong = false) => (
    <button
      type="button"
      onClick={onClick}
      disabled={locked}
      style={{
        font: `800 13px/1 ${MONO}`,
        color: C.teal,
        background: "rgba(55,211,166,0.09)",
        border: "1px solid rgba(55,211,166,0.35)",
        borderRadius: 999,
        padding: strong ? "10px 15px" : "10px 14px",
        cursor: locked ? "not-allowed" : "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );

  const capLabel: React.CSSProperties = {
    display: "block",
    font: "700 11px/1 system-ui, sans-serif",
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: C.faint,
  };

  const payButton = (compact: boolean) => (
    <button
      type="button"
      onClick={onSubmit}
      disabled={locked}
      style={{
        width: compact ? "auto" : "100%",
        border: 0,
        borderRadius: compact ? 10 : 13,
        cursor: locked ? "wait" : "pointer",
        color: "#06110d",
        background: locked
          ? C.mint
          : `linear-gradient(180deg, ${C.mint2}, ${C.mint})`,
        boxShadow: compact
          ? `0 8px 18px -8px ${C.mint}`
          : `0 14px 30px -12px ${C.mint}, 0 0 0 1px rgba(108,205,184,0.4)`,
        opacity: locked && !submitting ? 0.6 : 1,
      }}
    >
      <span
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: compact ? "center" : "space-between",
          gap: 8,
          padding: compact ? "10px 16px" : "18px 22px",
        }}
      >
        {submitting ? (
          <span style={{ font: "800 16px/1 system-ui, sans-serif", width: "100%", textAlign: "center" }}>
            {copy.redirecting}
          </span>
        ) : compact ? (
          <span style={{ font: "800 15px/1 system-ui, sans-serif" }}>
            {copy.payShort}&nbsp;
            <span style={{ fontFamily: MONO }}>{payText}</span>
          </span>
        ) : (
          <>
            <span style={{ font: "800 20px/1 system-ui, sans-serif" }}>{copy.payNow}</span>
            <span style={{ font: `800 22px/1 ${MONO}`, fontVariantNumeric: "tabular-nums" }}>
              {payText}
            </span>
          </>
        )}
      </span>
    </button>
  );

  return (
    <div
      style={{
        background: bare ? "transparent" : `linear-gradient(180deg, ${C.card1}, ${C.card2})`,
        border: bare ? "none" : `1px solid ${C.border}`,
        borderRadius: bare ? 0 : 18,
        padding: bare ? 0 : "18px 18px 20px",
        color: C.ink,
        boxSizing: "border-box",
        width: "100%",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {/* doubled button — top total bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          background: C.raise2,
          border: `1px solid ${C.border2}`,
          borderRadius: 12,
          padding: "9px 9px 9px 14px",
          marginBottom: 8,
        }}
      >
        <span style={capLabel}>{copy.supportLabel}</span>
        {payButton(true)}
      </div>

      {/* title (skipped when the surrounding surface already provides one) */}
      {(copy.title || copy.subhead) && (
        <div style={{ textAlign: "center", marginTop: 6, marginBottom: 4 }}>
          {copy.title && <div style={{ font: "800 20px/1.2 system-ui, sans-serif" }}>{copy.title}</div>}
          {copy.subhead && (
            <p style={{ margin: "6px auto 0", maxWidth: "40ch", color: C.muted, fontSize: 13 }}>
              {copy.subhead}
            </p>
          )}
        </div>
      )}

      {/* big stepper */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: C.raise2,
          border: `1px solid ${C.border2}`,
          borderRadius: 12,
          padding: 8,
          marginTop: 12,
        }}
      >
        {stepBtn(-STEP, "–", "Decrease $5")}
        <div style={{ flex: 1, textAlign: "center", minWidth: 0 }}>
          {editing ? (
            <span style={{ font: `800 34px/1 ${MONO}`, color: C.ink }}>
              <span style={{ color: C.muted, fontSize: 22 }}>$</span>
              <input
                autoFocus
                inputMode="numeric"
                value={draft}
                onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEdit();
                  if (e.key === "Escape") setEditing(false);
                }}
                aria-label="Amount in US dollars"
                style={{
                  width: `${Math.max(2, draft.length || 2)}ch`,
                  font: `800 34px/1 ${MONO}`,
                  color: C.ink,
                  background: "transparent",
                  border: "none",
                  borderBottom: `2px solid ${C.mint}`,
                  outline: "none",
                  padding: 0,
                }}
              />
            </span>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (locked) return;
                setDraft(String(dollars));
                setEditing(true);
              }}
              disabled={locked}
              aria-label="Edit amount"
              style={{
                background: "transparent",
                border: "none",
                cursor: locked ? "default" : "text",
                padding: 0,
                font: `800 34px/1 ${MONO}`,
                color: C.ink,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <span style={{ color: C.muted, fontSize: 22 }}>$</span>
              {dollars.toLocaleString()}
            </button>
          )}
          <div
            style={{
              font: "600 10px/1 system-ui, sans-serif",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: C.faint,
              marginTop: 6,
            }}
          >
            {copy.stepHint}
          </div>
        </div>
        {stepBtn(STEP, "+", "Increase $5")}
      </div>

      {/* quick chips */}
      <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 10, flexWrap: "wrap" }}>
        {chip(() => apply(amountCents + STEP), copy.roundUp, true)}
        {chip(() => apply(5000), "$50")}
        {chip(() => apply(10000), "$100")}
      </div>

      {/* payment method */}
      <span style={{ ...capLabel, margin: "18px 0 10px" }}>{copy.payWith}</span>
      <div style={{ display: "grid", gridTemplateColumns: offerVenmo ? "1fr 1fr" : "1fr", gap: 8 }}>
        <PmPill
          on={provider === "stripe"}
          disabled={locked}
          onClick={() => !locked && onProvider("stripe")}
          mark={<span style={{ font: "900 15px/1 system-ui, sans-serif", color: C.stripe }}>S</span>}
          label={copy.card}
        />
        {offerVenmo && (
          <PmPill
            on={provider === "venmo"}
            disabled={locked}
            onClick={() => !locked && onProvider("venmo")}
            mark={<span style={{ font: "900 12px/1 system-ui, sans-serif", color: C.venmo }}>venmo</span>}
            label={copy.venmo}
          />
        )}
      </div>
      {offerVenmo && provider === "venmo" && copy.venmoNote && (
        <p style={{ fontSize: 12, color: C.muted, margin: "8px 0 0" }}>{copy.venmoNote}</p>
      )}

      {/* runner code */}
      {runnerCode && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: C.raise2,
            border: `1px solid ${C.border2}`,
            borderRadius: 11,
            padding: "11px 13px",
            marginTop: 12,
          }}
        >
          <span style={{ font: "700 10px/1 system-ui, sans-serif", letterSpacing: "0.12em", textTransform: "uppercase", color: C.faint }}>
            {copy.runnerLabel}
          </span>
          <span style={{ font: `800 15px/1 ${MONO}`, color: C.teal, flex: 1 }}>{runnerCode}</span>
          <button
            type="button"
            onClick={() => {
              try {
                navigator.clipboard?.writeText(runnerCode);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              } catch {
                /* clipboard unavailable — no-op */
              }
            }}
            style={{
              font: "700 11px/1 system-ui, sans-serif",
              background: C.raise,
              border: `1px solid ${C.border2}`,
              color: C.ink,
              borderRadius: 7,
              padding: "6px 10px",
              cursor: "pointer",
            }}
          >
            {copied ? copy.copiedLabel : copy.copyLabel}
          </button>
        </div>
      )}

      {/* doubled button — full-width primary */}
      <div style={{ marginTop: 16 }}>{payButton(false)}</div>

      {error && (
        <div role="alert" style={{ fontSize: 13, color: C.err, marginTop: 10 }}>
          {error}
        </div>
      )}
    </div>
  );
}

function PmPill({
  on,
  disabled,
  onClick,
  mark,
  label,
}: {
  on: boolean;
  disabled: boolean;
  onClick: () => void;
  mark: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: 13,
        borderRadius: 11,
        background: on ? "rgba(108,205,184,0.08)" : C.raise2,
        border: `1.5px solid ${on ? C.mint : C.border2}`,
        color: C.ink,
        font: "700 14px/1 system-ui, sans-serif",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {mark}
      {label}
    </button>
  );
}

export default DonateCard;
