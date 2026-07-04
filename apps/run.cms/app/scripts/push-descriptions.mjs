#!/usr/bin/env node
/**
 * Populate Route descriptions / shortDescriptions / stravaUrl on the live master
 * from scripts/route-descriptions.json (refined from last year's dc32 write-ups).
 *
 * FILL-EMPTY: only writes a field that's currently empty, so anything edited in
 * the CMS is never clobbered. `desc` (plain text, blank-line-separated) is
 * converted to Strapi blocks; `short` → shortDescription; `strava` → stravaUrl
 * (skipped until that field exists in the deployed schema). Publishes on change.
 *
 * Usage: node scripts/push-descriptions.mjs
 * Env:   CMS_BASE, AWS_PROFILE (dc34-application), AWS_REGION, SSM_ADMIN_*.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CMS_BASE = (process.env.CMS_BASE || 'https://cms.defcon.run/use1').replace(/\/$/, '');
const AWS_PROFILE = process.env.AWS_PROFILE || 'dc34-application';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const SSM_EMAIL = process.env.SSM_ADMIN_EMAIL || '/dc34/secrets/use1/strapi/admin_email';
const SSM_PASSWORD = process.env.SSM_ADMIN_PASSWORD || '/dc34/secrets/use1/strapi/admin_password';
const CT = '/content-manager/collection-types/api::route.route';

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(here, 'route-descriptions.json'), 'utf8'));

function ssm(name) {
  return execFileSync('aws', ['ssm', 'get-parameter', '--name', name, '--with-decryption',
    '--query', 'Parameter.Value', '--output', 'text', '--profile', AWS_PROFILE, '--region', AWS_REGION],
    { encoding: 'utf8' }).trim();
}
async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${CMS_BASE}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status}: ${text.slice(0, 200)}`);
  return json;
}
const toBlocks = (text) =>
  text.split(/\n\n+/).map((p) => ({ type: 'paragraph', children: [{ type: 'text', text: p.trim() }] }));
const emptyDesc = (d) => d == null || (Array.isArray(d) && d.length === 0);

async function main() {
  console.log(`Target: ${CMS_BASE}`);
  const token = (await api('/admin/login', { method: 'POST', body: { email: ssm(SSM_EMAIL), password: ssm(SSM_PASSWORD) } }))?.data?.token;
  if (!token) throw new Error('admin login failed');

  let changed = 0, unchanged = 0, missing = 0;
  for (const [gpxFileId, entry] of Object.entries(data)) {
    if (gpxFileId.startsWith('_')) continue;
    const found = await api(`${CT}?filters[gpxFileId][$eq]=${encodeURIComponent(gpxFileId)}&pageSize=1`, { token });
    const ex = found.results?.[0];
    if (!ex) { console.log(`  - ${gpxFileId}: no CMS route`); missing++; continue; }

    const patch = {};
    if (entry.desc && emptyDesc(ex.description)) patch.description = toBlocks(entry.desc);
    if (entry.short && !ex.shortDescription) patch.shortDescription = entry.short;
    // stravaUrl only once the field is in the deployed schema (present as a key).
    if (entry.strava && 'stravaUrl' in ex && !ex.stravaUrl) patch.stravaUrl = entry.strava;

    if (Object.keys(patch).length === 0) { unchanged++; continue; }
    await api(`${CT}/${ex.documentId}`, { method: 'PUT', token, body: patch });
    await api(`${CT}/${ex.documentId}/actions/publish`, { method: 'POST', token });
    console.log(`  ~ ${ex.name.padEnd(24)} ${Object.keys(patch).join(', ')}`);
    changed++;
  }
  console.log(`\nDone: ${changed} updated, ${unchanged} already set, ${missing} missing. Workers sync in ~5 min.`);
  if (Object.values(data).some((e) => e.strava) && changed >= 0)
    console.log('Note: stravaUrl is only written after the schema field deploys — re-run this then.');
}
main().catch((e) => { console.error('\npush-descriptions failed:', e.message); process.exit(1); });
