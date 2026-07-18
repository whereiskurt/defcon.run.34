#!/usr/bin/env node
//
// measure-size.mjs — bake real full-page transfer weight into site/status.json.
//
// The status page shows LIVE latency (measured from the visitor's own browser)
// next to a SIZE number. Size can't be measured honestly from the browser: the
// services live on other subdomains, so cross-origin timing zeroes out the bytes
// unless every service opts in with a Timing-Allow-Origin header. But this script
// runs server-side (Node/Playwright), where CORS does not apply — so it can load
// each page in headless chromium, watch every response, and sum the real
// on-the-wire (compressed) bytes a phone would pull. Framework-agnostic: it treats
// the Next.js apps, the Strapi admin, and the gpx-studio Svelte build identically.
//
// Usage:
//   node measure-size.mjs             # measure every service that has a link/host
//   node measure-size.mjs auth gpx    # only these service ids
//
// Then publish with ./release.sh (full sync, since status.json changed).
//
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(HERE, 'site', 'status.json');
const NAV_TIMEOUT = 30000;   // hard cap per page load
const IDLE_MS = 2000;        // settle time to catch lazy chunks after networkidle

// Bucket Playwright resourceType into the categories the status card shows.
function bucket(t) {
  if (t === 'image' || t === 'media') return 'img';
  if (t === 'script') return 'js';
  if (t === 'stylesheet') return 'css';
  if (t === 'font') return 'font';
  return 'other';   // document, fetch, xhr, manifest, websocket, …
}

// Load one URL in a fresh context and sum the transferred bytes of every
// response — both a grand total and a per-type breakdown (img/js/css/font/other).
async function measure(browser, url) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  let bytes = 0, reqs = 0;
  const byType = { img: 0, js: 0, css: 0, font: 0, other: 0 };
  page.on('requestfinished', async (req) => {
    try {
      const sizes = await req.sizes();              // on-the-wire, post-compression
      const b = (sizes.responseBodySize || 0) + (sizes.responseHeadersSize || 0);
      bytes += b;
      byType[bucket(req.resourceType())] += b;
      reqs++;
    } catch { /* request went away before we could size it */ }
  });
  try {
    await page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT });
    await page.waitForLoadState('networkidle', { timeout: NAV_TIMEOUT }).catch(() => {});
    await page.waitForTimeout(IDLE_MS);
  } finally {
    await ctx.close();
  }
  return { bytes, reqs, byType };
}

const data = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
const only = process.argv.slice(2);
const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

const browser = await chromium.launch();
try {
  for (const s of data.services) {
    if (only.length && !only.includes(s.id)) continue;
    const url = s.link || (s.host ? 'https://' + s.host : null);
    if (!url) { console.log(`- ${s.id.padEnd(6)} no url, skipped`); continue; }
    process.stdout.write(`• ${s.id.padEnd(6)} ${url} … `);
    try {
      const { bytes, reqs, byType } = await measure(browser, url);
      const kb = Math.round(bytes / 1024);
      // A bare redirect / auth wall / block returns almost nothing — that's not a
      // real page weight. Leave such services unmeasured (page shows "—") rather
      // than baking a misleading "0 KB". cms.defcon.run is admin-gated, so it lands here.
      if (kb < 20) {
        delete s.size_kb; delete s.req_count; delete s.measured_at; delete s.size_by;
        console.log(`${kb} KB · ${reqs} reqs — too small (gated/blocked?), left unmeasured`);
      } else {
        s.size_kb = kb;
        s.req_count = reqs;
        s.size_by = Object.fromEntries(
          Object.entries(byType).map(([k, v]) => [k, Math.round(v / 1024)])
        );
        s.measured_at = now;
        const parts = Object.entries(s.size_by).filter(([, v]) => v > 0)
          .map(([k, v]) => `${k} ${v}`).join(' · ');
        console.log(`${s.size_kb} KB · ${reqs} reqs  [${parts}]`);
      }
    } catch (e) {
      console.log(`FAILED (${e.message})`);
    }
  }
} finally {
  await browser.close();
}

writeFileSync(JSON_PATH, JSON.stringify(data, null, 2) + '\n');
console.log(`\n✓ wrote ${JSON_PATH}`);
