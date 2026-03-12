// demo-capture.mjs — Playwright script for capturing animated feature demo frames
// Usage: node demo-capture.mjs <url> <workflow> <output_dir> [--headed]

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const [,, url, workflowName, outputDir, ...flags] = process.argv;
const headed = flags.includes('--headed');

if (!url || !workflowName || !outputDir) {
  console.error('Usage: node demo-capture.mjs <url> <workflow> <output_dir> [--headed]');
  process.exit(1);
}

// ─── Workflow Definitions ──────────────────────────────────────────────────────
// Step types:
//   screenshot  — capture frame with label
//   click       — click selector
//   wait        — wait N ms
//   waitFor     — wait for selector to appear
//   waitForText — wait for text in selector
//   evaluate    — run JS in page
//   scroll      — scroll to selector
//   awsWait     — wait for discovery-data[data-status="idle"]

const WORKFLOWS = {
  'preview-toggle': {
    title: 'Preview Panel',
    steps: [
      { type: 'screenshot', label: 'Form view' },
      { type: 'click', selector: '#preview-toggle-btn' },
      { type: 'wait', ms: 800 },
      { type: 'screenshot', label: 'Preview open — site.hcl' },
      { type: 'evaluate', fn: "switchPreviewTab('svc-auth')" },
      { type: 'wait', ms: 400 },
      { type: 'screenshot', label: 'Tab: run.auth/service.hcl' },
      { type: 'evaluate', fn: "switchPreviewTab('envsh')" },
      { type: 'wait', ms: 400 },
      { type: 'screenshot', label: 'Tab: env.sh' },
      { type: 'evaluate', fn: "switchPreviewTab('envlocal')" },
      { type: 'wait', ms: 400 },
      { type: 'screenshot', label: 'Tab: env.local.sh' },
      { type: 'evaluate', fn: "switchPreviewTab('sitehcl')" },
      { type: 'wait', ms: 400 },
      { type: 'click', selector: '#preview-toggle-btn' },
      { type: 'wait', ms: 500 },
      { type: 'screenshot', label: 'Preview closed' },
    ],
  },

  'module-toggle': {
    title: 'Module Toggles',
    steps: [
      { type: 'scroll', selector: '[data-panel="cloudfront"]' },
      { type: 'wait', ms: 300 },
      { type: 'screenshot', label: 'Modules enabled' },
      { type: 'click', selector: '[data-panel="cloudfront"] .toggle-switch' },
      { type: 'wait', ms: 400 },
      { type: 'screenshot', label: 'CloudFront disabled' },
      { type: 'click', selector: '[data-panel="waf"] .toggle-switch' },
      { type: 'wait', ms: 400 },
      { type: 'screenshot', label: 'WAF disabled' },
      { type: 'click', selector: '#section-toggle-infra' },
      { type: 'wait', ms: 400 },
      { type: 'screenshot', label: 'All modules off' },
      { type: 'click', selector: '#section-toggle-infra' },
      { type: 'wait', ms: 400 },
      { type: 'screenshot', label: 'All modules on' },
    ],
  },

  'panel-navigation': {
    title: 'Panel Navigation',
    steps: [
      { type: 'screenshot', label: 'Default view' },
      { type: 'click', selector: '#global-fold-btn' },
      { type: 'wait', ms: 500 },
      { type: 'screenshot', label: 'All panels expanded' },
      { type: 'click', selector: '#global-fold-btn' },
      { type: 'wait', ms: 500 },
      { type: 'screenshot', label: 'All panels collapsed' },
      { type: 'click', selector: '#section-chevron-core' },
      { type: 'wait', ms: 400 },
      { type: 'screenshot', label: 'Core section expanded' },
      { type: 'click', selector: '#section-chevron-infra' },
      { type: 'wait', ms: 400 },
      { type: 'screenshot', label: 'Infra section expanded' },
      { type: 'click', selector: '#section-chevron-svc' },
      { type: 'wait', ms: 400 },
      { type: 'screenshot', label: 'Services section expanded' },
    ],
  },

  'pii-blur': {
    title: 'PII Blur',
    steps: [
      { type: 'screenshot', label: 'Fields blurred (default)' },
      { type: 'click', selector: '#blur-toggle-btn' },
      { type: 'wait', ms: 300 },
      { type: 'click', selector: '#unblur-yes-btn' },
      { type: 'wait', ms: 500 },
      { type: 'screenshot', label: 'All fields revealed' },
      { type: 'click', selector: '#blur-toggle-btn' },
      { type: 'wait', ms: 500 },
      { type: 'screenshot', label: 'Fields re-blurred' },
    ],
  },

  'discovery-refresh': {
    title: 'Discovery Refresh',
    needsAWS: true,
    steps: [
      { type: 'scroll', selector: '#requery-aws-btn' },
      { type: 'wait', ms: 300 },
      { type: 'screenshot', label: 'Discovery idle' },
      { type: 'click', selector: '#requery-aws-btn' },
      { type: 'wait', ms: 300 },
      { type: 'click', selector: '#cfd-confirm' },
      { type: 'wait', ms: 800 },
      { type: 'screenshot', label: 'Discovery scanning' },
      { type: 'awsWait' },
      { type: 'screenshot', label: 'Discovery complete' },
    ],
  },

  'plan-module': {
    title: 'Terragrunt Plan',
    needsAWS: true,
    steps: [
      { type: 'scroll', selector: '[data-panel="github_oidc"]' },
      { type: 'wait', ms: 300 },
      { type: 'screenshot', label: 'GitHub OIDC panel' },
      { type: 'click', selector: '[data-panel="github_oidc"] .action-group-plan' },
      { type: 'wait', ms: 300 },
      { type: 'click', selector: '#cfd-confirm' },
      { type: 'wait', ms: 2000 },
      { type: 'screenshot', label: 'Terminal streaming' },
      { type: 'waitFor', selector: '.term-close-btn', timeout: 60000 },
      { type: 'wait', ms: 500 },
      { type: 'screenshot', label: 'Plan complete' },
      { type: 'click', selector: '.term-close-btn' },
      { type: 'wait', ms: 500 },
      { type: 'screenshot', label: 'Terminal closed' },
    ],
  },
};

