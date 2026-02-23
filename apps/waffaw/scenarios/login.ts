import { Page } from "playwright";
import { instrumentPage } from "./index";

/**
 * Login scenario — navigate to login page, fill credentials, submit.
 * Resilient: catches missing elements and navigation failures gracefully.
 */
export async function login(
  page: Page,
  vuContext: { vars: Record<string, string> },
  events: { emit: (name: string, ...args: unknown[]) => void }
) {
  instrumentPage(page, "login");
  const url = process.env.TARGET_URL || vuContext.vars.target || "https://defcon.run";
  const user = process.env.TEST_USER || vuContext.vars.username || "testuser";
  const pass = process.env.TEST_PASS || vuContext.vars.password || "testpass";

  try {
    await page.goto(`${url}/login`, { waitUntil: "domcontentloaded", timeout: 15000 });
  } catch {
    return; // Page failed to load
  }

  await page.waitForTimeout(1000 + Math.random() * 2000);

  try {
    // Try username field — multiple selectors
    const userInput = await page.$('input[name="username"]')
      || await page.$('input[type="email"]')
      || await page.$('#username')
      || await page.$('input[name="email"]');
    if (userInput) {
      await userInput.fill(user);
      await page.waitForTimeout(500 + Math.random() * 1000);
    }

    // Try password field
    const passInput = await page.$('input[name="password"]')
      || await page.$('input[type="password"]')
      || await page.$('#password');
    if (passInput) {
      await passInput.fill(pass);
      await page.waitForTimeout(500 + Math.random() * 1500);
    }

    // Try submit button
    const submitBtn = await page.$('button[type="submit"]')
      || await page.$('input[type="submit"]')
      || await page.$('button:has-text("Log in")')
      || await page.$('button:has-text("Sign in")');
    if (submitBtn) {
      await submitBtn.click();
      await page.waitForLoadState("domcontentloaded").catch(() => {});
    }
  } catch {
    // Element interaction failed — VU continues
  }
}
