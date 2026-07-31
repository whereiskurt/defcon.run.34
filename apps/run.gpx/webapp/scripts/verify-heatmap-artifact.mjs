#!/usr/bin/env node
/**
 * Heat-map artifact verifier (Phase 71, HEAT-03) — prove the EMITTED BYTES are
 * non-attributable, not the code that produced them.
 *
 * Deliberately standalone and dependency-free: it imports nothing from the app,
 * so it can be pointed at a local dry-run file OR at the live production URL for
 * either year. 71-08's ship probe runs exactly this against
 * `https://gpx.defcon.run/api/gpx/public/heatmap/{dc33,dc34}`.
 *
 *   node scripts/verify-heatmap-artifact.mjs ./dc33-heatmap.local.json
 *   node scripts/verify-heatmap-artifact.mjs https://.../api/gpx/public/heatmap/dc33
 *   node scripts/verify-heatmap-artifact.mjs --selftest
 *
 * `--selftest` runs the checks against FOUR in-memory fixtures — one clean
 * (must PASS), one carrying a feature property (must FAIL), one clean-looking
 * but with an at-sign smuggled into a string (must FAIL), and one whose
 * geometry never moves (must FAIL). Without it a verifier that accidentally
 * checks nothing would pass everything and look green forever; the self-test is
 * what stops this file from being decorative.
 *
 * The degeneracy fixture exists because this verifier ALREADY went vacuous once
 * (WR-06): it certified the live DC33 artifact in which 20 of 110 features are
 * entirely `[[0,0],[0,0]]`, because a range check proves bounds and says
 * nothing about whether a "run" ever moved. Do not remove that fixture.
 *
 * Exits 0 only when every check passes. Prints one line per check.
 */

/** Substrings that must never appear anywhere in the serialized artifact. */
const FORBIDDEN = [
  "userId",
  "accomplishmentId",
  "stravaActivityId",
  "fileId",
  "summary_polyline",
  "conDay",
  "@",
];

const ROOT_KEYS = ["type", "meta", "features"];
const META_KEYS = ["year", "generatedAt", "runCount", "totalKm"];
const FEATURE_KEYS = ["type", "properties", "geometry"];

class CheckFailure extends Error {}

function fail(msg) {
  throw new CheckFailure(msg);
}

function sameKeySet(actual, expected) {
  const a = [...actual].sort();
  const b = [...expected].sort();
  return a.length === b.length && a.every((k, i) => k === b[i]);
}

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * The checks, in order. Each returns a short pass detail string or throws
 * `CheckFailure`. `text` is the raw serialized artifact; `doc` is its parse.
 */
