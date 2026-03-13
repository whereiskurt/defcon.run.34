import { Page } from "playwright";
import { instrumentPage } from "./index";

/**
 * Logout scenario — click logout button/link, wait for session teardown.
 * Resilient: tries multiple selectors and falls back to direct URL navigation.
 */
export async function logout(
  page: Page,
  vuContext: { vars: Record<string, string> },
  events: { emit: (name: string, ...args: unknown[]) => void }
) {
  instrumentPage(page, "logout");
  const logoutSelectors = [
    'a[href*="logout"]',
    'a[href*="signout"]',
    'button:has-text("Logout")',
    'button:has-text("Sign out")',
    'a:has-text("Logout")',
    'a:has-text("Sign out")',
  ];

  for (const selector of logoutSelectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        await page.waitForTimeout(500 + Math.random() * 1000);
        await element.click();
        await page.waitForLoadState("domcontentloaded").catch(() => {});
        return;
      }
    } catch {
      continue;
    }
  }

  // Fallback: navigate to logout URL directly
  const url = process.env.TARGET_URL || vuContext.vars.target || "https://defcon.run";
  try {
    await page.goto(`${url}/logout`, { waitUntil: "domcontentloaded", timeout: 15000 });
  } catch {
    // Logout failed — VU continues
  }
}
