"use client";

import { useState } from "react";
import BibForm, { type BibFormProps } from "./BibForm";
import { WillPayInPersonCheckbox } from "./WillPayInPersonCheckbox";

/**
 * Client wrapper for the "Get your bib" section (Kurt 2026-07-03) so the
 * pay-in-person checkbox can rain cash over the bib preview. Holds the shared
 * `raining` state and threads it into BibForm; the checkbox bubbles its
 * checked state up via onCheckedChange.
 */
export function GetYourBib({
  bibForm,
  showCheckbox,
  willPayInitial,
}: {
  bibForm: Omit<BibFormProps, "raining">;
  showCheckbox: boolean;
  willPayInitial: boolean;
}) {
  const [raining, setRaining] = useState(willPayInitial);

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <BibForm {...bibForm} raining={raining} />
      {showCheckbox && (
        <div style={{ marginTop: 16 }}>
          <WillPayInPersonCheckbox
            initialValue={willPayInitial}
            onCheckedChange={setRaining}
          />
        </div>
      )}
    </div>
  );
}

export default GetYourBib;
