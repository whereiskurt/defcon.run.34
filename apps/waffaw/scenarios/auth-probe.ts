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

const AUTH_ORIGIN = "https://auth.defcon.run";
const APP_ORIGIN = "https://run.defcon.run";

const EMAIL_PREFIX = "inbox/email.defcon.run/";
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
 * Full auth probe — two-phase OIDC login:
 *   Phase 1: Authenticate at auth.defcon.run (ALTCHA + email MFA)
 *   Phase 2: OIDC sign-in at run.defcon.run using the auth session
 *   Phase 3: Verify profile, then logout
 */
// Minimum time (ms) each probe cycle must take, even on failure.
// Prevents rapid-fire retries that trip WAF rate limits (200 req/5min global).
const MIN_CYCLE_MS = 120_000; // 2 minutes

export async function authProbe(
  page: Page,
  vuContext: { vars: Record<string, string> },
  events: { emit: (name: string, ...args: unknown[]) => void },
) {
  const cycleStart = Date.now();
  try {
    await _authProbeInner(page, vuContext, events);
  } finally {
    if (!process.env.WAFFAW_NO_COOLDOWN) {
      const elapsed = Date.now() - cycleStart;
      if (elapsed < MIN_CYCLE_MS) {
        const wait = MIN_CYCLE_MS - elapsed;
        console.log(`[auth-probe] Cooldown ${Math.round(wait / 1000)}s (min cycle ${MIN_CYCLE_MS / 1000}s)`);
        await new Promise(resolve => setTimeout(resolve, wait));
      }
    }
  }
}

async function _authProbeInner(
  page: Page,
  vuContext: { vars: Record<string, string> },
  events: { emit: (name: string, ...args: unknown[]) => void },
) {
  instrumentPage(page, "auth-probe");
  const email = randomEmail();
  const loginStartTime = new Date();

  // ── Phase 1: Authenticate at auth.defcon.run ──

  // Step 1: Navigate to auth login page (follow redirects, wait for React hydration)
  try {
    await page.goto(`${AUTH_ORIGIN}${REGION_PREFIX}/login`, { waitUntil: "load", timeout: 30000 });
    await page.locator("text=Welcome!").waitFor({ timeout: 15000 });
  } catch (err) {
    console.error(`[auth-probe] Auth login page failed (url=${page.url()}):`, err);
    return;
  }

  // Step 2: Get CSRF token from auth service
  let csrfToken: string;
  try {
    const csrfResp = await page.request.get(`${AUTH_ORIGIN}${REGION_PREFIX}/api/auth/csrf`);
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
    altchaPayload = await solveAltcha(AUTH_ORIGIN);
  } catch (err) {
    console.error("[auth-probe] ALTCHA solve failed:", err);
    return;
  }

  // Step 4: Submit login to auth service
  try {
    console.log(`[auth-probe] Submitting login for ${email}...`);
    const loginResp = await page.request.post(`${AUTH_ORIGIN}${REGION_PREFIX}/api/login`, {
      data: { email, inviteCode: INVITE_CODE, csrfToken, altcha: altchaPayload },
    });
    const loginBody = await loginResp.text();
    console.log(`[auth-probe] Login POST: ${loginResp.status()} — ${loginBody.slice(0, 200)}`);
    if (!loginResp.ok()) throw new Error(`Login POST returned ${loginResp.status()}: ${loginBody.slice(0, 200)}`);
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

  // Step 6: Complete MFA callback on auth.defcon.run (establishes auth session)
  // The callback redirects: /api/auth/callback/nodemailer → /use1/ (auth homepage)
  try {
    const callbackUrl = `${AUTH_ORIGIN}${REGION_PREFIX}/api/auth/callback/nodemailer?token=${mfaCode}&email=${encodeURIComponent(email)}&callbackUrl=${encodeURIComponent(`${REGION_PREFIX}/`)}`;
    await page.goto(callbackUrl, { waitUntil: "load", timeout: 30000 });
    // Wait for redirect chain to settle on auth.defcon.run
    await page.waitForURL(`${AUTH_ORIGIN}/**`, { timeout: 15000 });
    console.log(`[auth-probe] MFA callback complete, landed on: ${page.url()}`);
  } catch (err) {
    console.error(`[auth-probe] MFA callback failed (url=${page.url()}):`, err);
    return;
  }

  // ── Phase 2: OIDC sign-in at run.defcon.run ──

  // Step 7: Navigate to run.defcon.run and trigger OIDC flow
  // Click "Sign In" → redirects to auth.defcon.run (session exists) → redirects back with auth code
  try {
    await page.goto(`${APP_ORIGIN}${REGION_PREFIX}/`, { waitUntil: "load", timeout: 30000 });
    console.log(`[auth-probe] App homepage loaded: ${page.url()}`);
    // Click "Sign In" button to trigger OIDC flow
    const signInBtn = page.locator("text=Sign In").first();
    await signInBtn.waitFor({ timeout: 10000 });
    await signInBtn.click();
    // Wait for OIDC redirect chain to complete (run → auth → run)
    await page.waitForURL(`${APP_ORIGIN}/**`, { timeout: 30000 });
    console.log(`[auth-probe] OIDC complete, landed on: ${page.url()}`);
  } catch (err) {
    console.error(`[auth-probe] OIDC sign-in failed (url=${page.url()}):`, err);
    return;
  }

  // ── Phase 3: Verify and cleanup ──

  // Step 8: Check profile page on run.defcon.run (authenticated)
  try {
    await page.goto(`${APP_ORIGIN}${REGION_PREFIX}/profile`, { waitUntil: "load", timeout: 15000 });
    console.log(`[auth-probe] Profile page loaded: ${page.url()}`);
    await page.waitForTimeout(1000 + Math.random() * 2000);
  } catch (err) {
    console.error(`[auth-probe] Profile page failed (url=${page.url()}):`, err);
  }

  // Step 9: Logout from run.defcon.run
  try {
    await page.goto(`${APP_ORIGIN}${REGION_PREFIX}/api/auth/signout`, {
      waitUntil: "load",
      timeout: 15000,
    });
    console.log("[auth-probe] Logout complete");
  } catch {
    // Logout failure is non-fatal
  }
}
