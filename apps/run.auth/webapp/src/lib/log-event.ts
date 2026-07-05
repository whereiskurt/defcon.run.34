/**
 * Structured activity-event logger (Phase 40, AR-01).
 *
 * Copy-per-app helper (do NOT extract into a shared package — this matches the
 * monorepo's per-app independence). Emits exactly ONE JSON line to stdout per call
 * through a single console.log(JSON.stringify(...)). ECS awslogs already ships stdout
 * to CloudWatch, so the Phase 40 CloudWatch metric filters consume these lines with
 * zero new ingestion infrastructure.
 *
 * The field keys are a LOCKED cross-plan contract with the metric filters:
 *   { evt, userId, email, ip, ua, meta }
 * where `ip` is the FIRST hop of x-forwarded-for (the real client IP — the one field
 * the infra access logs cannot join back to a user).
 *
 * Guarantees (threat register T-40-03): MUST never throw and MUST never block the
 * request path. The entire body is wrapped in try/catch that swallows, the function
 * returns void, and callers never await it.
 */

type HeadersLike = Headers | Record<string, string | string[] | undefined>;

export interface LogEventOptions {
  headers?: HeadersLike;
  userId?: string;
  email?: string;
  meta?: Record<string, unknown>;
}

/**
 * Read a single header value from either a Headers instance (Next's headers())
 * or a plain record. HTTP header names are case-insensitive, so the record path
 * lower-cases both sides before matching.
 */
function readHeader(
  headers: HeadersLike | undefined,
  name: string
): string | undefined {
  if (!headers) return undefined;

  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name) ?? undefined;
  }

  const record = headers as Record<string, string | string[] | undefined>;
  const target = name.toLowerCase();
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() === target) {
      const value = record[key];
      return Array.isArray(value) ? value[0] : value ?? undefined;
    }
  }
  return undefined;
}

/**
 * Emit one structured activity event to stdout. Fire-and-forget: returns void and
 * never throws. `userId`/`email` are omitted from the line when undefined (JSON.stringify
 * drops undefined-valued keys); `meta` always serializes as at least `{}`.
 */
export function logEvent(evt: string, opts: LogEventOptions = {}): void {
  try {
    const forwardedFor = readHeader(opts.headers, "x-forwarded-for");
    const ip = forwardedFor ? forwardedFor.split(",")[0].trim() : undefined;
    const ua = readHeader(opts.headers, "user-agent");

    const line = JSON.stringify({
      evt,
      userId: opts.userId,
      email: opts.email,
      ip,
      ua,
      meta: opts.meta ?? {},
    });

    console.log(line);
  } catch {
    // Swallow — activity logging must never break the request path (T-40-03).
  }
}
