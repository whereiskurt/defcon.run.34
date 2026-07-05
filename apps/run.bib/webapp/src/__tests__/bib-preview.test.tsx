import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Plan 22-05-06 tests: BibPreview sponsor charm accent.
 *
 * BibPreview is a pure server-component (no state, no effects) so we can
 * render it to a static string via react-dom/server and pin the expected
 * SVG shape without booting jsdom. We deliberately test the SVG's DOM
 * shape (does the charm group appear? does it disappear?) rather than
 * rendering-pixel diffs — the visual choice (star + mint circle) is
 * Kurt's Phase 23 deploy-inspection call.
 */

import BibPreview from "@/components/BibPreview";

describe("BibPreview sponsor charm accent (Phase 22-05-06)", () => {
  it("renders the sponsor-charm SVG group when hasSponsored=true", () => {
    const html = renderToStaticMarkup(
      <BibPreview name="Alice" hasSponsored={true} />
    );
    expect(html).toContain('id="sponsor-charm"');
    expect(html).toContain('data-testid="sponsor-charm"');
    // Amber fill on the outer circle — the charm's visual signature.
    expect(html).toContain("#3a8f79");
  });

  it("does NOT render the sponsor-charm group when hasSponsored=false", () => {
    const html = renderToStaticMarkup(
      <BibPreview name="Alice" hasSponsored={false} />
    );
    expect(html).not.toContain('id="sponsor-charm"');
    expect(html).not.toContain('data-testid="sponsor-charm"');
  });

  it("defaults hasSponsored=false when the prop is omitted (backward compat)", () => {
    // Ensures pre-22-05 callers keep their old render.
    const html = renderToStaticMarkup(
      <BibPreview name="Alice" />
    );
    expect(html).not.toContain('id="sponsor-charm"');
  });

  it("renders the charm regardless of whether a name is present", () => {
    // The charm placement is fixed in the SVG viewport (top-right of the
    // card), so an empty-name preview should still show it.
    const html = renderToStaticMarkup(
      <BibPreview name="" hasSponsored={true} />
    );
    expect(html).toContain('id="sponsor-charm"');
  });

  it("renders the UNSAVED stamp and suppresses PAID while dirty (Plan 34-03, SC34.5)", () => {
    // A dirty (unsaved) name must show the red-orange UNSAVED stamp and MUST
    // outrank/suppress the green PAID stamp even when hasSponsored is true —
    // an unsaved name can never read as a committed, paid bib.
    const html = renderToStaticMarkup(
      <BibPreview name="Alice" hasSponsored={true} dirty={true} />
    );
    expect(html).toContain('id="unsaved-charm"');
    expect(html).toContain('data-testid="unsaved-charm"');
    // Red-orange UNSAVED fill — its visual signature, distinct from PAID mint.
    expect(html).toContain("#C2410C");
    // PAID group is suppressed while dirty.
    expect(html).not.toContain('id="sponsor-charm"');
    expect(html).not.toContain('data-testid="sponsor-charm"');
  });

  it("shows PAID (not UNSAVED) once the name is clean", () => {
    // dirty=false → the sponsor PAID charm is restored, no UNSAVED stamp.
    const html = renderToStaticMarkup(
      <BibPreview name="Alice" hasSponsored={true} dirty={false} />
    );
    expect(html).toContain('id="sponsor-charm"');
    expect(html).not.toContain('id="unsaved-charm"');
  });

  it("defaults dirty=false when the prop is omitted (backward compat)", () => {
    const html = renderToStaticMarkup(
      <BibPreview name="Alice" hasSponsored={true} />
    );
    expect(html).not.toContain('id="unsaved-charm"');
    expect(html).toContain('id="sponsor-charm"');
  });

  it("keeps the DC34 smiley badge intact regardless of hasSponsored", () => {
    // Regression guard: the sponsor charm accent must not accidentally
    // remove the smiley badge. Kurt 2026-07-03: the smiley is now the
    // processed sticker image referenced by the smiley-circle/square symbols.
    const with_ = renderToStaticMarkup(
      <BibPreview name="Alice" hasSponsored={true} />
    );
    const without = renderToStaticMarkup(
      <BibPreview name="Alice" hasSponsored={false} />
    );
    expect(with_).toContain('id="smiley-circle"');
    expect(without).toContain('id="smiley-circle"');
  });
});
