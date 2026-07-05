"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import BibPreview from "./BibPreview";
import { CashRain } from "./CashRain";
import { BurningBib } from "./BurningBib";
import { solveAltcha } from "@/lib/altcha-client";
import { registerBibFlusher } from "@/lib/pending-bib-save";
import { getRaining, subscribe as subscribeRain } from "@/lib/rain-store";
import { getBurning, subscribe as subscribeBurn } from "@/lib/burn-store";

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
  /** Runner code — passed through to BibPreview for the tear-off QR. */
  runnerCode?: string;
  /**
   * Runner's real per-user social-QR URL (`/r?h=<hash>`), resolved server-side
   * (Plan 34-04, Slice C). Pure pass-through to BibPreview, which encodes it on
   * the tear-off stubs when present and falls back to the runner-code QR when
   * absent (never a blank stub — SC34.8).
   */
  socialQrUrl?: string;
  /**
   * Seed value for the cash-rain overlay on first render (the server-side
   * pay-in-person pledge). After mount, live rain state comes from the shared
   * `rain-store` singleton the checkbox pushes to (Plan 34-03) — the checkbox
   * is no longer a React sibling, so it can't pass `raining` down directly.
   */
  initialRaining?: boolean;
  /**
   * Server-side `bib.burned` seed (Kurt 2026-07-05). When burned, the whole
   * form (name field + Save/Cancel + preview) is replaced by <BurningBib/>.
   * Live changes arrive via the burn-store singleton (ContributionChoice pushes).
   */
  initialBurning?: boolean;
}

const API_BIB_PATH = "/api/bib";
// Kurt 2026-07-03: 24-char cap (was 32) — matches the physical bib render budget.
const NAME_MAX = 24;

