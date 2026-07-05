"use client";

import BibForm, { type BibFormProps } from "./BibForm";

/**
 * Thin client wrapper for the "Get your bib" section (name field + live
 * preview). Since Plan 34-03 the pay-in-person checkbox no longer lives here
 * — it moved into the Sponsor/Donate tile grid — and cash-rain crosses the
 * boundary via the `rain-store` singleton instead of a lifted `raining`
 * state. This wrapper stays a client component only so `BibForm` (which owns
 * hooks + the rain subscription) mounts under a client boundary.
 */
export function GetYourBib({ bibForm }: { bibForm: BibFormProps }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <BibForm {...bibForm} />
    </div>
  );
}

export default GetYourBib;
