/**
 * seed-treadmill-flag.mts (2026-08-05) — create the ELKENTARO 2000 Ctf row.
 *
 * A 250-point flag for logging an INDOOR run recorded Aug 3–10 2026. run.gpx
 * detects the run (Strava `trainer: true`, or no GPS track) and POSTs to
 * /api/internal/ctf/treadmill-award, which admits the solve through the judge's
 * server-caller `grant` path. This script only creates the row that award
 * scores against; without it the award is a silent no-op (judgeSolve returns a
 * non-solve for a missing/disabled challenge) and imports are unaffected.
 *
 * DELIBERATELY NO ANSWER. The row is written with no `answerHash`, which makes
 * it unguessable by construction rather than by obscurity: verifyAnswerHash()
 * returns false whenever the stored hash is empty, so every typed guess is a
 * non-solve and `grant` is the ONLY path that can ever score it. Do not add an
 * answer later without deciding you want it claimable by typing.
 *
 * The Aug 3–10 window is NOT expressed as a `scoreWindow` here: scoreWindow
 * gates on when the solve happens, and this flag gates on when the RUN was
 * recorded. That check lives in run.gpx (lib/treadmill-flag.ts) where the
 * activity date is known.
 *
 * SAFETY:
 *   - DRY-RUN BY DEFAULT. --confirm is required for any write.
 *   - Refuses to overwrite an existing `treadmill` row unless --force is also
 *     given, so a re-run cannot silently reset solveCount/ordinals.
 *   - Reads the row back after writing and prints it.
 *
 * STATUS: the live `treadmill` row was already created in prod on 2026-08-05
 * (pk "$run#challenge_treadmill", sk "$ctf_1", solveCount 0) and verified by
 * letting ElectroDB compose the key and read it back. This script is kept for
 * re-seeding another region/environment; against prod it will refuse to run
 * without --force, which is the intended behaviour.
 *
 * Usage:
 *   npx tsx scripts/seed-treadmill-flag.mts                # dry run
 *   npx tsx scripts/seed-treadmill-flag.mts --confirm      # create
 *   npx tsx scripts/seed-treadmill-flag.mts --confirm --force   # overwrite
 */

import { getCtf, upsertCtf } from "../src/lib/qr-admin";

const CHALLENGE = "treadmill";
const POINTS = 250;

const args = new Set(process.argv.slice(2));
const confirm = args.has("--confirm");
const force = args.has("--force");

async function main() {
  console.log(`\nELKENTARO 2000 treadmill flag — "${CHALLENGE}" @ ${POINTS}pts`);
  console.log(confirm ? "MODE: CONFIRM (will write)" : "MODE: DRY RUN (no writes)");

  const existing = await getCtf(CHALLENGE);
  if (existing) {
    console.log(`\nExisting row found:`);
    console.log(
      `  points=${existing.points} enabled=${existing.enabled} solveCount=${
        (existing as { solveCount?: number }).solveCount ?? 0
      }`
    );
    if (!force) {
      console.error(
        `\nREFUSING to overwrite an existing row. Re-run with --force if that is really what you want.`
      );
      process.exit(1);
    }
    console.log(`  --force given: will overwrite.`);
  } else {
    console.log(`\nNo existing "${CHALLENGE}" row — this will create one.`);
  }

  // FLAT 250 for every solver. `computePoints` (lib/ctf-scoring.ts) scores from
  // pointMax/pointFloor — NOT from the `points` attribute — so setting `points`
  // alone awards the wrong number. Equal ceiling and floor make `span` 0, which
  // makes the linear per-solve decline a no-op: every ordinal scores 250.
  //
  // These are REQUIRED, not merely advisable: the Ctf entity declares no
  // defaults for pointMax/pointFloor/maxSolves, and computePoints on an
  // unconfigured row evaluates `pointFloor + (undefined - undefined) * NaN` and
  // awards NaN.
  const input = {
    challenge: CHALLENGE,
    points: POINTS, // legacy/display field, kept consistent
    pointMax: POINTS,
    pointFloor: POINTS,
    maxSolves: 100000, // effectively uncapped, matching the other DC34 flags
    firstBloodBonus: 0, // everyone gets the same 250; no first-solver premium
    enabled: true,
    // No `answer` on purpose — see the header. Grant-only.
  };
  console.log(`\nPayload: ${JSON.stringify(input)}`);

  if (!confirm) {
    console.log(`\nDRY RUN — nothing written. Re-run with --confirm.\n`);
    return;
  }

  await upsertCtf(input);
  const after = await getCtf(CHALLENGE);
  if (!after) {
    console.error("\nWrite reported success but the row did not read back.");
    process.exit(1);
  }
  console.log(`\nWROTE: points=${after.points} enabled=${after.enabled}`);
  console.log(
    `answerHash present: ${
      (after as { answerHash?: string }).answerHash ? "YES (unexpected!)" : "no (grant-only, correct)"
    }\n`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