// ─── Overlay Injection ─────────────────────────────────────────────────────────

async function injectOverlay(page, label, stepNum, totalSteps, workflowTitle) {
  await page.evaluate(({ label, stepNum, totalSteps, workflowTitle }) => {
    let overlay = document.getElementById('demo-overlay');
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.id = 'demo-overlay';
    overlay.style.cssText = `
      position: fixed; bottom: 0; left: 0; right: 0; z-index: 99999;
      background: rgba(0,0,0,0.88); font-family: 'Fira Code', 'Courier New', monospace;
      padding: 0; display: flex; flex-direction: column;
    `;

    // Progress bar
    const pct = ((stepNum) / totalSteps) * 100;
    const bar = document.createElement('div');
    bar.style.cssText = `height: 3px; background: #1a1a1a;`;
    const fill = document.createElement('div');
    fill.style.cssText = `height: 100%; width: ${pct}%; background: #00ff41; transition: width 0.3s;`;
    bar.appendChild(fill);
    overlay.appendChild(bar);

    // Label row
    const row = document.createElement('div');
    row.style.cssText = `
      display: flex; align-items: center; justify-content: space-between;
      padding: 6px 16px; font-size: 15px;
    `;
    row.innerHTML =
      `<span style="color:#00ff41;font-weight:bold">${label}</span>` +
      `<span style="color:#666;font-size:12px">${workflowTitle} &mdash; ${stepNum} / ${totalSteps}</span>`;
    overlay.appendChild(row);

    document.body.appendChild(overlay);
  }, { label, stepNum, totalSteps, workflowTitle });
}

// ─── Step Executor ─────────────────────────────────────────────────────────────

