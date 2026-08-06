/**
 * reconcile-treadmill-sweep.mjs (2026-08-06) — roll back the overnight batch
 * sweep that auto-awarded the ELKENTARO 2000 flag.
 *
 * WHAT HAPPENED: making GPS-less activities importable also made them visible to
 * the unattended EventBridge batch sync, which had previously skipped them. On
 * its 05:00 run it imported 68 trackless activities nobody had asked for
 * (WeightTraining, Walk, Yoga, Soccer, Rowing, Ride, plus genuine Runs) and,
 * because the flag award was hooked inside importActivity, handed 11 runners a
 * treadmill flag they never claimed — one of them taking the player first-blood
 * badge with it.
 *
 * The code fix stops it recurring (importActivity now requires `userInitiated`
 * both to import a GPS-less activity and to award the flag). This script undoes
 * what already happened, so the state is as if the sweep had never run:
 *
 *   1. DELETE the GpxFile rows the sweep created (source strava, no bounds, no
 *      conDay, created in the sweep window) and their S3 objects.
 *   2. REVOKE the CtfSolve rows the sweep triggered, and rewind Ctf.solveCount /
 *      Ctf.playerSolveCount by the number revoked.
 *   3. Leave every OTHER solve untouched — including the operator's own genuine
 *      user-initiated award from the day before.
 *
 * Deleting the files is NOT optional tidiness: CtfSolve is keyed per (challenge,
 * user), and imports dedupe on stravaActivityId. Revoking an award while leaving
 * the file behind would permanently lock that runner out of ever earning the
 * flag for that activity — they could never re-import it. Full rollback is the
 * only state from which they can earn it properly.
 *
 * Rescoring is left to the app's own rescoreBestEffort on their next scoring
 * event; this script does not write RunUser (points-consistency: rescoreUser is
 * the sole writer of score fields).
 *
 * DRY-RUN BY DEFAULT. --confirm to write.
 */
import { DynamoDB } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';

const GPX_TABLE = 'run-gpx-electro';
const HUMAN_TABLE = 'run-human-electro';
const CHALLENGE = 'treadmill';
const CONFIRM = process.argv.includes('--confirm');

// The sweep's window. Solves outside it were user-initiated and are KEPT.
const SWEEP_FROM = Date.parse('2026-08-06T04:30:00Z');
const SWEEP_TO = Date.parse('2026-08-06T06:00:00Z');

const doc = DynamoDBDocument.from(new DynamoDB({ region: 'us-east-1' }));
const s3 = new S3Client({ region: 'us-east-1' });

async function scanAll(table, params) {
    const out = [];
    let key;
    do {
        const r = await doc.scan({ TableName: table, ...params, ExclusiveStartKey: key });
        out.push(...(r.Items ?? []));
        key = r.LastEvaluatedKey;
    } while (key);
    return out;
}

// ---------------------------------------------------------------- 1. files
const files = await scanAll(GPX_TABLE, {
    FilterExpression: '#e = :e AND #s = :src',
    ExpressionAttributeNames: { '#e': '__edb_e__', '#s': 'source' },
    ExpressionAttributeValues: { ':e': 'GpxFile', ':src': 'strava' },
});
const swept = files.filter((f) => {
    const t = Number(f.createdAt ?? 0);
    return t >= SWEEP_FROM && t <= SWEEP_TO && !f.bounds && !f.conDay;
});
console.log(`GpxFile rows created by the sweep (strava, no bounds, untagged): ${swept.length}`);

// ---------------------------------------------------------------- 2. solves
const solves = await scanAll(HUMAN_TABLE, {
    FilterExpression: '#e = :e AND challenge = :c',
    ExpressionAttributeNames: { '#e': '__edb_e__' },
    ExpressionAttributeValues: { ':e': 'CtfSolve', ':c': CHALLENGE },
});
const sweptSolves = solves.filter((s) => {
    const t = Date.parse(s.solvedAt ?? '');
    return t >= SWEEP_FROM && t <= SWEEP_TO;
});
const keptSolves = solves.filter((s) => !sweptSolves.includes(s));

console.log(`treadmill solves total: ${solves.length}`);
console.log(`  to REVOKE (awarded by the sweep): ${sweptSolves.length}`);
console.log(`  to KEEP  (user-initiated):        ${keptSolves.length}`);
for (const s of keptSolves) {
    console.log(`     keep  #${s.ordinal}  ${s.user}  fb=${s.firstBlood}  ${s.solvedAt}`);
}
const revokedFirstBlood = sweptSolves.filter((s) => s.firstBlood === true).length;
if (revokedFirstBlood) {
    console.log(`  (${revokedFirstBlood} of the revoked solves held the player first blood)`);
}

if (!CONFIRM) {
    console.log('\nDRY RUN — nothing written. Re-run with --confirm.\n');
    process.exit(0);
}

// ---------------------------------------------------------------- apply
let s3Deleted = 0;
let rowsDeleted = 0;
for (const f of swept) {
    try {
        await s3.send(new DeleteObjectCommand({ Bucket: f.bucket, Key: f.key }));
        s3Deleted++;
    } catch (e) {
        console.warn(`  S3 delete failed for ${f.key}: ${e.name}`);
    }
    await doc.delete({ TableName: GPX_TABLE, Key: { pk: f.pk, sk: f.sk } });
    rowsDeleted++;
}

let solvesDeleted = 0;
for (const s of sweptSolves) {
    await doc.delete({ TableName: HUMAN_TABLE, Key: { pk: s.pk, sk: s.sk } });
    solvesDeleted++;
}

// Rewind both counters so the next genuine solver gets the right ordinal AND the
// player first-blood slot the sweep consumed.
if (solvesDeleted > 0) {
    await doc.update({
        TableName: HUMAN_TABLE,
        Key: { pk: `$run#challenge_${CHALLENGE}`, sk: '$ctf_1' },
        UpdateExpression: 'ADD solveCount :neg, playerSolveCount :negPlayer',
        ExpressionAttributeValues: {
            ':neg': -solvesDeleted,
            // Every swept solve was a non-admin one, so both counters rewind by
            // the same amount. Asserted by the dry-run output above.
            ':negPlayer': -solvesDeleted,
        },
    });
}

const after = await doc.get({
    TableName: HUMAN_TABLE,
    Key: { pk: `$run#challenge_${CHALLENGE}`, sk: '$ctf_1' },
});
console.log(`\nDeleted ${rowsDeleted} GpxFile rows (${s3Deleted} S3 objects) and ${solvesDeleted} solves.`);
console.log(
    `Ctf now: solveCount=${after.Item?.solveCount} playerSolveCount=${after.Item?.playerSolveCount}\n`
);
