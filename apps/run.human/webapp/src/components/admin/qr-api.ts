import { apiBase } from "./qr-ui";

/**
 * Client-side helpers for POSTing QR/CTF admin mutations to /api/admin/qr.
 * Region-basePath-aware (prod app is mounted under /use1). Throws Error(message)
 * on a non-2xx so callers can surface the server's validation message.
 */
export interface AdminQrResult {
  success: boolean;
  message?: string;
  data?: {
    code?: string;
    challenge?: string;
    // ctf_otp_reveal payload (present only on that action).
    secret?: string;
    otpauth?: string;
    digits?: number;
    period?: number;
    algorithm?: string;
    // ctf_effect_reveal payload (present only on that action).
    effect?: unknown;
    // ghost_otp_reveal payload (present only on that action, Phase 67).
    ghostId?: string;
    configured?: boolean;
    committedSecret?: string;
  };
}

export async function postQrAction(body: unknown): Promise<AdminQrResult> {
  const res = await fetch(`${apiBase()}/api/admin/qr`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  // A 404 here means the admin gate denied us (non-disclosure) — surface plainly.
  if (res.status === 404) {
    throw new Error("Not authorized.");
  }
  let data: AdminQrResult;
  try {
    data = (await res.json()) as AdminQrResult;
  } catch {
    throw new Error(`Request failed (${res.status}).`);
  }
  if (!res.ok || !data.success) {
    throw new Error(data.message || `Request failed (${res.status}).`);
  }
  return data;
}
