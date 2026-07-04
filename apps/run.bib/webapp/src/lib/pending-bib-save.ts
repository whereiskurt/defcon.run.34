"use client";

/**
 * Tiny cross-component bridge so the Sponsor/Donate CTA (SponsorForm) can
 * flush an unsaved bib name (BibForm) before it redirects to checkout.
 *
 * BibForm registers a flush fn on mount; SponsorForm awaits it on submit.
 * Kurt 2026-07-04: runners kept clicking Purchase/Donate with an unsaved
 * name, so their bib printed the placeholder instead of what they typed.
 * Auto-commit the pending name for them before we leave the page.
 *
 * The flusher is a module-level singleton — there is only ever one BibForm
 * on the page. It is a no-op when nothing is registered or the name is not
 * dirty (BibForm.onSave self-guards).
 */
type Flusher = () => Promise<void>;

let flusher: Flusher | null = null;

export function registerBibFlusher(fn: Flusher | null): void {
  flusher = fn;
}

export async function flushPendingBibName(): Promise<void> {
  if (!flusher) return;
  try {
    await flusher();
  } catch {
    // Save failures surface in BibForm's own SaveStateHint — never block
    // the checkout redirect on a name-save hiccup.
  }
}
