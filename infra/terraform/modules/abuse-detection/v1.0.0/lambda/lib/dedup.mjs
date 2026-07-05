// dedup.mjs — once-per-UTC-day dedup + escalation re-alert state, stored as
// small S3 marker objects (abuse/state/{ip}#{utc-date} JSON with the last-alerted
// count). No DynamoDB table: a single scalar per offender/day is lower ceremony
// and survives Lambda cold starts (design 3.3 / AD-06).
//
// stateKey / shouldAlert are pure. readState / writeState drive S3 through an
// injected `s3` ADAPTER exposing send({ op, ... }) — testable with a fake, no
// @aws-sdk needed at test time. makeS3Adapter() lazily loads the runtime SDK.

// abuse/state/{ip}#{utc-date}
export function stateKey(statePrefix, ip, utcDate) {
  return `${statePrefix}${ip}#${utcDate}`;
}

// Returns { count, ts } or null when the marker does not exist yet (first alert
// of the day). ONLY a genuinely-missing object returns null; any other error
// propagates so the handler decides — it fail-safes to alerting (a dup email
// beats a missed attacker, design 5 / T-41-08).
export async function readState(s3, bucket, key) {
  try {
    const res = await s3.send({ op: "GetObject", Bucket: bucket, Key: key });
    return JSON.parse(res.body);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

export async function writeState(s3, bucket, key, { count, ts }) {
  await s3.send({
    op: "PutObject",
    Bucket: bucket,
    Key: key,
    Body: JSON.stringify({ count, ts }),
    ContentType: "application/json",
  });
}

// once-per-UTC-day + escalation re-alert:
//   - never alerted today (prevState null)            -> alert
//   - already alerted, count not crossed              -> skip (dedup)
//   - count >= prior * escalationMultiplier           -> re-alert (a spike pages)
export function shouldAlert(prevState, finding, escalationMultiplier) {
  if (!prevState) return true;
  const prior = Number(prevState.count) || 0;
  const mult = Number(escalationMultiplier) || 1;
  return Number(finding.count) >= prior * mult;
}

// True when an S3 GetObject failed because the object does not exist.
export function isNotFound(err) {
  return (
    err?.name === "NoSuchKey" ||
    err?.name === "NotFound" ||
    err?.Code === "NoSuchKey" ||
    err?.$metadata?.httpStatusCode === 404
  );
}

// Real S3 adapter — lazily loads the runtime-provided @aws-sdk/client-s3 and
// maps { op } descriptors to SDK Commands. GetObject returns { body } as text.
export async function makeS3Adapter() {
  const S = await import("@aws-sdk/client-s3");
  const client = new S.S3Client({});
  return {
    async send(d) {
      switch (d.op) {
        case "GetObject": {
          const res = await client.send(
            new S.GetObjectCommand({ Bucket: d.Bucket, Key: d.Key })
          );
          return { body: await res.Body.transformToString() };
        }
        case "PutObject":
          return client.send(
            new S.PutObjectCommand({
              Bucket: d.Bucket,
              Key: d.Key,
              Body: d.Body,
              ContentType: d.ContentType,
            })
          );
        default:
          throw new Error(`makeS3Adapter: unknown op ${d.op}`);
      }
    },
  };
}