type SaveState =
  | { kind: "idle" }
  | { kind: "verifying" }
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
  runnerCode,
  socialQrUrl,
  initialRaining = false,
  initialBurning = false,
}: BibFormProps) {
  const [name, setName] = useState<string>(initialName);
  const [savedName, setSavedName] = useState<string>(initialName);
  const [nameLocked, setNameLocked] = useState<boolean>(initialLocked);
  const [renamesRemaining, setRenamesRemaining] = useState<number>(
    initialRenamesRemaining
  );
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  // Cash-rain now crosses the (former) sibling boundary via the rain-store
  // singleton (Plan 34-03). Seed from the server-side pledge, then track the
  // checkbox's pushes. Re-seed from the store on mount too, in case the
  // checkbox toggled before this effect registered its subscription.
  const [raining, setRainingState] = useState<boolean>(initialRaining);
  useEffect(() => {
    setRainingState((prev) => prev || getRaining());
    return subscribeRain(setRainingState);
  }, []);

  // Burn state crosses the sibling boundary the same way (burn-store singleton).
  // Seed from the server flag; re-seed from the store on mount in case the choice
  // control toggled before this subscription registered.
  const [burning, setBurningState] = useState<boolean>(initialBurning);
  useEffect(() => {
    setBurningState((prev) => prev || getBurning());
    return subscribeBurn(setBurningState);
  }, []);

  // Server-truth reinforcement (Kurt 2026-07-05): ContributionChoice PATCHes then
  // router.refresh()es. The re-read (getBib) is EVENTUALLY CONSISTENT on DynamoDB,
  // so right after a toggle it can still return the OLD willPayInPerson/burned —
  // making initialRaining/initialBurning momentarily FALSE. This sync must be
  // ONE-DIRECTIONAL: only ever turn rain/burn ON from the server, NEVER off, or a
  // stale read would kill the optimistic rain the moment the save succeeds (the
  // prod-only "no rain" bug). Turning OFF is the store's job (uncheck → setRaining).
  useEffect(() => {
    if (initialRaining) setRainingState(true);
  }, [initialRaining]);
  useEffect(() => {
    if (initialBurning) setBurningState(true);
  }, [initialBurning]);

  const dirty = name !== savedName;
  const quotaSpent = renamesRemaining <= 0;
  // "Running low" on renames — signalled by an amber glow on Save (Kurt 2026-07-05).
  const quotaLow = renamesRemaining > 0 && renamesRemaining <= 5;
  const saving = saveState.kind === "saving";
  const busy = saving || saveState.kind === "verifying";
  const canSave = dirty && !nameLocked && !quotaSpent && !busy;
  // Green halo on the NAME BOX when it's saved (a real name, no unsaved edits).
  const nameSaved = !dirty && !nameLocked && savedName.trim().length > 0;
  // Which glow the Save button wears: zero→red(disabled), low→amber, dirty→green.
  const saveGlow = quotaSpent
    ? "bib-save-zero"
    : dirty && quotaLow
      ? "bib-save-low"
      : dirty
        ? "bib-save-dirty"
        : undefined;

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
    // ~5s ALTCHA proof-of-work before the save lands (Kurt 2026-07-03).
    setSaveState({ kind: "verifying" });
    let altcha: string;
    try {
      altcha = await solveAltcha("save");
    } catch {
      setSaveState({ kind: "error", detail: "verification failed — try again" });
      return;
    }
    setSaveState({ kind: "saving" });
    try {
      const res = await fetch(API_BIB_PATH, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nameOnBib: name, altcha }),
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

  // Expose the latest save closure to the Sponsor/Donate CTA so clicking
  // Purchase/Donate with an unsaved name commits it first (Kurt 2026-07-04).
  // onSave self-guards (no-op when the name isn't dirty), so this is safe to
  // fire unconditionally from the checkout path.
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  useEffect(() => {
    registerBibFlusher(() => onSaveRef.current());
    return () => registerBibFlusher(null);
  }, []);

  // 🔥 Burned: the whole name form + preview is replaced by the burning pile.
  // (All hooks above run unconditionally — this only swaps the rendered tree.)
  if (burning) {
    return (
      <div style={{ width: "100%", maxWidth: 720, margin: "0 auto" }}>
        <BurningBib />
      </div>
    );
  }

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
      {/* A3 (Kurt 2026-07-03): name field FIRST, then the live preview below.
        * No "Name on bib" label — the field defaults to "1337" (same as the bib
        * preview) so the connection is self-evident (Kurt 2026-07-05). */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {/* Name field with Save/Cancel inline to its right (Kurt 2026-07-04).
          * Wraps under the input on narrow screens. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <input
            id="bib-name-input"
            type="text"
            value={name}
            onChange={onChange}
            maxLength={NAME_MAX}
            disabled={nameLocked}
            autoComplete="off"
            spellCheck={false}
            placeholder="1337"
            aria-label="Name on bib"
            aria-describedby="bib-name-hint"
            className={nameSaved ? "bib-name-saved" : undefined}
            style={{
              flex: "1 1 220px",
              minWidth: 0,
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

          {/* Tiny save/cancel — each save spends one rename. When the name is
            * dirty the Save button glows (mint ring) + enlarges so the unsaved
            * state is unmistakable (Plan 34-03, SC34.5). The pulse animation is
            * gated for prefers-reduced-motion in globals.css. */}
          <button
            type="submit"
            disabled={!canSave}
            className={saveGlow}
            style={{
              padding: dirty ? "12px 22px" : "10px 16px",
              fontSize: dirty ? 15 : 13,
              fontWeight: 700,
              color: canSave ? "#0a0a0a" : "#8f8fa8",
              backgroundColor: canSave ? "#6CCDB8" : "#2a2a34",
              border: "none",
              borderRadius: 6,
              cursor: canSave ? "pointer" : "not-allowed",
              transition: "padding 120ms ease, font-size 120ms ease",
            }}
          >
            {busy
              ? saveState.kind === "verifying"
                ? "Verifying…"
                : "Saving…"
              : "Save"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={!dirty || busy}
            style={{
              padding: "10px 16px",
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
        </div>

        <SaveStateHint state={saveState} nameLocked={nameLocked} />
      </div>

      {/* Live preview sits BELOW the name field (A3, name-first). */}
      <div style={{ position: "relative" }}>
        <BibPreview name={name} hasSponsored={hasSponsored} runnerCode={runnerCode} socialQrUrl={socialQrUrl} dirty={dirty} />
        <CashRain active={raining} />
      </div>
    </form>
  );
}

/**
 * Minimal status line under the name field (Kurt 2026-07-05). The save/quota
 * state is now shown by GLOWS instead of text — green halo on the box when
 * saved, green Save button when dirty, amber when renames are low, red +
 * disabled at zero. So this only surfaces the two things a glow can't say: the
 * print-lock, and a hard save error. Everything else renders nothing.
 */
function SaveStateHint({
  state,
  nameLocked,
}: {
  state: SaveState;
  nameLocked: boolean;
}) {
  const base: React.CSSProperties = { fontSize: 13, minHeight: 18 };

  if (nameLocked || state.kind === "locked") {
    return (
      <span id="bib-name-hint" role="status" style={{ ...base, color: "#6CCDB8" }}>
        Name locked for print — contact organizers to change it.
      </span>
    );
  }
  if (state.kind === "error") {
    return (
      <span id="bib-name-hint" role="status" style={{ ...base, color: "#ff8a8a" }}>
        Save failed ({state.detail}) — try again.
      </span>
    );
  }
  // idle / saving / saved / quota → conveyed by the field + Save-button glows.
  return <span id="bib-name-hint" role="status" style={base} />;
}

export default BibForm;
