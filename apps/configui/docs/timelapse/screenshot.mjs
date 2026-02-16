// screenshot.mjs — Playwright ESM script for ConfigUI screenshots
// Usage: node screenshot.mjs <url> <output_prefix> <commit_hash> <commit_message>

import { chromium } from 'playwright';

const [,, url, outputPrefix, commitHash, ...msgParts] = process.argv;
const commitMsg = msgParts.join(' ');

if (!url || !outputPrefix) {
  console.error('Usage: node screenshot.mjs <url> <output_prefix> <commit_hash> <commit_message>');
  process.exit(1);
}

const shortHash = (commitHash || 'unknown').slice(0, 7);

async function addOverlay(page, hash, msg) {
  // Inject a fixed overlay banner at the bottom of the viewport
  await page.evaluate(({ hash, msg }) => {
    const overlay = document.createElement('div');
    overlay.id = 'commit-overlay';
    overlay.style.cssText = `
      position: fixed; bottom: 0; left: 0; right: 0; z-index: 99999;
      background: rgba(0,0,0,0.85); color: #00ff41; font-family: 'Fira Code', monospace;
      font-size: 18px; padding: 8px 16px; display: flex; gap: 16px; align-items: center;
    `;
    overlay.innerHTML = `<span style="color:#ffb800;font-weight:bold">${hash}</span><span>${msg}</span>`;
    document.body.appendChild(overlay);
  }, { hash, msg });
}

async function waitForAWSStatus(page) {
  // Wait for the AWS status bar to resolve (connected or error)
  // The HTMX div #aws-status fires on page load and fetches /api/aws-status
  // We wait for "Not Connected" or "Connected" or similar text to appear
  try {
    // Wait for the aws-status div to have content (not loading)
    await page.waitForFunction(() => {
      const el = document.getElementById('aws-status');
      if (!el) return true; // no status bar in early commits
      const text = el.textContent || '';
      // Check if the status has resolved (connected, not connected, or error)
      return text.includes('Connected') ||
             text.includes('Not authenticated') ||
             text.includes('Not Connected') ||
             text.includes('authenticated') ||
             text.includes('Account:') ||
             text.includes('SSO Login');
    }, { timeout: 12000 });
    // Small extra wait for any animations/rendering
    await page.waitForTimeout(500);
  } catch {
    // If timeout, just proceed with whatever state we have
    console.log(`  [screenshot] ${shortHash} AWS status wait timed out, proceeding`);
  }
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  try {
    // Navigate and wait for network idle
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });

    // Wait for AWS status to resolve
    await waitForAWSStatus(page);

    // Add commit overlay
    await addOverlay(page, shortHash, commitMsg);

    // Screenshot 1: Form view
    await page.screenshot({ path: `${outputPrefix}-form.png`, fullPage: false });
    console.log(`  [screenshot] ${shortHash} form captured`);

    // Try to click Preview button (text varies across commits)
    let previewClicked = false;
    const previewSelectors = [
      'button:has-text("Preview To Save")',
      'button:has-text("Preview")',
      'button:has-text("preview")',
      '#preview-toggle-btn',
      'button[onclick*="preview"]',
      'button[onclick*="Preview"]',
    ];

    for (const sel of previewSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 500 })) {
          await btn.click({ timeout: 2000 });
          previewClicked = true;
          console.log(`  [screenshot] ${shortHash} clicked preview via: ${sel}`);
          break;
        }
      } catch {
        // try next selector
      }
    }

    if (previewClicked) {
      // Wait for preview panel to render
      await page.waitForTimeout(1500);
      // Screenshot 2: With preview
      await page.screenshot({ path: `${outputPrefix}-preview.png`, fullPage: false });
      console.log(`  [screenshot] ${shortHash} preview captured`);
    } else {
      console.log(`  [screenshot] ${shortHash} no preview button found, skipping preview shot`);
      // Copy form screenshot as preview fallback
      const fs = await import('fs');
      fs.copyFileSync(`${outputPrefix}-form.png`, `${outputPrefix}-preview.png`);
    }

  } catch (err) {
    console.error(`  [screenshot] ${shortHash} ERROR: ${err.message}`);
  } finally {
    await browser.close();
  }
}

run();
