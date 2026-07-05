# Abuse-detection Athena query templates

Two parameterized Athena (Trino/Presto SQL) detection templates read by the
`abuse-detector` Lambda handler (Plan 04) at runtime. They are the detection
logic (AD-03 / AD-04) for Phase 41 and are kept as standalone `.sql` files so
they are independently testable and the WAF/Impart seam stays clean.

| File | Rule | Requirement |
|------|------|-------------|
| `q1_sustained_activity.sql` | Sustained-activity sessionization | AD-03 |
| `q2_rate_outlier.sql` | 5-minute POST/request-rate outlier | AD-04 |

## Placeholder contract

Each template contains `{placeholder}` tokens. The handler performs a **literal
string replace** of each token with a numeric/identifier value sourced from the
`site.hcl` threshold block — it does **not** run a general templating engine, and
**no request-log field is ever interpolated into SQL text**. Attacker-controlled
User-Agent / URL / verb strings only ever appear as **data** in result columns,
never as SQL (threat T-41-04, mitigated; the shape test proves the token set is
closed).

| Template | Placeholders |
|----------|--------------|
| `q1_sustained_activity.sql` | `{database}` `{table}` `{lookback_hours}` `{session_gap_min}` `{session_hours}` |
| `q2_rate_outlier.sql` | `{database}` `{table}` `{lookback_hours}` `{posts_per_5min}` `{requests_per_5min}` |

The `queries.test.mjs` shape test (`node --test`) asserts that substituting the
documented token set leaves **zero** unresolved `{...}` tokens, and that each
template references both `client_ip` and `user_agent` so every finding carries
IP + UA. It uses only Node's built-in `node:test`/`node:assert` — no third-party
test dependency, no `npm install`.

## Columns

Templates reference only columns declared by Plan 01's Glue table
`alb_access_logs`: `client_ip`, `user_agent`, `request_verb`, `request_url`,
`elb_status_code`, `time` (ISO8601 string, parsed with
`from_iso8601_timestamp`), and the projected partition column `day`
(`yyyy/MM/dd`, used for partition pruning ahead of the exact instant window).

## Validation

The shape/placeholder contract is checked in CI via `node --test`. **Semantic
correctness** (a 2-hour session flags; a >30-POST/5-min burst flags; a benign
trickle does not) is validated **end-to-end against a synthetic ALB-log
partition at the Plan 05 deploy checkpoint** — not in CI, which would require a
live Athena/Glue catalog and real S3 partitions.
