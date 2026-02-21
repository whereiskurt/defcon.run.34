import { Page } from "playwright";

/**
 * Form submit scenario — navigate to URL, fill form fields, submit.
 */
export async function submitForm(
  page: Page,
  vuContext: { vars: Record<string, string> },
  events: { emit: (name: string, ...args: unknown[]) => void }
) {
  const baseUrl = process.env.TARGET_URL || vuContext.vars.target || "https://defcon.run";
  const targetUrl = vuContext.vars.url || `${baseUrl}/contact`;

  await page.goto(targetUrl, { waitUntil: "networkidle" });

  // Think before starting to fill
  await page.waitForTimeout(1000 + Math.random() * 2000);

  // Parse fields from vars: field_name=selector pairs
  // e.g., vuContext.vars.fields = "name:#name,email:#email,message:#message"
  const fieldsStr = vuContext.vars.fields || "";
  const fields = fieldsStr.split(",").filter(Boolean);

  for (const field of fields) {
    const [name, selector] = field.split(":");
    if (!name || !selector) continue;

    // Generate plausible test data based on field name
    const value = generateFieldValue(name);
    await page.fill(selector, value);

    // Human-like pause between fields
    await page.waitForTimeout(300 + Math.random() * 800);
  }

  // If no fields specified, try to fill any visible text inputs
  if (fields.length === 0) {
    const inputs = await page.$$('input[type="text"], input[type="email"], textarea');
    for (const input of inputs) {
      const inputType = await input.getAttribute("type");
      const inputName = await input.getAttribute("name");
      const value = generateFieldValue(inputName || inputType || "text");
      await input.fill(value);
      await page.waitForTimeout(300 + Math.random() * 500);
    }
  }

  // Think before submitting
  await page.waitForTimeout(500 + Math.random() * 1500);

  // Submit the form
  const submitBtn = await page.$('button[type="submit"], input[type="submit"]');
  if (submitBtn) {
    await submitBtn.click();
    await page.waitForLoadState("networkidle");
  }
}

function generateFieldValue(fieldName: string): string {
  const name = fieldName.toLowerCase();
  if (name.includes("email")) return `test-${Date.now()}@example.com`;
  if (name.includes("name")) return "Test User";
  if (name.includes("message") || name.includes("comment")) return "This is an automated test submission.";
  if (name.includes("phone")) return "555-0100";
  if (name.includes("url") || name.includes("website")) return "https://example.com";
  return "test input";
}
