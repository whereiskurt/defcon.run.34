import { Page } from "playwright";

/**
 * Browse public pages — visit a list of public URLs with configurable think time.
 * Resilient: catches navigation/timeout errors and continues to next page.
 */
export async function browsePublic(
  page: Page,
  vuContext: { vars: Record<string, string> },
  events: { emit: (name: string, ...args: unknown[]) => void }
) {
  const baseUrl = process.env.TARGET_URL || vuContext.vars.target || "https://defcon.run";
  const thinkTimeBase = parseInt(vuContext.vars.thinkTime || "3000", 10);

  const defaultPaths = ["/", "/schedule", "/about", "/faq", "/contact"];
  const paths = vuContext.vars.urls
    ? vuContext.vars.urls.split(",")
    : defaultPaths;

  for (const path of paths) {
    const url = path.startsWith("http") ? path : `${baseUrl}${path}`;

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });

      // Simulate reading the page — random scroll
      await page.evaluate(() => {
        window.scrollBy(0, Math.random() * document.body.scrollHeight * 0.6);
      });
    } catch {
      // Page failed to load — continue to next URL
    }

    // Human-like think time with randomization
    const thinkTime = thinkTimeBase + Math.random() * thinkTimeBase;
    await page.waitForTimeout(thinkTime);
  }
}
