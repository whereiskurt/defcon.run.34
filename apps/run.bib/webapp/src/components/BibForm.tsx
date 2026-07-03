"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import BibPreview from "./BibPreview";

/**
 * BibForm
 *
 * Client-side registration form. Owns the controlled input for `nameOnBib`,
 * drives the live-updating <BibPreview />, and debounces PATCH /api/bib
 * updates so the server isn't hit on every keystroke.
 *
 * Behaviour contract (v1.5 Phase 21 design contract):
 *   - Hard-cap the name at 32 chars, mirroring the server-side cap in
 *     src/app/api/bib/route.ts (Zod: z.string().max(32)).
 *   - When `nameLocked=true` (from GET /api/bib), disable the input and
 *     surface a "Name locked for print" hint. This mirrors the server-side
 *     409 that PATCH would raise if a locked bib is PATCHed anyway.
 *   - Debounce PATCH by 400ms after the last keystroke.
 *   - While a PATCH is in flight, the input stays enabled (typing continues
 *     to accumulate into the pending value); a `Saving…` badge shows the
 *     transient state.
 *   - On 409 name_locked (raced admin lock during editing), lock the input
 *     locally and show the same "Name locked" hint.
 *   - On any other network / server error, show a "Save failed" hint but
 *     keep the input editable so the user can retry.
 *
 * The parent (`app/page.tsx`) passes:
 *   - `initialName` — whatever the server-side GET returned for nameOnBib.
 *   - `initialCode` — the assigned runnerCode (BIB-XXXX).
 *   - `nameLocked`  — the server's nameLocked flag at initial render.
 *
 * The form intentionally does NOT re-fetch the bib after each save; if
 * server-side trimming changes the value, the next full page load will
 * reconcile. Keeps the client optimistic and fast.
 */
export interface BibFormProps {
  initialName: string;
  nameLocked: boolean;
  /**
   * Phase 22-05-06 sponsor charm accent. Passed through to BibPreview so
   * the green (DC34 mint palette #6CCDB8) charm renders when the participant has any contribution
   * (bib.paidAmount > 0). Optional — defaults to `false`.
   */
  hasSponsored?: boolean;
}

/** Debounce window between last keystroke and PATCH fire (ms). Longer than a
 *  keystroke pause so a burst of typing collapses into a single write — the
 *  name doesn't need instant persistence and this keeps DB updates minimal. */
const PATCH_DEBOUNCE_MS = 1200;

/**
 * Save-state discriminator:
 *   - idle: no pending or in-flight save
 *   - dirty: local input differs from last saved value; debounce timer armed
 *   - saving: PATCH in flight
 *   - saved: last PATCH succeeded (transient banner)
 *   - locked: server returned 409 name_locked (input disabled from here on)
 *   - error: transient network / 5xx save failure (input still editable)
 */
type SaveState =
  | { kind: "idle" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "locked" }
  | { kind: "error"; detail: string };

/**
 * Compute the api path for /api/bib. In production the app is mounted at
 * /{region}/... via next.config.ts basePath, so relative URLs from the
 * browser resolve correctly. Kept as a helper for clarity + future hook
 * points (e.g., regional failover).
 */
const API_BIB_PATH = "/api/bib";

/** Absolute-cap on nameOnBib. Server enforces the same value. */
const NAME_MAX = 32;

