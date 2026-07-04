#!/usr/bin/env node
/**
 * Push curated public-overlay Route names into the LIVE CMS master.
 *
 * Reads src/seed/public-routes.json (the same source of truth the bootstrap
 * seeder uses) and UPSERTS each Route against the master's admin API:
 *   - missing            → create + publish
 *   - present, new name  → update name + (re)publish
 *   - present, same name → ensure published
 *
 * These are incremental HTTP writes to the running master (never a full-DB
 * replace), so nothing else in the CMS is touched. The master persists and
 * replicates, so worker replicas pick the change up within ~5 min (their
 * Litestream restore cycle). No redeploy needed.
 *
 * Auth: reads the Strapi admin email/password from SSM via the AWS CLI — no
 * standing write token required. Uses the admin creds because the shared API
 * token is read-only.
 *
 * Usage:
 *   node scripts/push-routes.mjs                     # target prod master
 *   CMS_BASE=http://localhost:1337 node scripts/push-routes.mjs   # local dev
 *
 * Env overrides: CMS_BASE, AWS_PROFILE (default dc34-application), AWS_REGION
 * (default us-east-1), SSM_ADMIN_EMAIL, SSM_ADMIN_PASSWORD.
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

const UID = 'api::route.route';
const CT = `/content-manager/collection-types/${UID}`;

const here = dirname(fileURLToPath(import.meta.url));
const routes = JSON.parse(readFileSync(join(here, '..', 'src', 'seed', 'public-routes.json'), 'utf8'));

function ssm(name) {
  return execFileSync(
    'aws',
    ['ssm', 'get-parameter', '--name', name, '--with-decryption',
      '--query', 'Parameter.Value', '--output', 'text',
      '--profile', AWS_PROFILE, '--region', AWS_REGION],
    { encoding: 'utf8' },
  ).trim();
}

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${CMS_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

// content-manager responses wrap the entity in {data} on write, but return it
// flat in results[] on find — normalise to the entity either way.
const entity = (r) => (r && r.data) || r;

async function main() {
  console.log(`Target: ${CMS_BASE}`);
  const email = ssm(SSM_EMAIL);
  const password = ssm(SSM_PASSWORD);
  const login = await api('/admin/login', { method: 'POST', body: { email, password } });
  const token = login?.data?.token;
  if (!token) throw new Error('admin login did not return a token');
  console.log('Authenticated as admin.\n');

  let created = 0, updated = 0, unchanged = 0, skipped = 0;
  for (const r of routes) {
    if (!r.gpxFileId || !r.name) { skipped++; continue; }

    const found = await api(
      `${CT}?filters[gpxFileId][$eq]=${encodeURIComponent(r.gpxFileId)}&pageSize=1`,
      { token },
    );
    const existing = found.results?.[0];

    if (!existing) {
      const doc = entity(await api(CT, { method: 'POST', token, body: { name: r.name, gpxFileId: r.gpxFileId } }));
      await api(`${CT}/${doc.documentId}/actions/publish`, { method: 'POST', token });
      console.log(`  + created   ${r.gpxFileId}  →  "${r.name}"`);
      created++;
    } else if (existing.name !== r.name) {
      await api(`${CT}/${existing.documentId}`, { method: 'PUT', token, body: { name: r.name } });
      await api(`${CT}/${existing.documentId}/actions/publish`, { method: 'POST', token });
      console.log(`  ~ updated   ${r.gpxFileId}  →  "${r.name}"  (was "${existing.name}")`);
      updated++;
    } else {
      await api(`${CT}/${existing.documentId}/actions/publish`, { method: 'POST', token });
      unchanged++;
    }
  }

  console.log(`\nDone: ${created} created, ${updated} updated, ${unchanged} already current, ${skipped} skipped.`);
  console.log('Worker replicas pick this up within ~5 min (Litestream restore).');
}

main().catch((err) => { console.error('\npush-routes failed:', err.message); process.exit(1); });
