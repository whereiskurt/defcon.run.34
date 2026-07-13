"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const dangerBtn = "text-[13px] font-semibold rounded-md px-3 py-1.5 border transition disabled:opacity-50";
// Full-width, two-line action button: bold title + muted description line.
const blockBtn = "w-full text-left rounded-md px-3 py-2 border transition disabled:opacity-50";

export function LockAction({ userId, locked, onComplete }: { userId: string; locked: boolean; onComplete?: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function go() {
    if (!window.confirm(locked
      ? "Unlock this identity? They regain access immediately."
      : "Lock out this identity? All their SSO sessions are revoked immediately and the account is blocked.")) return;
    setBusy(true); setFailed(false);
    const res = await fetch(`/api/admin/identities/${encodeURIComponent(userId)}/lock`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locked: !locked }),
    });
    setBusy(false);
    if (res.ok) { router.refresh(); onComplete?.(); } else setFailed(true);
  }
  return (
    <div>
      <button onClick={go} disabled={busy}
        className={`${blockBtn} ${locked ? "border-success text-success" : "border-warning text-warning"}`}>
        <span className="block font-semibold">{busy ? "…" : locked ? "🔓 Unlock" : "🔒 Lock out"}</span>
        <span className="block text-[11px] font-normal text-default-500">
          {locked ? "Restores access immediately" : "Kills all SSO sessions now + blocks the account"}
        </span>
      </button>
      {failed && <p className="mt-1 text-[12px] text-danger">{locked ? "Unlock" : "Lock"} failed — retry.</p>}
    </div>
  );
}

export function JailAction({ userId, jailed, jailLevel, onComplete }: { userId: string; jailed: boolean; jailLevel: number | null; onComplete?: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [level, setLevel] = useState<number>(jailLevel ?? 1);
  async function go() {
    if (jailed) {
      if (!window.confirm("Release this identity from jail?")) return;
    } else {
      if (!window.confirm(`Jail this identity at level ${level}? They'll face escalated Altcha friction on their next interactive login.`)) return;
    }
    setBusy(true); setFailed(false);
    const res = await fetch(`/api/admin/identities/${encodeURIComponent(userId)}/jail`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(jailed ? { jailed: false } : { jailed: true, level }),
    });
    setBusy(false);
    if (res.ok) { router.refresh(); onComplete?.(); } else setFailed(true);
  }
  if (jailed) {
    return (
      <div>
        <button onClick={go} disabled={busy} className={`${blockBtn} border-success text-success`}>
          <span className="block font-semibold">{busy ? "…" : "⛓ Release from jail"}</span>
          <span className="block text-[11px] font-normal text-default-500">Currently jailed · L{jailLevel ?? 1} — clears the Altcha friction</span>
        </button>
        {failed && <p className="mt-1 text-[12px] text-danger">Release failed — retry.</p>}
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-stretch gap-2">
        <label className="flex items-center gap-1 rounded-md border border-default-300 px-2 text-[11px] text-default-500">
          Difficulty
          <select aria-label="Jail difficulty level" value={level} onChange={(e) => setLevel(Number(e.target.value))}
            className="bg-transparent py-1 text-xs text-foreground focus:outline-none">
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>L{n}</option>)}
          </select>
        </label>
        <button onClick={go} disabled={busy} className={`${blockBtn} flex-1 border-secondary text-secondary`}>
          <span className="block font-semibold">{busy ? "…" : "⛓ Jail"}</span>
          <span className="block text-[11px] font-normal text-default-500">Escalated Altcha friction on next login</span>
        </button>
      </div>
      {failed && <p className="mt-1 text-[12px] text-danger">Jail failed — retry.</p>}
    </div>
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
