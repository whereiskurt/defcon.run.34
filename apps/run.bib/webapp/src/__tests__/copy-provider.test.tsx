import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";

/**
 * Phase 36-03 tests: CopyProvider / useCopy — the client half of the copy toolkit.
 *
 * The provider is a pure context provider and useCopy() returns a bound `t`, so we
 * can prove runtime client resolution with renderToStaticMarkup (SSR of a client
 * consumer) without booting jsdom — the same node-env pattern as bib-preview.test.
 *
 * Proven here:
 *  - a context key interpolates at RUNTIME inside a provider (SC-2, TOOL-03);
 *  - a key absent from the provider map still resolves via the committed snapshot
 *    floor (client floor context[key] ?? snapshot[key] ?? key, FALL-04);
 *  - useCopy() outside any provider never throws — it floors to the snapshot;
 *  - a key absent everywhere echoes the raw key (last-resort, FALL-04).
 */

import { CopyProvider, useCopy } from "@/components/CopyProvider";

function Greeting({ name }: { name: string }) {
  const { t } = useCopy();
  return <span>{t("bib.selftest.clientGreeting", { name })}</span>;
}

function Raw({ k }: { k: string }) {
  const { t } = useCopy();
  return <span>{t(k)}</span>;
}

describe("CopyProvider / useCopy (Phase 36-03)", () => {
  it("interpolates a context key inside a provider at runtime (SC-2, TOOL-03)", () => {
    const map = { "bib.selftest.clientGreeting": "Hello {name}" };
    const html = renderToStaticMarkup(
      <CopyProvider value={map}>
        <Greeting name="Ada" />
      </CopyProvider>
    );
    expect(html).toContain("Hello Ada");
  });

  it("falls back to the snapshot floor for a key absent from the provider map (FALL-04)", () => {
    // Provider map deliberately empty; the committed snapshot floor must still
    // resolve the client greeting so a client component never renders a raw key.
    const html = renderToStaticMarkup(
      <CopyProvider value={{}}>
        <Greeting name="Bob" />
      </CopyProvider>
    );
    expect(html).toContain("Hello Bob");
  });

  it("resolves via the snapshot floor when used OUTSIDE any provider (never throws, T-36-10)", () => {
    const html = renderToStaticMarkup(<Greeting name="Cid" />);
    expect(html).toContain("Hello Cid");
  });

  it("echoes the raw key as the last resort when absent everywhere (FALL-04)", () => {
    const html = renderToStaticMarkup(
      <CopyProvider value={{}}>
        <Raw k="bib.selftest.doesNotExist" />
      </CopyProvider>
    );
    expect(html).toContain("bib.selftest.doesNotExist");
  });
});
