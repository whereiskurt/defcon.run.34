import { Page } from "playwright";

/**
 * Login scenario — navigate to login page, fill credentials, submit, wait for redirect.
 * Artillery Playwright engine calls this as: login(page, vuContext, events)
 */
export async function login(
  page: Page,
  vuContext: { vars: Record<string, string> },
  events: { emit: (name: string, ...args: unknown[]) => void }
) {
  const url = process.env.TARGET_URL || vuContext.vars.target || "https://defcon.run";
  const user = process.env.TEST_USER || vuContext.vars.username || "testuser";
  const pass = process.env.TEST_PASS || vuContext.vars.password || "testpass";

  // Navigate to login
  await page.goto(`${url}/login`, { waitUntil: "networkidle" });

  // Human-like think time before typing
  await page.waitForTimeout(1000 + Math.random() * 2000);

  // Fill credentials
  await page.fill('input[name="username"], input[type="email"], #username', user);
  await page.waitForTimeout(500 + Math.random() * 1000);
  await page.fill('input[name="password"], input[type="password"], #password', pass);

  // Think before submitting
  await page.waitForTimeout(500 + Math.random() * 1500);

  // Submit
  await page.click('button[type="submit"], input[type="submit"]');

  // Wait for navigation after login
  await page.waitForLoadState("networkidle");
}
