#!/usr/bin/env npx tsx
/**
 * Quick local test for auth-probe — runs the full flow in a visible browser.
 * Usage: cd apps/run.waffaw && npx tsx test-auth-probe.ts
 */
import { chromium } from "playwright";
import { authProbe } from "./scenarios/auth-probe";

// Override cooldown for local testing (skip the 2-min wait)
process.env.WAFFAW_NO_COOLDOWN = "1";

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  const vuContext = { vars: {} };
  const events = { emit: (name: string, ...args: unknown[]) => console.log(`[event] ${name}`, ...args) };

  try {
    await authProbe(page, vuContext, events);
    console.log("\n✅ auth-probe completed successfully");
  } catch (err) {
    console.error("\n❌ auth-probe failed:", err);
  }

  // Keep browser open for 5s so you can inspect
  await page.waitForTimeout(5000);
  await browser.close();
}

main();
