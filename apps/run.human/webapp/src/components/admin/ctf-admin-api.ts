import { apiBase } from "./qr-ui";

/**
 * Client helper for the destructive CTF board actions (POST
 * /api/admin/ctf-leaderboard). Region-basePath-aware (prod app is under /use1).
 * A 404 means the admin gate denied us (non-disclosure); anything non-2xx throws
 * Error(message) so the caller can surface the server's reason.
 */
export interface CtfAdminResult {
  success: boolean;
  message?: string;
  data?: unknown;
}

export async function postCtfLeaderboardAction(
  body: unknown
): Promise<CtfAdminResult> {
  const res = await fetch(`${apiBase()}/api/admin/ctf-leaderboard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 404) {
    throw new Error("Not authorized.");
  }
  let data: CtfAdminResult;
  try {
    data = (await res.json()) as CtfAdminResult;
  } catch {
    throw new Error(`Request failed (${res.status}).`);
  }
  if (!res.ok || !data.success) {
    throw new Error(data.message || `Request failed (${res.status}).`);
  }
  return data;
}