const CHECKS = [
  {
    name: "root shape",
    run: (doc) => {
      if (!isPlainObject(doc)) fail("root is not an object");
      if (!sameKeySet(Object.keys(doc), ROOT_KEYS)) {
        fail(`root keys are [${Object.keys(doc).join(", ")}], expected [${ROOT_KEYS.join(", ")}]`);
      }
      if (doc.type !== "FeatureCollection") {
        fail(`root type is "${doc.type}", expected "FeatureCollection"`);
      }
      return "type=FeatureCollection, keys exact";
    },
  },
  {
    name: "meta shape",
    run: (doc) => {
      if (!isPlainObject(doc.meta)) fail("meta is not an object");
      if (!sameKeySet(Object.keys(doc.meta), META_KEYS)) {
        fail(`meta keys are [${Object.keys(doc.meta).join(", ")}], expected [${META_KEYS.join(", ")}]`);
      }
      return `year=${doc.meta.year}, generatedAt=${doc.meta.generatedAt}`;
    },
  },
  {
    name: "runCount agrees with features",
    run: (doc) => {
      if (!Array.isArray(doc.features)) fail("features is not an array");
      if (typeof doc.meta.runCount !== "number") fail("meta.runCount is not a number");
      if (doc.meta.runCount <= 0) fail(`meta.runCount is ${doc.meta.runCount}, expected > 0`);
      if (doc.meta.runCount !== doc.features.length) {
        fail(`meta.runCount ${doc.meta.runCount} != features.length ${doc.features.length}`);
      }
      return `${doc.meta.runCount} features`;
    },
  },
  {
    name: "feature shape",
    run: (doc) => {
      doc.features.forEach((f, i) => {
        if (!isPlainObject(f)) fail(`features[${i}] is not an object`);
        if (!sameKeySet(Object.keys(f), FEATURE_KEYS)) {
          fail(`features[${i}] keys are [${Object.keys(f).join(", ")}], expected [${FEATURE_KEYS.join(", ")}]`);
        }
        if (f.type !== "Feature") fail(`features[${i}].type is "${f.type}"`);
      });
      return `all ${doc.features.length} features have exactly [${FEATURE_KEYS.join(", ")}]`;
    },
  },
  {
    name: "zero feature properties",
    run: (doc) => {
      doc.features.forEach((f, i) => {
        if (!isPlainObject(f.properties)) fail(`features[${i}].properties is not an object`);
        const keys = Object.keys(f.properties);
        if (keys.length !== 0) {
          fail(`features[${i}].properties carries ${keys.length} key(s): ${keys.join(", ")}`);
        }
      });
      return `all ${doc.features.length} features carry zero properties`;
    },
  },
  {
    name: "geometry is bounded LineString",
    run: (doc) => {
      let points = 0;
      doc.features.forEach((f, i) => {
        const g = f.geometry;
        if (!isPlainObject(g)) fail(`features[${i}].geometry is not an object`);
        if (g.type !== "LineString") fail(`features[${i}].geometry.type is "${g.type}"`);
        if (!Array.isArray(g.coordinates)) fail(`features[${i}].geometry.coordinates is not an array`);
        if (g.coordinates.length < 2) {
          fail(`features[${i}] has ${g.coordinates.length} coordinate(s), expected >= 2`);
        }
        g.coordinates.forEach((c, j) => {
          if (!Array.isArray(c) || c.length !== 2) {
            fail(`features[${i}].coordinates[${j}] is not a 2-element array`);
          }
          const [lon, lat] = c;
          if (typeof lon !== "number" || typeof lat !== "number") {
            fail(`features[${i}].coordinates[${j}] is not a pair of numbers`);
          }
          if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
            fail(`features[${i}].coordinates[${j}] lon ${lon} out of range`);
          }
          if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
            fail(`features[${i}].coordinates[${j}] lat ${lat} out of range`);
          }
        });
        // WR-06 — bounded is not the same as real. A track whose every
        // coordinate equals its first never moved, draws nothing, and inflates
        // the publicly-served runCount. The range walk above passes it happily,
        // which is exactly how 20 of the 110 live DC33 features were certified.
        const [f0lon, f0lat] = g.coordinates[0];
        if (g.coordinates.every((c) => c[0] === f0lon && c[1] === f0lat)) {
          fail(
            `features[${i}] is degenerate: all ${g.coordinates.length} coordinates are [${f0lon}, ${f0lat}]`
          );
        }
        points += g.coordinates.length;
      });
      return `${points} coordinates across ${doc.features.length} LineStrings, all in range, 0 degenerate`;
    },
  },
  {
    name: "byte-level attribution sweep",
    // Blunt and structure-blind ON PURPOSE: it does not trust the walk above.
    // If an identifier ever survives into the bytes under a key the structural
    // checks happen to allow, this still catches it.
    run: (_doc, text) => {
      for (const needle of FORBIDDEN) {
        const at = text.indexOf(needle);
        if (at !== -1) fail(`serialized text contains "${needle}" at offset ${at}`);
      }
      return `none of [${FORBIDDEN.join(", ")}] present in ${text.length} bytes`;
    },
  },
];

