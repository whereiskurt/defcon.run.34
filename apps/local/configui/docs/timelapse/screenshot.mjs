// screenshot.mjs — Playwright ESM script for ConfigUI screenshots
// Usage: node screenshot.mjs <url> <output_prefix> <commit_hash> <commit_message> [frame_num] [total_frames]

import { chromium } from 'playwright';

const [,, url, outputPrefix, commitHash, ...rest] = process.argv;

// Last two args are optional frame/total for progress bar
let msgParts, frameNum, totalFrames;
if (rest.length >= 3 && !isNaN(rest[rest.length - 1]) && !isNaN(rest[rest.length - 2])) {
  totalFrames = parseInt(rest.pop(), 10);
  frameNum = parseInt(rest.pop(), 10);
  msgParts = rest;
} else {
  msgParts = rest;
  frameNum = 0;
  totalFrames = 0;
}

const commitMsg = msgParts.join(' ');

if (!url || !outputPrefix) {
  console.error('Usage: node screenshot.mjs <url> <output_prefix> <commit_hash> <commit_message> [frame_num] [total_frames]');
  process.exit(1);
}

const shortHash = (commitHash || 'unknown').slice(0, 7);

async function addOverlay(page, hash, msg, frame, total) {
  await page.evaluate(({ hash, msg, frame, total }) => {
    const overlay = document.createElement('div');
    overlay.id = 'commit-overlay';
    overlay.style.cssText = `
      position: fixed; bottom: 0; left: 0; right: 0; z-index: 99999;
      background: #000; font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      display: flex; flex-direction: column;
    `;

    // Text row: commit hash + message + frame counter
    const textRow = document.createElement('div');
    textRow.style.cssText = `
      display: flex; align-items: center; gap: 16px;
      padding: 6px 16px; font-size: 20px; line-height: 1.3;
    `;
    const counterText = total > 0 ? `<span style="color:#666;margin-left:auto;font-size:16px">${frame}/${total}</span>` : '';
    textRow.innerHTML = `<span style="color:#ffb800;font-weight:bold">${hash}</span><span style="color:#00ff41">${msg}</span>${counterText}`;
    overlay.appendChild(textRow);

    // Progress bar (only if frame/total provided)
    if (total > 0) {
      const pct = Math.min(100, (frame / total) * 100);
      const barBg = document.createElement('div');
      barBg.style.cssText = 'height: 4px; background: #1a1a1a;';
      const barFill = document.createElement('div');
      barFill.style.cssText = `height: 100%; width: ${pct}%; background: #00ff41;`;
      barBg.appendChild(barFill);
      overlay.appendChild(barBg);
    }

    document.body.appendChild(overlay);
  }, { hash, msg, frame, total });
}

async function waitForAWSStatus(page) {
  try {
    await page.waitForFunction(() => {
      const el = document.getElementById('aws-status');
      if (!el) return true;
      const text = el.textContent || '';
      return text.includes('Connected') ||
             text.includes('Not authenticated') ||
             text.includes('Not Connected') ||
             text.includes('authenticated') ||
             text.includes('Account:') ||
             text.includes('SSO Login');
    }, { timeout: 12000 });
    await page.waitForTimeout(500);
  } catch {
    console.log(`  [screenshot] ${shortHash} AWS status wait timed out, proceeding`);
  }
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
    await waitForAWSStatus(page);
    await addOverlay(page, shortHash, commitMsg, frameNum, totalFrames);

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
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${outputPrefix}-preview.png`, fullPage: false });
      console.log(`  [screenshot] ${shortHash} preview captured`);
    } else {
      console.log(`  [screenshot] ${shortHash} no preview button found, skipping preview shot`);
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
