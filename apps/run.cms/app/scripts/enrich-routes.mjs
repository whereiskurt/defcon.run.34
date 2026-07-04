#!/usr/bin/env node
/**
 * Enrich the CMS Routes with COMPUTED values and push them to the live master:
 *   - mapColor  ← the studio DC34 palette (routeColor by manifest order), so the
 *                 CMS holds the good varied colors instead of the seed default.
 *   - distance (km) + elevationGain (m) ← computed from each route's actual GPX
 *                 track (haversine length + cumulative positive elevation).
 *
 * Reads the public manifest for the route order + presigned GPX download URLs,
 * then upserts each matching CMS Route by gpxFileId via the admin API (auth from
 * SSM admin creds) and publishes. Incremental writes; workers sync in ~5 min.
 *
 * Usage: node scripts/enrich-routes.mjs
 * Env:   MANIFEST_URL (default https://gpx.defcon.run/use1/api/gpx/public/maps),
 *        CMS_BASE, AWS_PROFILE (dc34-application), AWS_REGION, SSM_ADMIN_*.
 */
import { execFileSync } from 'node:child_process';

const MANIFEST_URL = process.env.MANIFEST_URL || 'https://gpx.defcon.run/use1/api/gpx/public/maps';
const CMS_BASE = (process.env.CMS_BASE || 'https://cms.defcon.run/use1').replace(/\/$/, '');
const AWS_PROFILE = process.env.AWS_PROFILE || 'dc34-application';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const SSM_EMAIL = process.env.SSM_ADMIN_EMAIL || '/dc34/secrets/use1/strapi/admin_email';
const SSM_PASSWORD = process.env.SSM_ADMIN_PASSWORD || '/dc34/secrets/use1/strapi/admin_password';

const CT = '/content-manager/collection-types/api::route.route';

// DC34 varied route ramp — must match gpx-studio/src/lib/dc34-palette.ts.
const RAMP = ['#e6007a', '#00e5ff', '#00d4aa', '#f59e0b', '#9933ff', '#22c55e', '#ff9900', '#50f0be', '#ff6ebe'];
const paletteColor = (i) => RAMP[((i % RAMP.length) + RAMP.length) % RAMP.length];

function ssm(name) {
  return execFileSync('aws', ['ssm', 'get-parameter', '--name', name, '--with-decryption',
    '--query', 'Parameter.Value', '--output', 'text', '--profile', AWS_PROFILE, '--region', AWS_REGION],
    { encoding: 'utf8' }).trim();
}

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${CMS_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status}: ${text.slice(0, 200)}`);
  return json;
}

function haversine(a, b) {
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Extract lat/lon/ele points for a given GPX point tag (trkpt or rtept). */
function extractPoints(xml, tag) {
  const pts = [];
  const re = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>|<${tag}\\b([^>]*)/>`, 'g');
  let m;
  while ((m = re.exec(xml))) {
    const attrs = m[1] || m[3] || '', inner = m[2] || '';
    const lat = parseFloat((attrs.match(/lat="([-\d.]+)"/) || [])[1]);
    const lon = parseFloat((attrs.match(/lon="([-\d.]+)"/) || [])[1]);
    const ele = parseFloat((inner.match(/<ele>([-\d.]+)<\/ele>/) || [])[1]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push({ lat, lon, ele: Number.isFinite(ele) ? ele : null });
  }
  return pts;
}

/** Distance (km) + positive elevation gain (m) from GPX geometry — track points
 *  (<trkpt>) when present, else route points (<rtept>). A 1 m threshold on the
 *  elevation deltas trims GPS jitter that would inflate gain. */
function computeGpx(xml) {
  let pts = extractPoints(xml, 'trkpt');
  if (pts.length < 2) pts = extractPoints(xml, 'rtept');
  let dist = 0, gain = 0, prev = null, prevEle = null;
  for (const p of pts) {
    if (prev) dist += haversine(prev, p);
    if (p.ele != null) {
      if (prevEle != null && p.ele - prevEle > 1) gain += p.ele - prevEle;
      if (prevEle == null || Math.abs(p.ele - prevEle) > 1) prevEle = p.ele;
    }
    prev = p;
  }
  return { distanceKm: Math.round((dist / 1000) * 100) / 100, elevationM: Math.round(gain), points: pts.length };
}

async function main() {
  console.log(`Manifest: ${MANIFEST_URL}`);
  const manifest = await (await fetch(MANIFEST_URL)).json();
  const routes = manifest.groups.flatMap((g) => g.maps); // manifest order = studio color order
  console.log(`${routes.length} routes\n`);

  const token = (await api('/admin/login', { method: 'POST', body: { email: ssm(SSM_EMAIL), password: ssm(SSM_PASSWORD) } }))?.data?.token;
  if (!token) throw new Error('admin login failed');

  let updated = 0, skipped = 0;
  for (let i = 0; i < routes.length; i++) {
    const r = routes[i];
    const gpxFileId = r.fileId;
    const mapColor = paletteColor(i);
    let stats = { distanceKm: undefined, elevationM: undefined, points: 0 };
    try {
      stats = computeGpx(await (await fetch(r.downloadUrl)).text());
    } catch (e) {
      console.log(`  ! ${gpxFileId}: GPX fetch/parse failed (${e.message}) — color only`);
    }

    const found = await api(`${CT}?filters[gpxFileId][$eq]=${encodeURIComponent(gpxFileId)}&pageSize=1`, { token });
    const existing = found.results?.[0];
    if (!existing) { console.log(`  - ${gpxFileId}: no CMS route, skipped`); skipped++; continue; }

    const patch = { mapColor };
    if (stats.points > 1) { patch.distance = stats.distanceKm; patch.elevationGain = stats.elevationM; }
    await api(`${CT}/${existing.documentId}`, { method: 'PUT', token, body: patch });
    await api(`${CT}/${existing.documentId}/actions/publish`, { method: 'POST', token });
    console.log(`  ~ ${r.fileName.padEnd(18)} color=${mapColor}  dist=${stats.distanceKm ?? '—'}km  gain=${stats.elevationM ?? '—'}m  (${stats.points} pts)`);
    updated++;
  }
  console.log(`\nDone: ${updated} enriched, ${skipped} skipped. Workers sync in ~5 min.`);
}

main().catch((e) => { console.error('\nenrich-routes failed:', e.message); process.exit(1); });
