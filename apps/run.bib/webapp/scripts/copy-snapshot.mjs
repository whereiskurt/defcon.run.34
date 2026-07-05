#!/usr/bin/env node
/**
 * copy:snapshot — regenerate the committed offline copy floor
 * (src/lib/copy-snapshot.json) from the live CMS `ui-string` catalog.
 *
 * This is a MANUAL / CI-only tool (Phase 36-01, D-04): it MUST NOT be wired into
 * the `build` script, so a build never couples to CMS availability. The committed
 * snapshot is the last-resort fallback floor for the runtime resolver (copy.ts) —
 * it is only refreshed on purpose, never on CMS data change.
 *
 * Behavior:
 *   - Reads CMS_INTERNAL_URL + STRAPI_API_TOKEN from the environment.
 *   - GETs the full `ui-strings` collection filtered to locale=default, paginating
 *     until every row is fetched.
 *   - Reduces rows to `{ "default": { "<key>": "<value>" } }` (same shape as the
 *     S3 export and the runtime reader) and writes it pretty-printed.
 *   - If CMS_INTERNAL_URL or STRAPI_API_TOKEN is missing, prints a one-line reason
 *     and exits 1 WITHOUT touching the committed file (never writes an empty floor).
 *
 * Uses only global `fetch` — no new dependencies (D-05).
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const DEFAULT_LOCALE = "default";
const PAGE_SIZE = 100;

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = resolve(__dirname, "../src/lib/copy-snapshot.json");

async function main() {
  const baseUrl = process.env.CMS_INTERNAL_URL;
  const token = process.env.STRAPI_API_TOKEN;

  if (!baseUrl || !token) {
    console.error(
      "[copy:snapshot] CMS_INTERNAL_URL and STRAPI_API_TOKEN are required — nothing written."
    );
    process.exit(1);
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  const map = {};
  let page = 1;
  let pageCount = 1;

  do {
    const url = new URL(`${baseUrl}/api/ui-strings`);
    url.searchParams.set("filters[locale][$eq]", DEFAULT_LOCALE);
    url.searchParams.set("pagination[page]", String(page));
    url.searchParams.set("pagination[pageSize]", String(PAGE_SIZE));

    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
      console.error(
        `[copy:snapshot] CMS request failed: ${res.status} ${res.statusText} — nothing written.`
      );
      process.exit(1);
    }

    const json = await res.json();
    const rows = Array.isArray(json.data) ? json.data : [];
    for (const row of rows) {
      // Strapi 5 flattens attributes onto the row; tolerate the v4 shape too.
      const attrs = row.attributes ?? row;
      const key = attrs.key;
      if (!key) continue;
      map[key] = attrs.value ?? "";
    }

    pageCount = json.meta?.pagination?.pageCount ?? 1;
    page += 1;
  } while (page <= pageCount);

  const bundle = { [DEFAULT_LOCALE]: map };
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(bundle, null, 2) + "\n");
  console.log(
    `[copy:snapshot] wrote ${Object.keys(map).length} keys to src/lib/copy-snapshot.json`
  );
}

main().catch((err) => {
  console.error(`[copy:snapshot] failed: ${err?.message ?? err} — nothing written.`);
  process.exit(1);
});
