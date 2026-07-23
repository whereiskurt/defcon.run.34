#!/usr/bin/env node
/**
 * sync-meshtk-fleet.mjs — regenerate src/data/meshtk-fleet-yaml.ts from the
 * canonical fleet config at apps/run.mqtt/meshtk/meshtk.dc34.yaml.
 *
 * The generated module is COMMITTED (same pattern as lib/copy-snapshot.json) so
 * the Docker build needs no cross-app context and Next's standalone output needs
 * no file tracing. Drift is caught by the vitest parity test
 * (src/lib/__tests__/mesh-ghosts.test.ts) which byte-compares the snapshot to
 * the canonical file whenever the monorepo copy is reachable. When that test
 * fails: run `node scripts/sync-meshtk-fleet.mjs` and commit the result.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webappDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const canonical = resolve(webappDir, "../../run.mqtt/meshtk/meshtk.dc34.yaml");
const out = resolve(webappDir, "src/data/meshtk-fleet-yaml.ts");

const yaml = readFileSync(canonical, "utf-8");

const banner = `/**
 * GENERATED FILE — do not edit by hand.
 * Snapshot of apps/run.mqtt/meshtk/meshtk.dc34.yaml taken by
 * scripts/sync-meshtk-fleet.mjs. The parity vitest in
 * src/lib/__tests__/mesh-ghosts.test.ts fails when this drifts from the
 * canonical file; re-run the script and commit to fix.
 */
export const MESHTK_FLEET_YAML: string =
`;

writeFileSync(out, banner + JSON.stringify(yaml) + ";\n");
console.log(`wrote ${out} (${yaml.length} bytes of YAML)`);
