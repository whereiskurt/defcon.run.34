"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { postCtfLeaderboardAction } from "./ctf-admin-api";

/**
 * Destructive admin action button for the CTF board — a UI wrapper around
 * reset-ctf-user.mts (see lib/ctf-unsolve-store).
 *
 *   kind="zero"     → zero the whole runner (delete every solve, reset score).
 *   kind="unsolve"  → unsolve one `challenge` for the runner (decrement).
 *
 * Both are irreversible, so a `confirm()` guards the click before any POST. On
 * success the router refreshes so the standings/drill re-render from the live
 * scan. A denial (404) or server error surfaces as a title-tooltip on the row.
 */
export default function CtfUnsolveButton({
  user,
  challenge,
  kind,
  label,
}: {
  user: string;
  challenge?: string;
  kind: "zero" | "unsolve";
  label?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const text = label ?? (kind === "zero" ? "Zero" : "Unsolve");

  async function onClick() {
    const prompt =
      kind === "zero"
        ? `Zero this runner? Deletes every CTF solve and resets their score to 0. This cannot be undone.`
        : `Unsolve ${challenge} for this runner? Deletes the solve and decrements their score. This cannot be undone.`;
    if (!confirm(prompt)) return;
    setError(null);
    setBusy(true);
    try {
      await postCtfLeaderboardAction(
        kind === "zero"
          ? { action: "unsolve_user", user }
          : { action: "unsolve_challenge", user, challenge }
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={error ?? undefined}
      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors disabled:opacity-50 ${
        error
          ? "border-danger text-danger"
          : "border-danger/40 text-danger hover:bg-danger/10"
      }`}
    >
      {busy ? "…" : error ? "Retry" : text}
    </button>
  );
}
