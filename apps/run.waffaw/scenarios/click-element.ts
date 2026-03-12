import { Page } from "playwright";
import { instrumentPage } from "./index";

/**
 * Click element scenario — navigate to URL and click random elements.
 * Resilient: catches navigation/click errors and continues or breaks gracefully.
 */
export async function clickElement(
  page: Page,
  vuContext: { vars: Record<string, string> },
  events: { emit: (name: string, ...args: unknown[]) => void }
) {
  instrumentPage(page, "click-element");
  const baseUrl = process.env.TARGET_URL || vuContext.vars.target || "https://defcon.run";
  const targetUrl = vuContext.vars.url || baseUrl;
  const selector = vuContext.vars.selector || "a";
  const count = parseInt(vuContext.vars.count || "3", 10);

  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
  } catch {
    return; // Page failed to load
  }

  for (let i = 0; i < count; i++) {
    const elements = await page.$$(selector);
    if (elements.length === 0) break;

    const idx = Math.floor(Math.random() * elements.length);
    const el = elements[idx];

    await page.waitForTimeout(1000 + Math.random() * 3000);

    try {
      await el.click();
      await page.waitForLoadState("domcontentloaded").catch(() => {});
    } catch {
      break;
    }

    await page.waitForTimeout(1000 + Math.random() * 2000);
  }
}