async function run() {
  const workflow = WORKFLOWS[workflowName];
  if (!workflow) {
    console.error(`Unknown workflow: ${workflowName}`);
    console.error(`Available: ${Object.keys(WORKFLOWS).join(', ')}`);
    process.exit(1);
  }

  mkdirSync(outputDir, { recursive: true });

  const screenshotSteps = workflow.steps.filter(s => s.type === 'screenshot');
  const totalScreenshots = screenshotSteps.length;

  console.log(`[demo] Workflow: ${workflowName} (${workflow.title})`);
  console.log(`[demo] Screenshots: ${totalScreenshots}, URL: ${url}`);
  console.log(`[demo] Output: ${outputDir}`);

  const browser = await chromium.launch({ headless: !headed });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  let screenshotIdx = 0;

  try {
    // Navigate and wait for page load
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });

    // Wait for AWS status to settle (matches screenshot.mjs pattern)
    try {
      await page.waitForFunction(() => {
        const el = document.getElementById('aws-status');
        if (!el) return true;
        const text = el.textContent || '';
        return text.includes('Connected') || text.includes('Not authenticated') ||
               text.includes('Not Connected') || text.includes('Account:') ||
               text.includes('SSO Login');
      }, { timeout: 12000 });
      await page.waitForTimeout(500);
    } catch {
      console.log('[demo] AWS status wait timed out, proceeding');
    }

    // Execute steps
    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];

      switch (step.type) {
        case 'screenshot': {
          screenshotIdx++;
          const padded = String(screenshotIdx).padStart(2, '0');
          const path = `${outputDir}/${padded}.png`;
          await injectOverlay(page, step.label, screenshotIdx, totalScreenshots, workflow.title);
          await page.waitForTimeout(200); // let overlay render
          await page.screenshot({ path, fullPage: false });
          console.log(`[demo]   ${padded}/${String(totalScreenshots).padStart(2, '0')} — ${step.label}`);
          break;
        }

        case 'click': {
          const el = page.locator(step.selector).first();
          await el.waitFor({ state: 'visible', timeout: step.timeout || 5000 });
          await el.click();
          break;
        }

        case 'wait': {
          await page.waitForTimeout(step.ms);
          break;
        }

        case 'waitFor': {
          await page.locator(step.selector).first().waitFor({
            state: 'visible',
            timeout: step.timeout || 10000,
          });
          break;
        }

        case 'waitForText': {
          await page.locator(`${step.selector}:has-text("${step.text}")`).first().waitFor({
            state: 'visible',
            timeout: step.timeout || 10000,
          });
          break;
        }

        case 'evaluate': {
          await page.evaluate(step.fn);
          break;
        }

        case 'scroll': {
          const el = page.locator(step.selector).first();
          await el.waitFor({ state: 'attached', timeout: 5000 });
          await el.scrollIntoViewIfNeeded();
          break;
        }

        case 'awsWait': {
          // Wait for discovery to finish (data-status returns to "idle")
          try {
            await page.waitForFunction(() => {
              const el = document.getElementById('discovery-data');
              return el && el.getAttribute('data-status') === 'idle';
            }, { timeout: step.timeout || 30000 });
            await page.waitForTimeout(500);
          } catch {
            console.log('[demo]   AWS wait timed out, proceeding');
          }
          break;
        }

        default:
          console.warn(`[demo] Unknown step type: ${step.type}`);
      }
    }

    console.log(`[demo] Workflow "${workflowName}" complete — ${screenshotIdx} frames captured`);

  } catch (err) {
    console.error(`[demo] ERROR at step: ${err.message}`);
    // Capture error screenshot for debugging
    try {
      const errPath = `${outputDir}/error.png`;
      await page.screenshot({ path: errPath, fullPage: false });
      console.error(`[demo] Error screenshot saved: ${errPath}`);
    } catch { /* ignore */ }
    process.exit(1);
  } finally {
    await browser.close();
  }
}

run();
