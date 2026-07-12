import {
  CloudWatchLogsClient,
  StartQueryCommand,
  GetQueryResultsCommand,
  StopQueryCommand,
} from "@aws-sdk/client-cloudwatch-logs";

/**
 * Server-only CloudWatch Logs Insights helper for the admin IP-visibility feature.
 * Queries the run.auth app log group over the existing auth.login/auth.signup events.
 * Uses the DEFAULT credential provider chain — the ECS task role already has logs:*.
 */

// No `credentials` block: default chain → ECS task-role container creds.
const defaultClient = new CloudWatchLogsClient({ region: process.env.AWS_REGION });

type Sendable = { send: (cmd: unknown) => Promise<any> };

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_WINDOW_MS = 90 * DAY_MS;

export function logGroupName(): string {
  return (
    process.env.AUTH_LOG_GROUP ||
    `/ecs/run-auth-app-run-auth-${process.env.REGION_SHORT || "use1"}-dc34`
  );
}

// --- validation (values interpolated into the query string) ---

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
export function isValidIp(s: string): boolean {
  if (typeof s !== "string" || s.length === 0 || s.length > 45) return false;
  const m = s.match(IPV4);
  if (m) return m.slice(1).every((o) => Number(o) <= 255);
  // IPv6: only hex + colon (+ optional embedded IPv4 dots), at least one colon
  return s.includes(":") && /^[0-9a-fA-F:.]+$/.test(s);
}

export function isSafeUserId(s: string): boolean {
  return typeof s === "string" && s.length > 0 && s.length <= 128 && /^[A-Za-z0-9._|-]+$/.test(s);
}

// --- query builders (callers MUST validate the arg first) ---

export function ipsOfUserQuery(userId: string): string {
  return [
    "fields @timestamp, ip, ua",
    `| filter (evt="auth.login" or evt="auth.signup") and userId="${userId}"`,
    "| stats count() as logins, earliest(@timestamp) as firstSeen, latest(@timestamp) as lastSeen, count_distinct(ua) as agents by ip",
    "| sort logins desc",
  ].join("\n");
}

export function usersOfIpQuery(ip: string): string {
  return [
    "fields @timestamp, userId, email",
    `| filter (evt="auth.login" or evt="auth.signup") and ip="${ip}"`,
    "| stats count() as logins, earliest(@timestamp) as firstSeen, latest(@timestamp) as lastSeen by userId, email",
    "| sort logins desc",
  ].join("\n");
}

// --- runner ---

export type InsightsRunResult = { rows: Record<string, string>[]; partial: boolean };

function mapResults(results: Array<Array<{ field?: string; value?: string }>> | undefined): Record<string, string>[] {
  if (!results) return [];
  return results.map((row) =>
    Object.fromEntries(
      row.filter((c) => c.field && c.field !== "@ptr").map((c) => [c.field as string, c.value ?? ""])
    )
  );
}

// exported under a test-only name so the pure mapper is covered without a live client
export const __mapResultsForTest = mapResults;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runInsights(
  queryString: string,
  startMs: number,
  endMs: number,
  opts: { client?: Sendable; timeoutMs?: number; pollMs?: number } = {}
): Promise<InsightsRunResult> {
  const client = opts.client ?? (defaultClient as unknown as Sendable);
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const pollMs = opts.pollMs ?? 400;

  const start = await client.send(
    new StartQueryCommand({
      logGroupName: logGroupName(),
      startTime: Math.floor(startMs / 1000),
      endTime: Math.floor(endMs / 1000),
      queryString,
    })
  );
  const queryId: string | undefined = start?.queryId;
  if (!queryId) return { rows: [], partial: false };

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await client.send(new GetQueryResultsCommand({ queryId }));
    const status: string | undefined = res?.status;
    if (status === "Complete") return { rows: mapResults(res.results), partial: false };
    if (status === "Failed" || status === "Cancelled" || status === "Timeout") {
      return { rows: mapResults(res.results), partial: true };
    }
    await sleep(pollMs);
  }
  try {
    await client.send(new StopQueryCommand({ queryId }));
  } catch {
    /* best-effort */
  }
  return { rows: [], partial: true };
}
