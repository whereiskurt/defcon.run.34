"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * WillPayInPersonCheckbox (Phase 22-05, Kurt 2026-07-02 rescope).
 *
 * A single-purpose controlled checkbox that persists the `willPayInPerson`
 * pledge to /api/bib via PATCH. Debounced identically to BibForm's
 * name-save flow (400ms) so rapid clicks don't storm the API. The pledge
 * is orthogonal to the print gate — this component does NOT disable when
 * nameLocked=true (participants can change their pledge after
 * registration lock).
 *
 * Design contract:
 *   - Controlled input; parent owns the initial value (from server-side
 *     bib.willPayInPerson).
 *   - 400ms debounce mirrors BibForm.PATCH_DEBOUNCE_MS. Repeated clicks
 *     within the window overwrite the pending value — the last click
 *     wins.
 *   - Optimistic UX: the checkbox visually reflects the local state
 *     immediately; a "Saving…" hint shows while PATCH is in flight; on
 *     failure the state stays as-clicked and a "Save failed" hint shows.
 *   - Never disabled on the client side. If the server ever adds a
 *     lock semantic for this field, add a prop and disable here.
 *   - No 409 name_locked interaction — the server's PATCH accepts this
 *     field independently.
 */

const PATCH_DEBOUNCE_MS = 400;

const API_BIB_PATH = "/api/bib";

type SaveState =
  | { kind: "idle" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; detail: string };

export interface WillPayInPersonCheckboxProps {
  initialValue: boolean;
}

export function WillPayInPersonCheckbox({
  initialValue,
}: WillPayInPersonCheckboxProps) {
  const router = useRouter();
  const [checked, setChecked] = useState<boolean>(initialValue);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  const lastSavedRef = useRef<boolean>(initialValue);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const runPatch = useCallback(async (nextValue: boolean) => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setSaveState({ kind: "saving" });
    try {
      const res = await fetch(API_BIB_PATH, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ willPayInPerson: nextValue }),
        signal: controller.signal,
      });

      if (!res.ok) {
        setSaveState({ kind: "error", detail: `HTTP ${res.status}` });
        return;
      }

      lastSavedRef.current = nextValue;
      setSaveState({ kind: "saved" });
      // React live: re-render the server component so the sponsor/buy flow
      // shows or hides to match the new pledge (writes stay debounced above).
      router.refresh();
    } catch (err) {
      if (
        err instanceof DOMException &&
        (err.name === "AbortError" || err.message.includes("aborted"))
      ) {
        return;
      }
      setSaveState({
        kind: "error",
        detail: err instanceof Error ? err.message : "network",
      });
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [router]);

  useEffect(() => {
    if (checked === lastSavedRef.current) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setSaveState({ kind: "idle" });
      return;
    }

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    setSaveState({ kind: "dirty" });
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      runPatch(checked);
    }, PATCH_DEBOUNCE_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [checked, runPatch]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  const onChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setChecked(event.target.checked);
  };

  return (
    <label
      htmlFor="will-pay-in-person"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "12px 14px",
        borderRadius: 6,
        backgroundColor: "#1a1a24",
        border: "1px solid #2a2a34",
        cursor: "pointer",
        color: "#e4e4ef",
      }}
    >
      <input
        id="will-pay-in-person"
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-describedby="will-pay-in-person-hint"
        style={{ margin: "3px 0 0 0" }}
      />
      <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>
          I&apos;ll contribute in person at defcon.run 34
        </span>
        <span
          id="will-pay-in-person-hint"
          role="status"
          style={{ fontSize: 13, color: "#a4a4b8", minHeight: 18 }}
        >
          {saveHintText(saveState)}
        </span>
      </span>
    </label>
  );
}

function saveHintText(state: SaveState): string {
  switch (state.kind) {
    case "saving":
      return "Saving…";
    case "saved":
      return "Saved.";
    case "error":
      return `Save failed (${state.detail}) — will retry as you interact.`;
    case "dirty":
      return "Unsaved changes…";
    case "idle":
    default:
      return "Optional. Lets organizers know to expect your contribution at the event.";
  }
}

export default WillPayInPersonCheckbox;
