/**
 * Shared, framework-neutral constants + Tailwind class strings for the
 * /admin/qr surface. Imported by BOTH the server pages and the "use client"
 * forms, so keep it side-effect-free (no server imports). Class strings use the
 * site's HeroUI semantic tokens (bg-content1, border-divider, text-primary …)
 * so the QR admin reads as native run.human, matching AdminConsole.
 */

/** The public resolver origin — where a scanned code lives. */
export const QR_ORIGIN = "https://q.defcon.run";

/** Region-aware base for client fetches to internal APIs (prod app is under /use1). */
export function apiBase(): string {
  return process.env.NODE_ENV === "production"
    ? `/${process.env.NEXT_PUBLIC_REGION_SHORT || "use1"}`
    : "";
}

/** Reusable class strings, matching the AdminConsole visual language. */
export const cls = {
  root: "flex flex-col gap-5 py-2",
  card: "bg-content1 border border-divider rounded-xl",
  cardPad: "bg-content1 border border-divider rounded-xl p-4",
  h1: "font-museo text-2xl font-bold tracking-tight",
  h2: "font-museo text-lg font-semibold",
  sub: "text-sm text-default-500",
  label: "block text-[11px] uppercase tracking-wide text-default-400 mb-1.5",
  input:
    "w-full h-9 rounded-lg border border-divider bg-content1 text-foreground text-[13px] px-3 outline-none focus:border-primary",
  textarea:
    "w-full min-h-[110px] rounded-lg border border-divider bg-content1 text-foreground font-mono text-[13px] p-3 outline-none focus:border-primary",
  select:
    "w-full h-9 rounded-lg border border-divider bg-content1 text-foreground text-[13px] px-2 outline-none focus:border-primary",
  btn:
    "inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-divider bg-content1 text-foreground text-[13px] font-semibold hover:bg-content2 transition-colors disabled:opacity-50",
  btnPrimary:
    "inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-primary text-black text-[13px] font-semibold hover:opacity-90 disabled:opacity-50",
  btnDanger:
    "inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-danger text-danger text-[13px] font-semibold hover:bg-danger/10 transition-colors disabled:opacity-50",
  table: "w-full border-collapse",
  thead: "bg-content2 text-[11px] uppercase tracking-wide text-default-400",
  th: "text-left px-4 py-2.5 font-semibold whitespace-nowrap",
  tr: "border-t border-divider hover:bg-content2",
  td: "px-4 py-2.5 text-[12.5px] font-mono whitespace-nowrap",
  mono: "font-mono",
  // Segmented control (challenge-type presets + answer type). A row of these
  // buttons; the selected one carries the `primary` accent, the rest stay
  // neutral. Height + horizontal padding follow the surface's h-9 / px-3.5
  // control rhythm. Reused by future slices 55/56 (D2).
  segment:
    "inline-flex items-center justify-center h-9 px-3.5 rounded-lg border border-divider text-[13px] font-semibold transition-colors disabled:opacity-50",
  segmentActive: "bg-primary text-black border-primary",
  segmentIdle: "bg-content1 text-foreground hover:bg-content2",
  // Small status/label pill (e.g. the parsed OTP digits/period/algorithm summary).
  chip:
    "inline-flex items-center gap-1 h-7 px-2.5 rounded-full border border-divider bg-content1 text-[12px] text-default-500",
  // Card for the reward reveal preview (holds the reused CtfOtpEnroll renderer).
  rewardCard: "bg-content1 border border-divider rounded-xl p-4",
} as const;
