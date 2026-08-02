"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApiUrl } from "@/lib/admin-api-base";

type AdminRoute = {
  routeId: string;
  name: string;
  description?: string;
  routeType?: string;
  ownerId: string;
  createdByName?: string;
  totalDistance?: number;
  copyCount?: number;
  publishedAt?: number;
  hasBackingFile?: boolean;
};

/**
 * Moderation table. All values render as JSX text nodes (auto-escaped) —
 * never dangerouslySetInnerHTML: route names/descriptions are user input.
 */
export default function RoutesTable() {
  const [routes, setRoutes] = useState<AdminRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(adminApiUrl("/api/gpx/admin/routes"), {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const data = await res.json();
      setRoutes(data.routes ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function unpublish(routeId: string) {
    if (!window.confirm("Unpublish this route for everyone?")) return;
    setBusy(routeId);
    try {
      const res = await fetch(
        adminApiUrl(`/api/gpx/admin/routes/${encodeURIComponent(routeId)}/unpublish`),
        { method: "POST", credentials: "include" }
      );
      if (!res.ok) throw new Error(`Unpublish failed (${res.status})`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unpublish failed");
    } finally {
      setBusy(null);
    }
  }

  async function hardDelete(r: AdminRoute) {
    // An orphan Route IS the owner's route — there is no file behind it — so
    // say that plainly rather than hiding it behind a generic confirm.
    const warning =
      r.hasBackingFile === false
        ? `Delete "${r.name}" permanently?\n\nThis route has no backing file, so this removes the owner's ONLY copy. Unpublish is reversible — use that unless you mean to destroy it.`
        : `Delete "${r.name}" permanently?\n\nRemoves it from the community map for good. The owner keeps their own file, and copies other runners already saved are unaffected.`;
    if (!window.confirm(warning)) return;
    setBusy(r.routeId);
    try {
      const res = await fetch(
        adminApiUrl(`/api/gpx/admin/routes/${encodeURIComponent(r.routeId)}`),
        { method: "DELETE", credentials: "include" }
      );
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <p>Loading…</p>;
  if (error) return <p style={{ color: "#b00" }}>{error}</p>;
  if (routes.length === 0) return <p>No published community routes.</p>;

  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr style={{ textAlign: "left", borderBottom: "2px solid #ccc" }}>
          <th style={{ padding: "0.4rem" }}>Name</th>
          <th style={{ padding: "0.4rem" }}>By</th>
          <th style={{ padding: "0.4rem" }}>Type</th>
          <th style={{ padding: "0.4rem" }}>Distance</th>
          <th style={{ padding: "0.4rem" }}>Copies</th>
          <th style={{ padding: "0.4rem" }}>Published</th>
          <th style={{ padding: "0.4rem" }}></th>
        </tr>
      </thead>
      <tbody>
        {routes.map((r) => (
          <tr key={r.routeId} style={{ borderBottom: "1px solid #eee" }}>
            <td style={{ padding: "0.4rem" }} title={r.description ?? ""}>
              {r.name}
            </td>
            <td style={{ padding: "0.4rem" }}>
              {r.createdByName || "(anonymous)"}
              <span style={{ color: "#999", fontSize: "0.75rem", display: "block" }}>
                {r.ownerId}
              </span>
            </td>
            <td style={{ padding: "0.4rem" }}>{r.routeType ?? "—"}</td>
            <td style={{ padding: "0.4rem" }}>
              {r.totalDistance
                ? `${(r.totalDistance / 1000).toFixed(1)} km`
                : "—"}
            </td>
            <td style={{ padding: "0.4rem" }}>{r.copyCount ?? 0}</td>
            <td style={{ padding: "0.4rem" }}>
              {r.publishedAt
                ? new Date(r.publishedAt).toLocaleString()
                : "—"}
            </td>
            <td style={{ padding: "0.4rem", whiteSpace: "nowrap" }}>
              <button
                onClick={() => void unpublish(r.routeId)}
                disabled={busy === r.routeId}
                style={{
                  padding: "0.25rem 0.6rem",
                  cursor: "pointer",
                  color: "#b00",
                }}
              >
                {busy === r.routeId ? "…" : "Unpublish"}
              </button>
              <button
                onClick={() => void hardDelete(r)}
                disabled={busy === r.routeId}
                title={
                  r.hasBackingFile === false
                    ? "No backing file — deleting removes the owner's only copy"
                    : "Removes the public copy; the owner keeps their file"
                }
                style={{
                  padding: "0.25rem 0.6rem",
                  marginLeft: "0.35rem",
                  cursor: "pointer",
                  color: "#fff",
                  background: "#b00",
                  border: "1px solid #900",
                  borderRadius: "4px",
                }}
              >
                {busy === r.routeId ? "…" : "Delete"}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
