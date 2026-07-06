#!/usr/bin/env node
/**
 * copy:import — one-shot seed of the committed copy floor into the live Strapi
 * `ui-string` catalog (Phase 37-01, D-01).
 *
 * This is a MANUAL / CI-only tool. It reads the authored source of truth
 * (src/lib/copy-snapshot.json `default` map) and upserts each (key, value) row
 * into Strapi at `locale: "default"` under the namespace DERIVED from the key's
 * first dotted segment (39-01: common.* -> "common", bib.* -> "bib"), so one
 * import seeds both the shared chrome and the bib-specific rows. This satisfies
 * the edit-proof requirement (SC-3, a live CMS row) from the same authoring pass
 * that produced the fallback-proof snapshot (SC-4).
 *
 * TOKEN SAFETY (T-37-01, high): the import needs a WRITE-capable token, which is
 * DISTINCT from the runtime read-only catalog token. It is read from
 * process.env.STRAPI_WRITE_TOKEN at run time ONLY — never defaulted, never
 * logged/echoed, never added to NEXT_PUBLIC_*, never committed to source. The
 * token supplies the Authorization header and nothing else.
 *
 * Behavior:
 *   - Reads CMS_INTERNAL_URL + STRAPI_WRITE_TOKEN from the environment.
 *   - If either is missing, prints a one-line reason and exits 1 WITHOUT calling
 *     the CMS (never a half-import, never a token leak).
 *   - For each key: GET the existing (key, locale=default) row; PUT its
 *     documentId if present, else POST a new row. Tolerates the Strapi 5
 *     flattened row shape (documentId on the row).
 *   - Prints a created/updated tally and exits non-zero if any request fails.
 *
 * Uses only global `fetch` — no new dependencies (repo no-new-deps rule).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const DEFAULT_LOCALE = "default";

// Phase 35 namespace enum — the ONLY valid `namespace` values in the catalog.
// The namespace is derived per key from its first dotted segment (39-01), so a
// single import seeds common.* and bib.* rows correctly. A key whose prefix is
// not in this enum is skipped + logged, never POSTed (T-39-02, tampering guard).
const NAMESPACE_ENUM = new Set(["common", "human", "auth", "gpx", "bib", "flash"]);

/** Derive the catalog namespace from a key's first dotted segment. */
function namespaceForKey(key) {
  return key.split('.')[0];
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = resolve(__dirname, "../src/lib/copy-snapshot.json");

async function main() {
  const baseUrl = process.env.CMS_INTERNAL_URL;
  // WRITE token — distinct from the runtime read-only catalog token.
  const token = process.env.STRAPI_WRITE_TOKEN;

  if (!baseUrl || !token) {
    console.error(
      "[copy:import] CMS_INTERNAL_URL and STRAPI_WRITE_TOKEN are required — nothing sent."
    );
    process.exit(1);
  }

  const bundle = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
  const map = bundle[DEFAULT_LOCALE] ?? {};
  const entries = Object.entries(map);
  if (entries.length === 0) {
    console.error("[copy:import] snapshot `default` map is empty — nothing to import.");
    process.exit(1);
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  let created = 0;
  let updated = 0;
  let failed = 0;
  let skipped = 0;

  for (const [key, value] of entries) {
    // Derive + validate the namespace from the key prefix. An unknown prefix is
    // skipped and logged — never POSTed with an invalid namespace (T-39-02).
    const namespace = namespaceForKey(key);
    if (!NAMESPACE_ENUM.has(namespace)) {
      skipped += 1;
      console.error(
        `[copy:import] ${key}: unknown namespace "${namespace}" — skipped (not in enum).`
      );
      continue;
    }
    try {
      const findUrl = new URL(`${baseUrl}/api/ui-strings`);
      findUrl.searchParams.set("filters[key][$eq]", key);
      // NB: do NOT filter by `locale` in the query — Strapi 5 reserves `locale`
      // as a query key (i18n), so `filters[locale][$eq]` 400s ("Invalid key
      // locale") against our own non-i18n `locale` column. Select the locale
      // from the returned rows in JS instead.
      findUrl.searchParams.set("pagination[pageSize]", "100");

      const findRes = await fetch(findUrl.toString(), { headers });
      if (!findRes.ok) {
        throw new Error(`lookup ${findRes.status} ${findRes.statusText}`);
      }
      const findJson = await findRes.json();
      const rows = Array.isArray(findJson?.data) ? findJson.data : [];
      // Strapi 5 flattens attributes onto the row; documentId lives on the row.
      // Match the target locale in JS (only `default` exists in v1).
      const existing =
        rows.find((r) => (r?.locale ?? r?.attributes?.locale) === DEFAULT_LOCALE) ??
        rows[0];
      const documentId = existing?.documentId ?? existing?.attributes?.documentId;

      if (documentId) {
        const putRes = await fetch(`${baseUrl}/api/ui-strings/${documentId}`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ data: { value } }),
        });
        if (!putRes.ok) {
          throw new Error(`update ${putRes.status} ${putRes.statusText}`);
        }
        updated += 1;
      } else {
        const postRes = await fetch(`${baseUrl}/api/ui-strings`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            data: { key, locale: DEFAULT_LOCALE, value, namespace },
          }),
        });
        if (!postRes.ok) {
          throw new Error(`create ${postRes.status} ${postRes.statusText}`);
        }
        created += 1;
      }
    } catch (err) {
      failed += 1;
      // Log the KEY and the failure reason only — never the token or the value.
      console.error(`[copy:import] ${key}: ${err?.message ?? err}`);
    }
  }

  console.log(
    `[copy:import] created ${created}, updated ${updated}, skipped ${skipped}, failed ${failed} (of ${entries.length}).`
  );
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`[copy:import] failed: ${err?.message ?? err} — import aborted.`);
  process.exit(1);
});
