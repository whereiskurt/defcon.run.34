import { Page } from "playwright";
import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { solveChallenge } from "altcha-lib";
import { instrumentPage } from "./index";

const SITE_LABEL = process.env.SITE_LABEL || "dc34";
const REGION_LABEL = process.env.REGION_LABEL || "use1";
const REGION_FULL = process.env.REGION || "us-east-1";
const INVITE_CODE = process.env.INVITE_CODE || "hacktheplanet";
const REGION_PREFIX = `/${REGION_LABEL}`;

const EMAIL_PREFIX = "inbox/defcon.run/";
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 30; // 60 seconds max

// Cached bucket name (resolved once per process)
let cachedBucketName: string | null = null;

async function getBucketName(): Promise<string> {
  if (cachedBucketName) return cachedBucketName;
  const ssm = new SSMClient({ region: REGION_FULL });
  const param = `/${SITE_LABEL}/ses/s3/${REGION_LABEL}/bucket_name`;
  const resp = await ssm.send(new GetParameterCommand({ Name: param }));
  if (!resp.Parameter?.Value) {
    throw new Error(`SSM parameter ${param} not found or empty`);
  }
  cachedBucketName = resp.Parameter.Value;
  return cachedBucketName;
}

function randomEmail(): string {
  const hex = [...Array(8)].map(() => Math.floor(Math.random() * 16).toString(16)).join("");
  return `waffaw+${hex}@email.defcon.run`;
}

async function solveAltcha(baseUrl: string): Promise<string> {
  const resp = await fetch(`${baseUrl}${REGION_PREFIX}/api/captcha/challenge`);
  if (!resp.ok) throw new Error(`ALTCHA challenge fetch failed: ${resp.status}`);
  const challenge = await resp.json();

  const { promise } = solveChallenge(
    challenge.challenge,
    challenge.salt,
    challenge.algorithm,
    challenge.maxnumber,
  );
  const solution = await promise;
  if (!solution) throw new Error("Failed to solve ALTCHA challenge");

  const payload = {
    algorithm: challenge.algorithm,
    challenge: challenge.challenge,
    number: solution.number,
    salt: challenge.salt,
    signature: challenge.signature,
    took: solution.took,
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

async function waitForMfaCode(email: string, afterTimestamp: Date): Promise<string> {
  const s3 = new S3Client({ region: REGION_FULL });
  const bucketName = await getBucketName();

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    try {
      const listResult = await s3.send(
        new ListObjectsV2Command({ Bucket: bucketName, Prefix: EMAIL_PREFIX, MaxKeys: 50 }),
      );
      const objects = (listResult.Contents || [])
        .filter((obj) => obj.LastModified && obj.LastModified > afterTimestamp)
        .sort((a, b) => (b.LastModified?.getTime() || 0) - (a.LastModified?.getTime() || 0));

      for (const obj of objects) {
        if (!obj.Key) continue;
        const emailResult = await s3.send(new GetObjectCommand({ Bucket: bucketName, Key: obj.Key }));
        const body = await emailResult.Body?.transformToString();
        if (!body || !body.toLowerCase().includes(email.toLowerCase())) continue;

        const subjectMatch = body.match(/Subject:\s*(\d{6})/);
        if (subjectMatch) return subjectMatch[1];

        const bodyMatch = body.match(/<strong>(\d{6})<\/strong>/);
        if (bodyMatch) return bodyMatch[1];
      }
    } catch (err) {
      console.error(`[auth-probe] S3 poll attempt ${attempt + 1} failed:`, err);
    }

    if (attempt < MAX_POLL_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  throw new Error(`No MFA email for ${email} after ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s`);
}

/**
 * Full auth probe — login via ALTCHA + email MFA, browse authenticated, logout.
 * Exercises the real OIDC flow against run.auth.
 */
export async function authProbe(
  page: Page,
  vuContext: { vars: Record<string, string> },
  events: { emit: (name: string, ...args: unknown[]) => void },
) {
  instrumentPage(page, "auth-probe");
  const baseUrl = process.env.TARGET_URL || vuContext.vars.target || "https://auth.defcon.run";
  const email = randomEmail();
  const loginStartTime = new Date();

  // Step 1: Navigate to login page
  try {
    await page.goto(`${baseUrl}${REGION_PREFIX}/login`, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.locator("text=Welcome!").waitFor({ timeout: 10000 });
  } catch (err) {
    console.error("[auth-probe] Login page failed:", err);
    return;
  }

  // Step 2: Get CSRF token
  let csrfToken: string;
  try {
    const csrfResp = await page.request.get(`${baseUrl}${REGION_PREFIX}/api/auth/csrf`);
    const csrfData = await csrfResp.json();
    csrfToken = csrfData.csrfToken;
    if (!csrfToken) throw new Error("Missing csrfToken");
  } catch (err) {
    console.error("[auth-probe] CSRF fetch failed:", err);
    return;
  }

  // Step 3: Solve ALTCHA challenge
  let altchaPayload: string;
  try {
    altchaPayload = await solveAltcha(baseUrl);
  } catch (err) {
    console.error("[auth-probe] ALTCHA solve failed:", err);
    return;
  }

  // Step 4: Submit login
  try {
    const loginResp = await page.request.post(`${baseUrl}${REGION_PREFIX}/api/login`, {
      data: { email, inviteCode: INVITE_CODE, csrfToken, altcha: altchaPayload },
    });
    if (!loginResp.ok()) throw new Error(`Login POST returned ${loginResp.status()}`);
  } catch (err) {
    console.error("[auth-probe] Login POST failed:", err);
    return;
  }

  // Step 5: Poll S3 for MFA code
  let mfaCode: string;
  try {
    mfaCode = await waitForMfaCode(email, loginStartTime);
  } catch (err) {
    console.error("[auth-probe] MFA email retrieval failed:", err);
    return;
  }

  // Step 6: Complete MFA callback
  try {
    const callbackUrl = `${baseUrl}${REGION_PREFIX}/api/auth/callback/nodemailer?token=${mfaCode}&email=${encodeURIComponent(email)}&callbackUrl=${encodeURIComponent(`${REGION_PREFIX}/`)}`;
    await page.goto(callbackUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  } catch (err) {
    console.error("[auth-probe] MFA callback failed:", err);
    return;
  }

  // Step 7: Check profile page (authenticated)
  try {
    await page.goto(`${baseUrl}${REGION_PREFIX}/profile`, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(1000 + Math.random() * 2000);
  } catch (err) {
    console.error("[auth-probe] Profile page failed:", err);
  }

  // Step 8: Logout
  try {
    await page.goto(`${baseUrl}${REGION_PREFIX}/api/auth/signout`, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
  } catch {
    // Logout failure is non-fatal
  }
}
