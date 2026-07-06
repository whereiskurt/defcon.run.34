"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCopy } from "@/components/CopyProvider";
import { setRaining } from "@/lib/rain-store";
import { setBurning } from "@/lib/burn-store";

/**
 * ContributionChoice (Kurt 2026-07-05) — a 3-way opt between:
 *   - "nothing"  → do nothing (free bib, no pledge)
 *   - "inperson" → the pay-in-person pledge (rains cash; consumes bib_toggle)
 *   - "burn"     → the "🔥 Fuck your bib" opt-out (persisted; free name reset +
 *                  swaps the preview for the BurningBib animation)
 *
 * Replaces the old single WillPayInPersonCheckbox. Each pick PATCHes /api/bib
 * (ALTCHA-gated like before) with the target state, then router.refresh()es so
 * the server re-render reflects the persisted bib (sponsor tile, burn seed). It
 * also pushes the live view state across the sibling boundary via the rain- and
 * burn-store singletons (the bib preview isn't a React sibling).
 *
 * Only "inperson" consumes the bib_toggle quota (30/event) — a 429 reverts the
 * pick and shows the friendly cap note. "burn"/"nothing" are free.
 */

const PATCH_DEBOUNCE_MS = 250;
const API_BIB_PATH = "/api/bib";

export type Choice = "nothing" | "inperson" | "burn";

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; detail: string };

/** The bib fields each choice writes. Only "inperson" turns the pledge on. */
function payloadFor(choice: Choice): {
  willPayInPerson?: boolean;
  burned?: boolean;
} {
  switch (choice) {
    case "inperson":
      return { willPayInPerson: true, burned: false };
    case "burn":
      return { burned: true };
    case "nothing":
    default:
      return { willPayInPerson: false, burned: false };
  }
}

export interface ContributionChoiceProps {
  initialChoice: Choice;
}

export function ContributionChoice({ initialChoice }: ContributionChoiceProps) {
  const { t } = useCopy();
  const [choice, setChoice] = useState<Choice>(initialChoice);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [limitReached, setLimitReached] = useState(false);

  const lastSavedRef = useRef<Choice>(initialChoice);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const applyStores = useCallback((c: Choice) => {
    setRaining(c === "inperson");
    setBurning(c === "burn");
  }, []);

  const runPatch = useCallback(
    async (next: Choice) => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setSaveState({ kind: "saving" });
      // NO ALTCHA on the toggle (Kurt 2026-07-05). It's a low-risk cosmetic
      // pledge (capped by the bib_toggle quota), and the AltchaOverlay's
      // backdrop-filter blur was breaking the CashRain's will-change:transform
      // layers in prod — leaving no bills after the overlay cleared. Skipping the
      // proof-of-work removes the overlay from the rain flow entirely.
      try {
        const res = await fetch(API_BIB_PATH, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payloadFor(next)),
          signal: controller.signal,
        });

        if (res.status === 429) {
          // bib_toggle cap (inperson only) — revert the pick + stores + note.
          setChoice(lastSavedRef.current);
          applyStores(lastSavedRef.current);
          setLimitReached(true);
          setSaveState({ kind: "idle" });
          return;
        }
        if (!res.ok) {
          // Cosmetic-first (Kurt 2026-07-05): a failed save must NOT kill the
          // rain/burn — keep the optimistic choice + visuals, just note it.
          // Only a real 429 cap (handled above) reverts.
          setSaveState({ kind: "error", detail: `HTTP ${res.status}` });
          return;
        }

        lastSavedRef.current = next;
        setSaveState({ kind: "saved" });
        // NO router.refresh() (Kurt 2026-07-05). The rain / burn / dumpster are
        // driven entirely by the client store (instant + reliable, proven in a
        // prod build). router.refresh() re-ran the EVENTUALLY-CONSISTENT server
        // getBib() and was the one thing left that could disrupt the cash rain in
        // prod (it only fires on a successful save — i.e. only in real prod, never
        // locally). The persisted bib (sponsor-tile disable/swap) simply reflects
        // on the next page load; the fun visuals never depend on a server round-trip.
      } catch (err) {
        if (
          err instanceof DOMException &&
          (err.name === "AbortError" || err.message.includes("aborted"))
        ) {
          return;
        }
        // Keep the optimistic visuals on network error too (don't revert).
        setSaveState({
          kind: "error",
          detail: err instanceof Error ? err.message : "network",
        });
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [applyStores]
  );

  const onSelect = useCallback(
    (next: Choice) => {
      if (next === choice) return;
      setLimitReached(false);
      setChoice(next);
      // Optimistic view — rain / burn respond instantly; the write is debounced.
      applyStores(next);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        runPatch(next);
      }, PATCH_DEBOUNCE_MS);
    },
    [choice, applyStores, runPatch]
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  const busy = saveState.kind === "saving";

  return (
    <div
      aria-label="Contribution options"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 12,
        borderRadius: 8,
        backgroundColor: "var(--bib-surface)",
        border: "1px solid var(--bib-border)",
      }}
    >
      {/* Hint sits ABOVE the checkboxes (Kurt 2026-07-05) so the explanation for
        * the current pick reads first, then the controls. */}
      <span
        role="status"
        style={{
          fontSize: 13,
          minHeight: 18,
          color: limitReached ? "#d9902a" : "var(--bib-muted)",
          paddingLeft: 2,
        }}
      >
        {limitReached
          ? t("bib.contribution.limitNote")
          : hintFor(choice, saveState, t)}
      </span>

      {/* Two checkboxes side by side (wrap to stacked on narrow screens),
        * mutually exclusive: checking one clears the other (burn ↔ inperson);
        * "nothing" is both unchecked. */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <CheckRow
          id="opt-in-person"
          checked={choice === "inperson"}
          disabled={busy}
          onChange={(on) => onSelect(on ? "inperson" : "nothing")}
          accent="#6CCDB8"
          label={t("bib.contribution.optInPerson")}
        />
        <CheckRow
          id="opt-burn"
          checked={choice === "burn"}
          disabled={busy}
          onChange={(on) => onSelect(on ? "burn" : "nothing")}
          accent="#ff6a00"
          label={t("bib.contribution.optBurn")}
        />
      </div>
    </div>
  );
}

function hintFor(
  choice: Choice,
  state: SaveState,
  t: (key: string, vars?: Record<string, string | number>) => string
): string {
  // D-03: migrate the user-facing error SENTENCE; the {detail} token stays raw.
  if (state.kind === "error")
    return t("bib.contribution.saveError", { detail: state.detail });
  switch (choice) {
    case "inperson":
      return t("bib.contribution.hintInPerson");
    case "burn":
      return t("bib.contribution.hintBurn");
    case "nothing":
    default:
      return t("bib.contribution.hintNothing");
  }
}

/** One checkbox row (real <input type=checkbox> + label). */
function CheckRow({
  id,
  checked,
  disabled,
  onChange,
  accent,
  label,
}: {
  id: string;
  checked: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
  accent: string;
  label: string;
}) {
  return (
    <label
      htmlFor={id}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flex: "1 1 220px",
        minWidth: 0,
        padding: "10px 12px",
        borderRadius: 6,
        cursor: disabled ? "wait" : "pointer",
        backgroundColor: checked ? "var(--bib-raise)" : "transparent",
        border: `1px solid ${checked ? accent : "var(--bib-border-2)"}`,
        color: "var(--bib-ink)",
        fontSize: 15,
        fontWeight: 600,
      }}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: accent, width: 16, height: 16, margin: 0 }}
      />
      {label}
    </label>
  );
}

export default ContributionChoice;
