/**
 * backfill-player-first-blood.mjs (2026-08-05) — make first blood claimable by
 * players on challenges an operator already solved.
 *
 * WHY: `firstBlood` was simply "ordinal 1", so operators testing challenges
 * consumed the 🩸 before any player could reach it — 32 of DC34's first 42 first
 * bloods were one operator's. The judge now keeps a second counter
 * (`Ctf.playerSolveCount`, incremented only for non-admin solves) and awards a
 * first blood to the first non-admin solver as WELL as to the genuinely-first
 * solver. This script makes the existing data consistent with that rule:
 *
 *   1. Ctf.playerSolveCount := number of existing NON-ADMIN solves, so the next
 *      player is numbered correctly instead of being handed a duplicate badge.
 *   2. For each challenge whose non-admin solvers currently hold NO first blood,
 *      award it to the EARLIEST of them (lowest ordinal).
 *
 * Purely ADDITIVE: it only ever sets firstBlood true, never false. Nobody loses
 * a badge they already hold.
 *
 * ADMIN LIST: admin-ness is an OIDC session claim and is NOT stored per user, so
 * it cannot be derived here. ADMIN_USERS below must be maintained by hand. A
 * missing admin is a safe-ish failure (their challenge simply won't free up);
 * a WRONGLY listed player would deny them a badge, so keep it tight.
 *
 * Raw DynamoDB client with ambient credentials — the app's electroClient needs
 * dedicated RUN_ELECTRO_* keys, and importing src/entities under tsx dies on the
 * ESM-only @auth/dynamodb-adapter (see reset-ctf-user.mts). Every CtfSolve row is
 * written by its OWN pk/sk read from the scan, so there is zero key-composition
 * risk; only the Ctf row's key is composed, and that shape is pinned by
 * scripts/seed-treadmill-flag.mts and verified against live rows.
 *
 * DRY-RUN BY DEFAULT. --confirm to write.
 */
import { DynamoDB } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb';

const TABLE = 'run-human-electro';
const CONFIRM = process.argv.includes('--confirm');

/** Operator accounts whose solves must NOT consume the player first-blood slot. */
const ADMIN_USERS = new Set([
    '041287e3-a0a4-4ffc-9a38-b38f83fb9057', // KPH / whereiskurt
]);

const doc = DynamoDBDocument.from(new DynamoDB({ region: 'us-east-1' }), {
    marshallOptions: { removeUndefinedValues: true },
});

async function scanAll(params) {
    const out = [];
    let key;
    do {
        const res = await doc.scan({ ...params, ExclusiveStartKey: key });
        out.push(...(res.Items ?? []));
        key = res.LastEvaluatedKey;
    } while (key);
    return out;
}

const solves = await scanAll({
    TableName: TABLE,
    FilterExpression: '#e = :e',
    ExpressionAttributeNames: { '#e': '__edb_e__' },
    ExpressionAttributeValues: { ':e': 'CtfSolve' },
});
console.log(`Scanned ${solves.length} CtfSolve rows.`);

const byChallenge = new Map();
for (const s of solves) {
    if (!byChallenge.has(s.challenge)) byChallenge.set(s.challenge, []);
    byChallenge.get(s.challenge).push(s);
}
console.log(`${byChallenge.size} challenges with at least one solve.\n`);

const countUpdates = [];
const badgeGrants = [];

for (const [challenge, rows] of [...byChallenge.entries()].sort()) {
    const players = rows
        .filter((r) => !ADMIN_USERS.has(r.user))
        .sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));

    countUpdates.push({ challenge, playerSolveCount: players.length });

    if (players.length === 0) continue; // no player has solved it yet
    if (players.some((p) => p.firstBlood === true)) continue; // a player already holds one

    const winner = players[0];
    badgeGrants.push({
        challenge,
        user: winner.user,
        ordinal: winner.ordinal,
        pk: winner.pk,
        sk: winner.sk,
    });
}

console.log(`Ctf.playerSolveCount updates: ${countUpdates.length}`);
console.log(`Retroactive first bloods to grant: ${badgeGrants.length}\n`);
for (const g of badgeGrants) {
    console.log(`  ${g.challenge.padEnd(28)} → ${g.user} (was ordinal ${g.ordinal})`);
}

if (!CONFIRM) {
    console.log('\nDRY RUN — nothing written. Re-run with --confirm.\n');
    process.exit(0);
}

let counts = 0;
for (const c of countUpdates) {
    await doc.update({
        TableName: TABLE,
        Key: { pk: `$run#challenge_${c.challenge}`, sk: '$ctf_1' },
        UpdateExpression: 'SET playerSolveCount = :n',
        // Only touch rows that actually exist; never create a Ctf row here.
        ConditionExpression: 'attribute_exists(pk)',
        ExpressionAttributeValues: { ':n': c.playerSolveCount },
    }).catch((e) => {
        if (e.name !== 'ConditionalCheckFailedException') throw e;
        console.log(`  (skipped ${c.challenge}: no Ctf row)`);
    });
    counts++;
}

let granted = 0;
for (const g of badgeGrants) {
    await doc.update({
        TableName: TABLE,
        Key: { pk: g.pk, sk: g.sk },
        UpdateExpression: 'SET firstBlood = :t',
        ConditionExpression: 'attribute_exists(pk)',
        ExpressionAttributeValues: { ':t': true },
    });
    granted++;
}

console.log(`\nWROTE ${counts} playerSolveCount values and ${granted} first bloods.\n`);
