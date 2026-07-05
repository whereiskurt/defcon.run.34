// Placeholder-contract + IP/UA shape test for the abuse-detection Athena
// templates (Plan 41-02, AD-03/AD-04).
//
// Runs with Node's built-in test runner: `node --test`. No third-party test
// framework, no `npm install` — this keeps the phase free of any package
// (slopsquat) legitimacy gate. Requires NO AWS access.
//
// What it proves:
//   1. Applying a literal replace of every DOCUMENTED placeholder to each
//      template leaves ZERO unresolved `{...}` tokens. This proves the handler's
//      substitution set (Plan 04) is complete AND that the templates declare no
//      stray/undocumented placeholders.
//   2. Each template references both `client_ip` and `user_agent`, so every
//      finding carries IP + UA (the AD-03/AD-04 dual-identifier requirement).
//   3. Q1 is threshold-driven on {session_hours} and Q2 on {posts_per_5min},
//      proving the two rules are distinct.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

// The canonical, documented placeholder set per template. This is the contract
// the Plan 04 handler substitutes — kept in lockstep with each .sql header and
// the README.
const CONTRACT = {
  'q1_sustained_activity.sql': [
    'database',
    'table',
    'lookback_hours',
    'session_gap_min',
    'session_hours',
  ],
  'q2_rate_outlier.sql': [
    'database',
    'table',
    'lookback_hours',
    'posts_per_5min',
    'requests_per_5min',
  ],
};

// Any residual {token} of lowercase letters/underscores after substitution.
const RESIDUAL_TOKEN = /\{[a-z_]+\}/;

const read = (file) => readFileSync(join(HERE, file), 'utf8');

for (const [file, placeholders] of Object.entries(CONTRACT)) {
  test(`${file}: documented placeholder set fully resolves (no residual tokens)`, () => {
    let sql = read(file);
    for (const token of placeholders) {
      // Literal, global replace — mirrors the handler's substitution.
      sql = sql.split(`{${token}}`).join('42');
    }
    const leftover = sql.match(RESIDUAL_TOKEN);
    assert.equal(
      leftover,
      null,
      `unresolved placeholder(s) remain after substituting the documented set: ${leftover}`
    );
  });

  test(`${file}: every declared placeholder is actually present in the template`, () => {
    const sql = read(file);
    for (const token of placeholders) {
      assert.ok(
        sql.includes(`{${token}}`),
        `documented placeholder {${token}} is missing from ${file}`
      );
    }
  });

  test(`${file}: surfaces both identifiers (client_ip + user_agent)`, () => {
    const sql = read(file);
    assert.ok(sql.includes('client_ip'), `${file} must reference client_ip`);
    assert.ok(sql.includes('user_agent'), `${file} must reference user_agent`);
  });
}

test('Q1 and Q2 are distinct threshold-driven rules', () => {
  assert.ok(
    read('q1_sustained_activity.sql').includes('{session_hours}'),
    'Q1 must be threshold-driven on {session_hours}'
  );
  assert.ok(
    read('q2_rate_outlier.sql').includes('{posts_per_5min}'),
    'Q2 must be threshold-driven on {posts_per_5min}'
  );
});
