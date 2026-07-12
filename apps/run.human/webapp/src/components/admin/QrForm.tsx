"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { cls, QR_ORIGIN } from "./qr-ui";
import { postQrAction } from "./qr-api";

/** Loose row shapes — mirror the entity's permissive rules/enrich maps. */
interface RuleRow {
  _id: string;
  kind: "time" | "param";
  from?: string;
  to?: string;
  match?: string;
  dest?: string;
}

export interface QrRecord {
  code: string;
  type?: string;
  destination?: string;
  rules?: Array<{ kind?: string; from?: string; to?: string; match?: string; dest?: string }>;
  enrich?: {
    preserveQuery?: boolean;
    appendParam?: boolean;
    utm?: { source?: string; medium?: string; campaign?: string };
  };
  enabled?: boolean;
  owner?: string;
  notes?: string;
}

function rid(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/**
 * Create/edit form for a QR code (the one interactive unit in /admin/qr).
 * Manages code + destination + rules + enrich locally and POSTs to
 * /api/admin/qr. The server re-validates authoritatively; the https checks here
 * are UX-only. Styled with the site's HeroUI tokens to match AdminConsole.
 */
export default function QrForm({
  initial,
  mode,
}: {
  initial?: QrRecord | null;
  mode: "create" | "edit";
}) {
  const router = useRouter();
  const isEdit = mode === "edit";

  const [code, setCode] = useState(initial?.code ?? "");
  const [destination, setDestination] = useState(initial?.destination ?? "");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [owner, setOwner] = useState(initial?.owner ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [rules, setRules] = useState<RuleRow[]>(
    (initial?.rules ?? []).map((r) => ({
      _id: rid(),
      kind: r.kind === "time" ? "time" : "param",
      from: r.from,
      to: r.to,
      match: r.match,
      dest: r.dest,
    }))
  );
  const [preserveQuery, setPreserveQuery] = useState(initial?.enrich?.preserveQuery ?? false);
  const [appendParam, setAppendParam] = useState(initial?.enrich?.appendParam ?? false);
  const [utmSource, setUtmSource] = useState(initial?.enrich?.utm?.source ?? "");
  const [utmMedium, setUtmMedium] = useState(initial?.enrich?.utm?.medium ?? "");
  const [utmCampaign, setUtmCampaign] = useState(initial?.enrich?.utm?.campaign ?? "");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewCode = code.trim().toUpperCase();

  function updateRule(id: string, patch: Partial<RuleRow>) {
    setRules((rs) => rs.map((r) => (r._id === id ? { ...r, ...patch } : r)));
  }

  async function onSave() {
    setError(null);
    setBusy(true);
    try {
      const qr = {
        code,
        type: "redirect",
        destination,
        enabled,
        owner,
        notes,
        rules: rules.map((r) =>
          r.kind === "time"
            ? { kind: "time", from: r.from ?? "", to: r.to ?? "", dest: r.dest ?? "" }
            : { kind: "param", match: r.match ?? "", dest: r.dest ?? "" }
        ),
        enrich: {
          preserveQuery,
          appendParam,
          utm: { source: utmSource, medium: utmMedium, campaign: utmCampaign },
        },
      };
      await postQrAction({ action: "qr_upsert", qr });
      router.push("/admin/qr");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!confirm(`Delete code ${initial?.code}? This cannot be undone.`)) return;
    setError(null);
    setBusy(true);
    try {
      await postQrAction({ action: "qr_delete", code: initial?.code });
      router.push("/admin/qr");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <div className="rounded-lg border border-danger text-danger bg-danger/10 px-3.5 py-2.5 text-sm">
          {error}
        </div>
      ) : null}

      {/* Code + scannable URL preview */}
      <div className={cls.cardPad}>
        <label className={cls.label}>Short code</label>
        <input
          className={`${cls.input} ${isEdit ? "opacity-60" : ""}`}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="BUNNY"
          disabled={isEdit}
          autoCapitalize="characters"
        />
        <p className="text-[12.5px] text-default-500 mt-2">
          Scans to{" "}
          <span className="text-primary font-mono">
            {QR_ORIGIN}/{previewCode || "<code>"}
          </span>
          {isEdit ? " · code is immutable (delete + recreate to rename)." : "."}
        </p>
      </div>

      {/* Destination */}
      <div className={cls.cardPad}>
        <label className={cls.label}>Default destination (absolute https URL)</label>
        <input
          className={cls.input}
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder="https://run.defcon.run/use1/…"
        />
        <p className="text-[12.5px] text-default-500 mt-2">
          Where a scan lands when no rule matches. Must be <code>https://</code>.
        </p>
      </div>

      {/* Rules */}
      <div className={cls.cardPad}>
        <div className="flex justify-between items-center mb-2.5 gap-2 flex-wrap">
          <label className={`${cls.label} mb-0`}>
            Conditional rules (first match wins, else default)
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              className={cls.btn}
              onClick={() =>
                setRules((rs) => [...rs, { _id: rid(), kind: "param", match: "", dest: "" }])
              }
            >
              + Param rule
            </button>
            <button
              type="button"
              className={cls.btn}
              onClick={() =>
                setRules((rs) => [
                  ...rs,
                  { _id: rid(), kind: "time", from: "", to: "", dest: "" },
                ])
              }
            >
              + Time rule
            </button>
          </div>
        </div>

        {rules.length === 0 ? (
          <p className="text-[13px] text-default-400">
            No rules — every scan uses the default destination.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {rules.map((r) => (
              <div
                key={r._id}
                className="border border-divider rounded-lg p-3 flex flex-wrap gap-2 items-end"
              >
                <div className="w-[110px]">
                  <label className={cls.label}>Kind</label>
                  <select
                    className={cls.select}
                    value={r.kind}
                    onChange={(e) =>
                      updateRule(r._id, { kind: e.target.value as "time" | "param" })
                    }
                  >
                    <option value="param">param</option>
                    <option value="time">time</option>
                  </select>
                </div>
                {r.kind === "param" ? (
                  <div className="flex-1 min-w-[140px]">
                    <label className={cls.label}>Match (?p= value, or *)</label>
                    <input
                      className={cls.input}
                      value={r.match ?? ""}
                      onChange={(e) => updateRule(r._id, { match: e.target.value })}
                      placeholder="42"
                    />
                  </div>
                ) : (
                  <>
                    <div className="flex-1 min-w-[140px]">
                      <label className={cls.label}>From (ISO)</label>
                      <input
                        className={cls.input}
                        value={r.from ?? ""}
                        onChange={(e) => updateRule(r._id, { from: e.target.value })}
                        placeholder="2026-08-08T00:00:00Z"
                      />
                    </div>
                    <div className="flex-1 min-w-[140px]">
                      <label className={cls.label}>To (ISO)</label>
                      <input
                        className={cls.input}
                        value={r.to ?? ""}
                        onChange={(e) => updateRule(r._id, { to: e.target.value })}
                        placeholder="2026-08-11T00:00:00Z"
                      />
                    </div>
                  </>
                )}
                <div className="flex-[2] min-w-[220px]">
                  <label className={cls.label}>Destination (https)</label>
                  <input
                    className={cls.input}
                    value={r.dest ?? ""}
                    onChange={(e) => updateRule(r._id, { dest: e.target.value })}
                    placeholder="https://…"
                  />
                </div>
                <button
                  type="button"
                  className={cls.btnDanger}
                  onClick={() => setRules((rs) => rs.filter((x) => x._id !== r._id))}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Enrich */}
      <div className={cls.cardPad}>
        <label className={cls.label}>Link enrichment</label>
        <div className="flex gap-5 flex-wrap mb-3">
          <label className="flex gap-2 items-center text-sm">
            <input
              type="checkbox"
              checked={preserveQuery}
              onChange={(e) => setPreserveQuery(e.target.checked)}
            />
            Preserve incoming query string
          </label>
          <label className="flex gap-2 items-center text-sm">
            <input
              type="checkbox"
              checked={appendParam}
              onChange={(e) => setAppendParam(e.target.checked)}
            />
            Append scan param <code>p</code>
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div>
            <label className={cls.label}>utm_source</label>
            <input
              className={cls.input}
              value={utmSource}
              onChange={(e) => setUtmSource(e.target.value)}
            />
          </div>
          <div>
            <label className={cls.label}>utm_medium</label>
            <input
              className={cls.input}
              value={utmMedium}
              onChange={(e) => setUtmMedium(e.target.value)}
            />
          </div>
          <div>
            <label className={cls.label}>utm_campaign</label>
            <input
              className={cls.input}
              value={utmCampaign}
              onChange={(e) => setUtmCampaign(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Meta */}
      <div className={cls.cardPad}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <label className={cls.label}>Owner (optional)</label>
            <input
              className={cls.input}
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
            />
          </div>
          <div>
            <label className={cls.label}>Enabled</label>
            <label className="flex gap-2 items-center text-sm h-9">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Live (disabled codes 404)
            </label>
          </div>
        </div>
        <div className="mt-2.5">
          <label className={cls.label}>Notes (optional)</label>
          <input className={cls.input} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2.5 items-center">
        <button type="button" className={cls.btnPrimary} onClick={onSave} disabled={busy}>
          {busy ? "Saving…" : isEdit ? "Save changes" : "Create code"}
        </button>
        <button
          type="button"
          className={cls.btn}
          onClick={() => router.push("/admin/qr")}
          disabled={busy}
        >
          Cancel
        </button>
        {isEdit ? (
          <button
            type="button"
            className={`${cls.btnDanger} ml-auto`}
            onClick={onDelete}
            disabled={busy}
          >
            Delete
          </button>
        ) : null}
      </div>
    </div>
  );
}
