"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const dangerBtn = "text-[13px] font-semibold rounded-md px-3 py-1.5 border transition disabled:opacity-50";

export function LockAction({ userId, locked, onComplete }: { userId: string; locked: boolean; onComplete?: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function go() {
    if (!window.confirm(locked ? "Unlock this identity?" : "Lock out this identity? All their sessions are revoked immediately.")) return;
    setBusy(true); setFailed(false);
    const res = await fetch(`/api/admin/identities/${encodeURIComponent(userId)}/lock`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locked: !locked }),
    });
    setBusy(false);
    if (res.ok) { router.refresh(); onComplete?.(); } else setFailed(true);
  }
  return (
    <button onClick={go} disabled={busy}
      className={dangerBtn + " border-warning text-warning"}>
      {busy ? "…" : locked ? "Unlock" : "Lock out"}{failed ? " ✕" : ""}
    </button>
  );
}

export function UnlinkAction({ userId, provider, providerAccountId, onComplete }: { userId: string; provider: string; providerAccountId: string; onComplete?: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function go() {
    if (!window.confirm(`Unlink the ${provider} account from this identity?`)) return;
    setBusy(true); setFailed(false);
    const res = await fetch(`/api/admin/identities/${encodeURIComponent(userId)}/unlink`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, providerAccountId }),
    });
    setBusy(false);
    if (res.ok) { router.refresh(); onComplete?.(); } else setFailed(true);
  }
  return (
    <button onClick={go} disabled={busy}
      className={dangerBtn + " border-default-300 text-default-500"}>
      {busy ? "…" : "Unlink"}{failed ? " ✕" : ""}
    </button>
  );
}

export function DeleteIdentityAction({ userId, displayName, onComplete }: { userId: string; displayName: string; onComplete?: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function go() {
    setBusy(true); setFailed(false);
    const res = await fetch(`/api/admin/identities/${encodeURIComponent(userId)}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) { setOpen(false); router.refresh(); onComplete?.(); } else setFailed(true);
  }
  if (!open) {
    return <button onClick={() => setOpen(true)} className={dangerBtn + " border-danger text-danger"}>Hard delete…</button>;
  }
  return (
    <div className="rounded-lg border border-danger/50 bg-danger/5 p-3 space-y-2">
      <p className="text-[13px] text-danger">Type <code className="font-mono">{displayName}</code> to permanently delete this identity (run.auth only — run.human/bib are not touched).</p>
      <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
        className="w-full rounded-md border border-default-300 bg-content1 px-2 py-1 text-sm" placeholder={displayName} />
      <div className="flex gap-2">
        <button disabled={busy || !displayName || confirmText !== displayName} onClick={go}
          className={dangerBtn + " border-danger text-danger"}>{busy ? "Deleting…" : "Delete permanently"}</button>
        <button onClick={() => { setOpen(false); setConfirmText(""); }} className={dangerBtn + " border-default-300 text-default-500"}>Cancel</button>
      </div>
      {failed && <p className="text-[12px] text-danger">Delete failed — try again.</p>}
    </div>
  );
}
