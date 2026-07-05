// athena.mjs — template loading, parameter substitution, and query execution
// for the abuse-detector.
//
// loadTemplate / renderQuery are pure (fs + string ops), unit-tested directly.
// runQuery drives Athena through an injected `athena` ADAPTER exposing a single
// send({ op, ... }) method — NOT a raw SDK client — so this unit is import-light
// and fully testable with a fake adapter (no @aws-sdk needed at test time).
//
// makeAthenaAdapter() is the real adapter: it lazily `import`s
// @aws-sdk/client-athena (runtime-provided by the Lambda; never bundled, never
// npm-installed) and maps descriptors to SDK Commands. The lazy import means
// importing THIS module does not require the SDK — only calling the real
// adapter does. Zero third-party dependencies.

import { readFileSync } from "node:fs";
import { join } from "node:path";

// Read a .sql template from the query directory shipped alongside the handler.
export function loadTemplate(queryDir, name) {
  return readFileSync(join(queryDir, name), "utf8");
}

// Literal replace of each {key} with String(value). Throws if ANY {token}
// remains, so a template/param mismatch fails LOUDLY in CI tests rather than
// producing a malformed live query (threat T-41-13). No log field is ever
// interpolated — only the closed numeric/identifier param set from site.hcl.
export function renderQuery(template, params = {}) {
  let out = String(template);
  for (const [key, value] of Object.entries(params)) {
    out = out.split(`{${key}}`).join(String(value));
  }
  const residual = out.match(/\{[A-Za-z_][A-Za-z0-9_]*\}/g);
  if (residual) {
    const uniq = [...new Set(residual)].join(", ");
    throw new Error(`renderQuery: unresolved placeholder(s): ${uniq}`);
  }
  return out;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// StartQueryExecution -> poll GetQueryExecution -> GetQueryResults. The poll is
// bounded; FAILED / CANCELLED / timeout throw an error the handler catches
// (fail-safe: a failed run just retries on the next cron, never crashes the
// schedule — threat T-41-08). Returns rows as objects keyed by column name.
export async function runQuery(
  athena,
  { workgroup, database, sql },
  { maxAttempts = 30, intervalMs = 1000 } = {}
) {
  const started = await athena.send({
    op: "StartQueryExecution",
    QueryString: sql,
    WorkGroup: workgroup,
    Database: database,
  });
  const id = started?.QueryExecutionId;
  if (!id) throw new Error("runQuery: no QueryExecutionId returned");

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const desc = await athena.send({
      op: "GetQueryExecution",
      QueryExecutionId: id,
    });
    const state = desc?.QueryExecution?.Status?.State;
    if (state === "SUCCEEDED") {
      return collectRows(athena, id);
    }
    if (state === "FAILED" || state === "CANCELLED") {
      const reason =
        desc?.QueryExecution?.Status?.StateChangeReason || "unknown";
      throw new Error(`runQuery: query ${state}: ${reason}`);
    }
    await sleep(intervalMs);
  }
  throw new Error(`runQuery: timed out after ${maxAttempts} attempts`);
}

async function collectRows(athena, id) {
  const rows = [];
  let columns = null;
  let token;
  do {
    const page = await athena.send({
      op: "GetQueryResults",
      QueryExecutionId: id,
      NextToken: token,
    });
    const meta = page?.ResultSet?.ResultSetMetadata?.ColumnInfo || [];
    if (!columns) columns = meta.map((c) => c.Name);
    const pageRows = page?.ResultSet?.Rows || [];
    for (let i = 0; i < pageRows.length; i++) {
      // The first row of the FIRST page is the column header — skip it.
      if (!token && i === 0) continue;
      const data = pageRows[i].Data || [];
      const obj = {};
      columns.forEach((col, idx) => {
        obj[col] = data[idx]?.VarCharValue ?? null;
      });
      rows.push(obj);
    }
    token = page?.NextToken;
  } while (token);
  return rows;
}

// Real Athena adapter — lazily loads the runtime-provided @aws-sdk/client-athena
// and maps { op } descriptors to SDK Commands. Built once by the handler and
// reused across warm invocations (cold-start amortized).
export async function makeAthenaAdapter() {
  const A = await import("@aws-sdk/client-athena");
  const client = new A.AthenaClient({});
  return {
    async send(d) {
      switch (d.op) {
        case "StartQueryExecution":
          return client.send(
            new A.StartQueryExecutionCommand({
              QueryString: d.QueryString,
              WorkGroup: d.WorkGroup,
              QueryExecutionContext: d.Database
                ? { Database: d.Database }
                : undefined,
            })
          );
        case "GetQueryExecution":
          return client.send(
            new A.GetQueryExecutionCommand({ QueryExecutionId: d.QueryExecutionId })
          );
        case "GetQueryResults":
          return client.send(
            new A.GetQueryResultsCommand({
              QueryExecutionId: d.QueryExecutionId,
              NextToken: d.NextToken,
            })
          );
        default:
          throw new Error(`makeAthenaAdapter: unknown op ${d.op}`);
      }
    },
  };
}
