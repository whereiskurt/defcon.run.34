"use client";

import { useCallback, useState } from "react";
import BibPreview from "./BibPreview";

/**
 * BibForm
 *
 * Client-side registration form. Owns the controlled input for `nameOnBib`
 * and drives the live <BibPreview />. Saving is EXPLICIT (Save/Cancel), and
 * each committed change consumes one of the runner's rename quota
 * (Kurt 2026-07-03 — abuse guard; the server enforces the same limit and is
 * the source of truth). Cancel reverts to the last saved value.
 *
 * The parent (`app/orderform/page.tsx`) passes:
 *   - `initialName` — server-side nameOnBib.
 *   - `nameLocked`  — server's nameLocked flag.
 *   - `initialRenamesRemaining` — quota - nameRenameCount, from the server.
 */
export interface BibFormProps {
  initialName: string;
  nameLocked: boolean;
  /** Sponsor charm accent, passed to BibPreview (paidAmount > 0). */
  hasSponsored?: boolean;
  /** Remaining committed name changes (server: quota - nameRenameCount). */
  initialRenamesRemaining: number;
}

const API_BIB_PATH = "/api/bib";
// Kurt 2026-07-03: 24-char cap (was 32) — matches the physical bib render budget.
const NAME_MAX = 24;

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "locked" }
  | { kind: "quota" }
  | { kind: "error"; detail: string };

export function BibForm({
  initialName,
  nameLocked: initialLocked,
  hasSponsored = false,
  initialRenamesRemaining,
}: BibFormProps) {
  const [name, setName] = useState<string>(initialName);
  const [savedName, setSavedName] = useState<string>(initialName);
  const [nameLocked, setNameLocked] = useState<boolean>(initialLocked);
  const [renamesRemaining, setRenamesRemaining] = useState<number>(
    initialRenamesRemaining
  );
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  const dirty = name !== savedName;
  const quotaSpent = renamesRemaining <= 0;
  const saving = saveState.kind === "saving";
  const canSave = dirty && !nameLocked && !quotaSpent && !saving;

  const onChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    // Strip non-ASCII (emoji/combining marks) the bib printer can't render;
    // cap at NAME_MAX. Server enforces the same rules.
    const next = event.target.value
      .replace(/[^\x20-\x7E]/g, "")
      .slice(0, NAME_MAX);
    setName(next);
    if (saveState.kind !== "saving") setSaveState({ kind: "idle" });
  };

  const onCancel = () => {
    setName(savedName);
    setSaveState({ kind: "idle" });
  };

  const onSave = useCallback(async () => {
    if (name === savedName || nameLocked || renamesRemaining <= 0) return;
    setSaveState({ kind: "saving" });
    try {
      const res = await fetch(API_BIB_PATH, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nameOnBib: name }),
      });
      if (res.status === 409) {
        setNameLocked(true);
        setSaveState({ kind: "locked" });
        return;
      }
      if (res.status === 429) {
        setRenamesRemaining(0);
        setSaveState({ kind: "quota" });
        return;
      }
      if (!res.ok) {
        setSaveState({ kind: "error", detail: `HTTP ${res.status}` });
        return;
      }
      const body = (await res.json()) as { renamesRemaining?: number };
      setSavedName(name);
      if (typeof body.renamesRemaining === "number") {
        setRenamesRemaining(body.renamesRemaining);
      }
      setSaveState({ kind: "saved" });
    } catch (err) {
      setSaveState({
        kind: "error",
        detail: err instanceof Error ? err.message : "network",
      });
    }
  }, [name, savedName, nameLocked, renamesRemaining]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 24,
        width: "100%",
        maxWidth: 720,
        margin: "0 auto",
      }}
    >
      {/* A3 (Kurt 2026-07-03): name field FIRST, then the live preview below. */}
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

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          {/* Tiny save/cancel — each save spends one rename. */}
          <button
            type="submit"
            disabled={!canSave}
            style={{
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: 700,
              color: canSave ? "#0a0a0a" : "#8f8fa8",
              backgroundColor: canSave ? "#6CCDB8" : "#2a2a34",
              border: "none",
              borderRadius: 6,
              cursor: canSave ? "pointer" : "not-allowed",
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={!dirty || saving}
            style={{
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: 600,
              color: !dirty || saving ? "#6a6a7a" : "#e4e4ef",
              backgroundColor: "transparent",
              border: "1px solid #2a2a34",
              borderRadius: 6,
              cursor: !dirty || saving ? "not-allowed" : "pointer",
            }}
          >
            Cancel
          </button>
          <SaveStateHint
            state={saveState}
            nameLocked={nameLocked}
            renamesRemaining={renamesRemaining}
          />
        </div>
      </div>

      {/* Live preview sits BELOW the name field (A3, name-first). */}
      <BibPreview name={name} hasSponsored={hasSponsored} />
    </form>
  );
}

/** Human-readable status + remaining-rename count under the buttons. */
function SaveStateHint({
  state,
  nameLocked,
  renamesRemaining,
}: {
  state: SaveState;
  nameLocked: boolean;
  renamesRemaining: number;
}) {
  const base: React.CSSProperties = { fontSize: 13, color: "#a4a4b8" };
  const left = `${renamesRemaining} name change${renamesRemaining === 1 ? "" : "s"} left`;

  if (nameLocked || state.kind === "locked") {
    return (
      <span id="bib-name-hint" role="status" style={{ ...base, color: "#6CCDB8" }}>
        Name locked for print — contact organizers to change it.
      </span>
    );
  }
  if (state.kind === "quota" || renamesRemaining <= 0) {
    return (
      <span id="bib-name-hint" role="status" style={{ ...base, color: "#ff8a8a" }}>
        No name changes left.
      </span>
    );
  }
  switch (state.kind) {
    case "saving":
      return (
        <span id="bib-name-hint" role="status" style={base}>
          Saving…
        </span>
      );
    case "saved":
      // A5 (Kurt 2026-07-03): keep the remaining count under wraps — only
      // surface it when it's getting low (≤3 left).
      return (
        <span id="bib-name-hint" role="status" style={{ ...base, color: "#7fdc9e" }}>
          {renamesRemaining <= 3 ? `Saved · ${left}` : "Saved."}
        </span>
      );
    case "error":
      return (
        <span id="bib-name-hint" role="status" style={{ ...base, color: "#ff8a8a" }}>
          Save failed ({state.detail}) — try again.
        </span>
      );
    case "idle":
    default:
      // A5: hide the quota entirely until only a few changes remain.
      return renamesRemaining <= 3 ? (
        <span id="bib-name-hint" role="status" style={{ ...base, color: "#f4c680" }}>
          {left}
        </span>
      ) : (
        <span id="bib-name-hint" role="status" style={base} />
      );
  }
}

export default BibForm;
