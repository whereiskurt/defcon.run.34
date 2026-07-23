"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { cls, QR_ORIGIN } from "./qr-ui";
import { postQrAction } from "./qr-api";
import ScheduleEditor from "./ScheduleEditor";
import {
  ptWallClockToUtcIso,
  utcToPtParts,
  type ScheduleEntry,
} from "@/lib/qr-schedule";

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
  schedule?: Array<{ startsAt?: string; dest?: string; label?: string }>;
  enrich?: {
    preserveQuery?: boolean;
    appendParam?: boolean;
    utm?: { source?: string; medium?: string; campaign?: string };
  };
  enabled?: boolean;
  owner?: string;
  notes?: string;
  unfurl?: string;
}

function rid(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

// ── Time-rule datetime helpers ──────────────────────────────────────────────
// The entity stores rule from/to as absolute ISO strings; the resolver compares
// them with Date.parse against now (half-open [from, to)). A <input
// type="datetime-local"> speaks LOCAL wall-clock "YYYY-MM-DDTHH:mm", so we
// convert: the admin picks their browser-local time, and we persist UTC ISO
// (unambiguous for the Lambda, which runs in UTC). Round-trips consistently.

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Stored ISO → the local "YYYY-MM-DDTHH:mm" a datetime-local input wants. */
function toLocalInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}`;
}

/** datetime-local value (local wall-clock) → stored UTC ISO (or "" when empty). */
function fromLocalInput(local: string): string {
  if (!local) return "";
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

const isoOf = (d: Date) => d.toISOString();
/** Local midnight `offset` days from today. */
function startOfDay(offset: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
}

/** Quick presets that populate a time rule's from/to (computed in local time). */
const TIME_PRESETS: Array<{ label: string; range: () => { from: string; to: string } }> = [
  {
    label: "Next 24h",
    range: () => {
      const now = new Date();
      return { from: isoOf(now), to: isoOf(new Date(now.getTime() + 24 * 3600e3)) };
    },
  },
  {
    label: "Rest of today",
    range: () => {
      const end = new Date();
      end.setHours(23, 59, 0, 0);
      return { from: isoOf(new Date()), to: isoOf(end) };
    },
  },
  {
    label: "Tomorrow",
    range: () => ({ from: isoOf(startOfDay(1)), to: isoOf(startOfDay(2)) }),
  },
  {
    label: "This weekend",
    range: () => {
      const base = new Date();
      base.setHours(0, 0, 0, 0);
      const day = base.getDay(); // 0 Sun … 6 Sat
      const sat = new Date(base);
      // Sunday → the weekend that started yesterday; otherwise the next Saturday.
      sat.setDate(base.getDate() + (day === 0 ? -1 : (6 - day + 7) % 7));
      const mon = new Date(sat);
      mon.setDate(sat.getDate() + 2);
      return { from: isoOf(sat), to: isoOf(mon) };
    },
  },
  {
    label: "Next 2 weeks",
    range: () => {
      const now = new Date();
      return { from: isoOf(now), to: isoOf(new Date(now.getTime() + 14 * 86400e3)) };
    },
  },
  {
    // DEF CON 34 window (local). Editable after applying.
    label: "DEF CON 34",
    range: () => ({
      from: isoOf(new Date(2026, 7, 6, 0, 0, 0)),
      to: isoOf(new Date(2026, 7, 10, 0, 0, 0)),
    }),
  },
];

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
  const [unfurl, setUnfurl] = useState(initial?.unfurl ?? "");
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
  const [schedule, setSchedule] = useState<ScheduleEntry[]>(
    (initial?.schedule ?? [])
      .filter((e): e is { startsAt: string; dest?: string; label?: string } => !!e?.startsAt)
      .map((e) => ({ startsAt: e.startsAt, dest: e.dest ?? "", label: e.label }))
  );
  const hasSchedule = schedule.length > 0;
  const [preserveQuery, setPreserveQuery] = useState(initial?.enrich?.preserveQuery ?? false);
  const [appendParam, setAppendParam] = useState(initial?.enrich?.appendParam ?? false);
  const [utmSource, setUtmSource] = useState(initial?.enrich?.utm?.source ?? "");
  const [utmMedium, setUtmMedium] = useState(initial?.enrich?.utm?.medium ?? "");
  const [utmCampaign, setUtmCampaign] = useState(initial?.enrich?.utm?.campaign ?? "");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewCode = code.trim().toLowerCase();

  function updateRule(id: string, patch: Partial<RuleRow>) {
    setRules((rs) => rs.map((r) => (r._id === id ? { ...r, ...patch } : r)));
  }

  /**
   * Build the qr_upsert payload. When a schedule exists it is the source of
   * truth — the server compiles it into `rules` and IGNORES any raw rules — so
   * we send the schedule and an empty raw-rules list to avoid two editors
   * fighting. `scheduleArg` lets Publish-now save an appended schedule directly.
   */
  function buildQr(scheduleArg: ScheduleEntry[]) {
    const scheduled = scheduleArg.length > 0;
    return {
      code,
      type: "redirect",
      destination,
      enabled,
      owner,
      notes,
      unfurl,
      schedule: scheduleArg,
      rules: scheduled
        ? []
        : rules.map((r) =>
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
  }

  /** Fast client guard mirroring the server (which re-validates authoritatively). */
  function validate(scheduleArg: ScheduleEntry[]): string | null {
    if (scheduleArg.length > 0) {
      for (let i = 0; i < scheduleArg.length; i++) {
        const e = scheduleArg[i];
        const where = `Switch-point ${i + 1}`;
        if (!(e.dest ?? "").trim()) return `${where} needs a destination.`;
        if (!/^https:\/\//i.test((e.dest ?? "").trim()))
          return `${where} destination must be an https:// URL.`;
        if (!e.startsAt || Number.isNaN(Date.parse(e.startsAt)))
          return `${where} needs a valid time.`;
      }
      return null;
    }
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      const where = `Rule ${i + 1}`;
      if (!(r.dest ?? "").trim()) return `${where} needs a destination.`;
      if (!/^https:\/\//i.test((r.dest ?? "").trim()))
        return `${where} destination must be an https:// URL.`;
      if (r.kind === "time" && (!r.from || !r.to))
        return `${where} (time) needs a From and a To - use a preset or the pickers.`;
      if (r.kind === "param" && !(r.match ?? "").trim())
        return `${where} (param) needs a match value (use * for any).`;
    }
    return null;
  }

  async function onSave() {
    setError(null);
    const problem = validate(schedule);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      await postQrAction({ action: "qr_upsert", qr: buildQr(schedule) });
      router.push("/admin/qr");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
      setBusy(false);
    }
  }

  /**
   * Publish now — append a switch-point at the current Vegas minute and save
   * immediately, flipping where the code points live (within ~60s of resolver
   * cache). Works on the code as currently entered.
   */
  async function onPublishNow() {
    setError(null);
    const dest = window.prompt("Publish now - destination URL (https://…):", "");
    if (!dest) return;
    const p = utcToPtParts(new Date().toISOString());
    const startsAt = ptWallClockToUtcIso(p.y, p.mo1, p.d, p.h, p.mi);
    const next: ScheduleEntry[] = [...schedule, { startsAt, dest: dest.trim() }];
    const problem = validate(next);
    if (problem) {
      setError(problem);
      return;
    }
    setSchedule(next);
    setBusy(true);
    try {
      await postQrAction({ action: "qr_upsert", qr: buildQr(next) });
      router.refresh();
      setBusy(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publish failed.");
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
          placeholder="bunny"
          disabled={isEdit}
          autoCapitalize="none"
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

      {/* Schedule (dynamic scheduled code) */}
      <div className={cls.cardPad}>
        <div className="flex justify-between items-center mb-2.5 gap-2 flex-wrap">
          <label className={`${cls.label} mb-0`}>
            Schedule - dynamic scheduled code (timeline of switch-points)
          </label>
          <button
            type="button"
            className={cls.btn}
            onClick={onPublishNow}
            disabled={busy}
            title="Append a switch-point at the current Vegas minute and save now"
          >
            ⚡ Publish now
          </button>
        </div>
        <ScheduleEditor value={schedule} onChange={setSchedule} />
      </div>

      {/* Rules - raw conditional rules. A schedule (above) compiles into these and
          owns them, so the raw editor is disabled while a schedule exists. */}
      <div className={cls.cardPad}>
        <div className="flex justify-between items-center mb-2.5 gap-2 flex-wrap">
          <label className={`${cls.label} mb-0`}>
            Conditional rules (first match wins, else default)
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              className={cls.btn}
              disabled={hasSchedule}
              onClick={() =>
                setRules((rs) => [...rs, { _id: rid(), kind: "param", match: "", dest: "" }])
              }
            >
              + Param rule
            </button>
            <button
              type="button"
              className={cls.btn}
              disabled={hasSchedule}
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

        {hasSchedule ? (
          <p className="text-[13px] text-warning">
            Rules are generated from the schedule above. Clear the schedule to edit
            raw rules directly.
          </p>
        ) : null}

        {hasSchedule ? null : rules.length === 0 ? (
          <p className="text-[13px] text-default-400">
            No rules - every scan uses the default destination.
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
                    {/* Quick presets - populate both From and To. Forces its own
                        line in the flex-wrap row via w-full. */}
                    <div className="w-full flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-default-400 mr-1">Quick set:</span>
                      {TIME_PRESETS.map((p) => (
                        <button
                          key={p.label}
                          type="button"
                          className="text-[11px] px-2 py-1 rounded-full border border-divider text-default-500 hover:bg-content2 hover:text-foreground transition-colors"
                          onClick={() => updateRule(r._id, p.range())}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex-1 min-w-[160px]">
                      <label className={cls.label}>From</label>
                      <input
                        type="datetime-local"
                        className={cls.input}
                        value={toLocalInput(r.from)}
                        onChange={(e) =>
                          updateRule(r._id, { from: fromLocalInput(e.target.value) })
                        }
                      />
                    </div>
                    <div className="flex-1 min-w-[160px]">
                      <label className={cls.label}>To</label>
                      <input
                        type="datetime-local"
                        className={cls.input}
                        value={toLocalInput(r.to)}
                        onChange={(e) =>
                          updateRule(r._id, { to: fromLocalInput(e.target.value) })
                        }
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
        <div className="mt-2.5">
          <label className={cls.label}>Unfurl preview (optional)</label>
          <select
            className={cls.input}
            value={unfurl}
            onChange={(e) => setUnfurl(e.target.value)}
          >
            <option value="">None - plain redirect</option>
            <option value="cherries">🍒 Cherries (CTF jackpot card)</option>
          </select>
          <p className="mt-1 text-xs text-default-400">
            Shows a social-media preview card when this link is shared (e.g. a CTF
            flag-award link). Only affects link-preview crawlers; people still
            redirect instantly.
          </p>
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
