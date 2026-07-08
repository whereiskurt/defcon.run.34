"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { RunnerCodeBadge } from "./RunnerCodeBadge";
import { useCopy } from "@/components/CopyProvider";

/**
 * CashConfirmModal (⑤ 2026-07-08) — the friction gate shown when a runner opts
 * to pay in person. Displays their bib code (copyable) + a Signal instruction.
 * OK commits the pledge (the caller then persists + rains); Cancel / Esc /
 * backdrop reverts (no pledge, no rain).
 *
 * Custom createPortal overlay (not HeroUI — the repo has none), mirroring
 * DonateModal's pattern: portal to document.body to escape the glass-nav
 * stacking context, `mounted` guard to avoid an SSR/hydration portal mismatch.
 */
export interface CashConfirmModalProps {
  open: boolean;
  runnerCode?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function CashConfirmModal({
  open,
  runnerCode,
  onConfirm,
  onCancel,
}: CashConfirmModalProps) {
  const { t } = useCopy();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(4,4,8,0.72)",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 420,
          background: "#12121a",
          border: "1px solid #24242e",
          borderRadius: 14,
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 20,
            fontWeight: 800,
            color: "var(--bib-ink)",
          }}
        >
          {t("bib.cashConfirm.title")}
        </h2>
        {runnerCode && <RunnerCodeBadge code={runnerCode} />}
        <p
          style={{
            margin: 0,
            color: "var(--bib-muted)",
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          {t("bib.cashConfirm.instruction")}
        </p>
        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              flex: "0 0 auto",
              padding: "12px 16px",
              borderRadius: 6,
              background: "transparent",
              border: "1px solid var(--bib-border-2)",
              color: "var(--bib-ink)",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {t("bib.cashConfirm.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              flex: 1,
              padding: "12px 16px",
              borderRadius: 6,
              background: "#6CCDB8",
              border: "none",
              color: "#0a0a0a",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {t("bib.cashConfirm.confirm")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default CashConfirmModal;
