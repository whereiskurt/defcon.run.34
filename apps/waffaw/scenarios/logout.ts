import { Page } from "playwright";

/**
 * Logout scenario — click logout button/link, wait for session teardown.
 */
export async function logout(
  page: Page,
  vuContext: { vars: Record<string, string> },
  events: { emit: (name: string, ...args: unknown[]) => void }
) {
  // Try common logout selectors
  const logoutSelectors = [
    'a[href*="logout"]',
    'a[href*="signout"]',
    'button:has-text("Logout")',
    'button:has-text("Sign out")',
    'a:has-text("Logout")',
    'a:has-text("Sign out")',
  ];

  for (const selector of logoutSelectors) {
    const element = await page.$(selector);
    if (element) {
      await page.waitForTimeout(500 + Math.random() * 1000);
      await element.click();
      await page.waitForLoadState("networkidle");
      return;
    }
  }

  // Fallback: navigate to logout URL directly
  const url = process.env.TARGET_URL || vuContext.vars.target || "https://defcon.run";
  await page.goto(`${url}/logout`, { waitUntil: "networkidle" });
}
