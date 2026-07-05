"use client";

import { useEffect, useState } from "react";

/**
 * StripeStatusBanner (Kurt 2026-07-05 — now client + auto-dismiss).
 *
 * Acknowledges the Stripe redirect outcome (`?status=success|cancel`). It used to
 * linger until the next navigation cleared the query string; now it dismisses the
 * moment the runner touches the form again — types a name, toggles a checkbox, or
 * attempts another donate — so a stale "checkout cancelled" toast doesn't hang
 * around. Listens for the first `input` / `change` / `submit` anywhere on the page
 * (which the name field, the checkboxes, and the donate forms all fire).
 */
export function StripeStatusBanner({ status }: { status: "success" | "cancel" }) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const dismiss = () => setDismissed(true);
    const opts = { once: true } as AddEventListenerOptions;
    window.addEventListener("input", dismiss, opts);
    window.addEventListener("change", dismiss, opts);
    window.addEventListener("submit", dismiss, opts);
    return () => {
      window.removeEventListener("input", dismiss);
      window.removeEventListener("change", dismiss);
      window.removeEventListener("submit", dismiss);
    };
  }, []);

  if (dismissed) return null;

  const isSuccess = status === "success";
  const message = isSuccess
    ? "Payment received — thanks for supporting defcon.run 34! Reconciliation may take a moment."
    : "Checkout cancelled. No charge was made — you can try again below.";

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: "12px 16px",
        borderRadius: 6,
        backgroundColor: isSuccess ? "#1a3a24" : "#3a2a1a",
        border: `1px solid ${isSuccess ? "#3a7f5c" : "#7f5a3a"}`,
        color: isSuccess ? "#7fdc9e" : "#f4c680",
        fontSize: 14,
      }}
    >
      {message}
    </div>
  );
}

export default StripeStatusBanner;
