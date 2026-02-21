import { Page } from "playwright";

/**
 * Click element scenario — navigate to URL and click a specific element N times.
 */
export async function clickElement(
  page: Page,
  vuContext: { vars: Record<string, string> },
  events: { emit: (name: string, ...args: unknown[]) => void }
) {
  const baseUrl = process.env.TARGET_URL || vuContext.vars.target || "https://defcon.run";
  const targetUrl = vuContext.vars.url || baseUrl;
  const selector = vuContext.vars.selector || "a";
  const count = parseInt(vuContext.vars.count || "3", 10);

  await page.goto(targetUrl, { waitUntil: "networkidle" });

  for (let i = 0; i < count; i++) {
    // Find all matching elements and pick one randomly
    const elements = await page.$$(selector);
    if (elements.length === 0) break;

    const idx = Math.floor(Math.random() * elements.length);
    const el = elements[idx];

    // Think before clicking
    await page.waitForTimeout(1000 + Math.random() * 3000);

    try {
      await el.click();
      await page.waitForLoadState("networkidle");
    } catch {
      // Element may have been removed from DOM; continue
      break;
    }

    // Think after click
    await page.waitForTimeout(1000 + Math.random() * 2000);
  }
}