export function BibForm({
  initialName,
  nameLocked: initialLocked,
  hasSponsored = false,
}: BibFormProps) {
  const [name, setName] = useState<string>(initialName);
  const [nameLocked, setNameLocked] = useState<boolean>(initialLocked);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  // The last name we've successfully persisted (so we can detect true
  // dirtiness vs. no-op).
  const lastSavedRef = useRef<string>(initialName);
  // Debounce timer id.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // AbortController for the in-flight PATCH so we don't clobber a fresh
  // keystroke's save with a stale response.
  const abortRef = useRef<AbortController | null>(null);

  const runPatch = useCallback(async (nextName: string) => {
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
        body: JSON.stringify({ nameOnBib: nextName }),
        signal: controller.signal,
      });

      if (res.status === 409) {
        // Admin locked the bib mid-edit.
        setNameLocked(true);
        setSaveState({ kind: "locked" });
        return;
      }

      if (!res.ok) {
        // 400 / 404 / 5xx — surface a generic failure. The API layer's
        // structured JSON body is useful for diagnostics but the user only
        // needs "save failed, retry".
        setSaveState({
          kind: "error",
          detail: `HTTP ${res.status}`,
        });
        return;
      }

      lastSavedRef.current = nextName;
      setSaveState({ kind: "saved" });
    } catch (err) {
      // Aborted requests are the normal debounce flow — don't surface them.
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
  }, []);

  // Debounce: on every `name` change that differs from the last saved
  // value, arm the timer. Clears any previous timer.
  useEffect(() => {
    if (nameLocked) return;

    if (name === lastSavedRef.current) {
      // Reverted to server value — cancel any pending save.
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
      runPatch(name);
    }, PATCH_DEBOUNCE_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [name, nameLocked, runPatch]);

  // Clear any pending timer + abort in-flight request on unmount so we
  // don't leak.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  const onChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    // Kurt 2026-07-02: strip non-ASCII (emojis, combining marks, etc.)
    // silently so paste flows and IME output can't smuggle glyphs the bib
    // printer can't render. Server enforces the same rule in PATCH.
    // Client-side cap mirrors the server contract. The maxLength attribute
    // stops most keystrokes; slice() defends against paste + IME cases the
    // browser may not clip.
    const next = event.target.value
      .replace(/[^\x20-\x7E]/g, "")
      .slice(0, NAME_MAX);
    setName(next);
  };

  return (
    <form
      onSubmit={(e) => e.preventDefault()}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 24,
        width: "100%",
        maxWidth: 720,
        margin: "0 auto",
      }}
    >
      <BibPreview name={name} hasSponsored={hasSponsored} />

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label
          htmlFor="bib-name-input"
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "#e4e4ef",
            letterSpacing: "0.02em",
          }}
        >
          Name on bib
        </label>
        <input
          id="bib-name-input"
          type="text"
          value={name}
          onChange={onChange}
          maxLength={NAME_MAX}
          disabled={nameLocked}
          autoComplete="off"
          spellCheck={false}
          placeholder="Enter the name to print on your bib"
          aria-describedby="bib-name-hint"
          style={{
            padding: "12px 14px",
            fontSize: 16,
            fontFamily:
              "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
            color: nameLocked ? "#8f8fa8" : "#0a0a0a",
            backgroundColor: nameLocked ? "#2a2a34" : "#fff",
            border: "2px solid " + (nameLocked ? "#3a3a44" : "#c8ccd4"),
            borderRadius: 6,
            outline: "none",
            cursor: nameLocked ? "not-allowed" : "text",
          }}
        />
        <SaveStateHint state={saveState} nameLocked={nameLocked} name={name} />
      </div>
    </form>
  );
}

/**
 * Small helper component that renders the human-readable status underneath
 * the input. Split out to keep the form body readable.
 */
function SaveStateHint({
  state,
  nameLocked,
  name,
}: {
  state: SaveState;
  nameLocked: boolean;
  name: string;
}) {
  const baseStyle: React.CSSProperties = {
    fontSize: 13,
    color: "#a4a4b8",
    minHeight: 18,
  };

  if (nameLocked || state.kind === "locked") {
    return (
      <span
        id="bib-name-hint"
        role="status"
        style={{ ...baseStyle, color: "#6CCDB8" }}
      >
        Name locked for print — contact organizers if this needs to change.
      </span>
    );
  }

  const remaining = NAME_MAX - name.length;
  const remainingText = `${remaining} character${remaining === 1 ? "" : "s"} remaining`;

  switch (state.kind) {
    case "saving":
      return (
        <span id="bib-name-hint" role="status" style={baseStyle}>
          Saving…
        </span>
      );
    case "saved":
      return (
        <span
          id="bib-name-hint"
          role="status"
          style={{ ...baseStyle, color: "#7fdc9e" }}
        >
          Saved. {remainingText}.
        </span>
      );
    case "error":
      return (
        <span
          id="bib-name-hint"
          role="status"
          style={{ ...baseStyle, color: "#ff8a8a" }}
        >
          Save failed ({state.detail}) — will retry as you keep typing.
        </span>
      );
    case "dirty":
      return (
        <span id="bib-name-hint" role="status" style={baseStyle}>
          Unsaved changes… {remainingText}.
        </span>
      );
    case "idle":
    default:
      return (
        <span id="bib-name-hint" role="status" style={baseStyle}>
          {remainingText}
        </span>
      );
  }
}

export default BibForm;