/** Run every check. Returns the parsed doc, or throws `CheckFailure`. */
function runChecks(text, { quiet = false } = {}) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    fail(`not valid JSON: ${e.message}`);
  }
  for (const check of CHECKS) {
    const detail = check.run(doc, text);
    if (!quiet) console.log(`  PASS  ${check.name} — ${detail}`);
  }
  return doc;
}

async function loadText(arg) {
  if (/^https?:\/\//i.test(arg)) {
    const res = await fetch(arg);
    if (!res.ok) throw new Error(`fetch ${arg} → HTTP ${res.status}`);
    return await res.text();
  }
  const { readFileSync } = await import("node:fs");
  return readFileSync(arg, "utf8");
}

// ── self-test fixtures ──────────────────────────────────────────────────────

const CLEAN_FIXTURE = {
  type: "FeatureCollection",
  meta: {
    year: "dc33",
    generatedAt: "2025-08-15T02:41:54.347Z",
    runCount: 1,
    totalKm: 1.4,
  },
  features: [
    {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: [
          [-115.1398, 36.1699],
          [-115.1428, 36.1729],
        ],
      },
    },
  ],
};

function withFeatureProperty() {
  const doc = structuredClone(CLEAN_FIXTURE);
  doc.features[0].properties = { userId: "1234" };
  return doc;
}

function withSmuggledAtSign() {
  const doc = structuredClone(CLEAN_FIXTURE);
  // Structurally legal — only the byte sweep can catch this one.
  doc.meta.generatedAt = "2025-08-15T02:41:54.347Z runner@example.test";
  return doc;
}

function withDegenerateGeometry() {
  const doc = structuredClone(CLEAN_FIXTURE);
  // Every key is right, every coordinate is in range, and the run never moved.
  // This is the exact shape of 20 of the 110 live DC33 features (WR-06), which
  // this verifier certified as clean before the degeneracy check existed.
  doc.features[0].geometry.coordinates = [
    [-115.1398, 36.1699],
    [-115.1398, 36.1699],
  ];
  return doc;
}

function selftest() {
  let ok = true;

  console.log("selftest: clean fixture (must PASS)");
  try {
    runChecks(JSON.stringify(CLEAN_FIXTURE));
    console.log("  OK    clean fixture passed every check");
  } catch (e) {
    ok = false;
    console.error(`  FAIL  clean fixture was rejected: ${e.message}`);
  }

  for (const [label, build] of [
    ["feature carrying a property", withFeatureProperty],
    ["at-sign smuggled into meta", withSmuggledAtSign],
    ["degenerate geometry — a run that never moved", withDegenerateGeometry],
  ]) {
    console.log(`selftest: doctored fixture — ${label} (must FAIL)`);
    try {
      runChecks(JSON.stringify(build()), { quiet: true });
      ok = false;
      console.error("  FAIL  doctored fixture passed — the verifier is vacuous");
    } catch (e) {
      if (e instanceof CheckFailure) {
        console.log(`  OK    rejected: ${e.message}`);
      } else {
        ok = false;
        console.error(`  FAIL  unexpected error: ${e.message}`);
      }
    }
  }

  if (!ok) {
    console.error("selftest FAILED");
    process.exit(1);
  }
  console.log("selftest PASSED — the verifier rejects what it must and accepts what it must");
}

// ── entry point ─────────────────────────────────────────────────────────────

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: verify-heatmap-artifact.mjs <file|url> | --selftest");
    process.exit(2);
  }
  if (arg === "--selftest") {
    selftest();
    return;
  }

  const text = await loadText(arg);
  console.log(`verifying ${arg} (${text.length} bytes)`);
  const doc = runChecks(text);
  console.log(
    `OK year=${doc.meta.year} runCount=${doc.meta.runCount} totalKm=${doc.meta.totalKm}`
  );
}

main().catch((err) => {
  if (err instanceof CheckFailure) console.error(`  FAIL  ${err.message}`);
  else console.error(`ERROR ${err.message}`);
  process.exit(1);
});
