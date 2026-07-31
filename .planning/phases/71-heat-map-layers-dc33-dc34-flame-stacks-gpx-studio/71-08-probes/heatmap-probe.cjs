#!/usr/bin/env node
/**
 * Phase 71 / HEAT-06 — production probe for the DC33 + DC34 heat-map layers.
 *
 * Thirteen assertions against the LIVE gpx.defcon.run deployment: the two public
 * artifact routes and their CDN headers, the year allowlist, the cheap `?meta=1`
 * projection, NON-ATTRIBUTABILITY of the bytes production actually serves (both
 * years, via the 71-04 verifier rather than a reimplementation), artifact freshness,
 * the internal build route's unreachability from the public host, the HEAT MAP
 * section's DOM, both flame stacks rendering SIMULTANEOUSLY (D-12 — the emotional
 * core of the feature), default-off + lazy-load measured from the network log, and
 * the two EventBridge schedules 71-07 planned.
 *
 * The denominator is a FIXED LITERAL. The ship gate must never become reachable by
 * shrinking what is asserted (T-71-37). There is no skip() helper in this file at
 * all: assertions 6, 11 and 13 in particular fail CLOSED — a summary that cannot be
 * parsed, a map object or layer id that cannot be resolved, or a scheduler that
 * cannot be read all score FAIL, never a vacuous pass. The Phase 70 retrospective
 * recorded two assertions that did not fail closed; this file does not repeat that.
 *
 * The same script produces both the pre-deploy and the post-deploy transcript. The
 * CONTRAST is the evidence (T-71-38): a pre-deploy run that already passes would
 * mean the probe is not testing what it claims to.
 *
 * Usage — the caller supplies the public mapbox token from SSM. The decryption flag
 * is load-bearing: without it the value is KMS ciphertext, mapbox never fires its
 * load event, and every DOM assertion times out.
 *
 *   MAPBOX_TOKEN=$(aws ssm get-parameter \
 *     --name /dc34/secrets/use1/mapbox/public_token --with-decryption \
 *     --query Parameter.Value --output text \
 *     --profile dc34-application --region us-east-1) \
 *   node heatmap-probe.cjs > transcript-post-deploy.txt 2>&1
 *
 * Optional: PROBE_NOTES — newline-separated extra header lines (the released version,
 * the deploy.yml run URL, the terragrunt-apply.yml run URL). Header-only; it cannot
 * change what is asserted, which is what lets one byte-identical script serve both runs.
 *
 * The token is never printed and never written to disk (T-71-40).
 */

const path = require('path');
const fs = require('fs');
const https = require('https');
const { execFileSync, execSync } = require('child_process');
const { chromium } = require('/Users/khundeck/working/defcon.run.34/apps/run.auth/e2e/node_modules/playwright-core');

const TOTAL = 13;

const HOST = 'https://gpx.defcon.run';
const TARGET = `${HOST}/use1/studio/app`;
const HEAT_BASE = `${HOST}/use1/api/gpx/public/heatmap`;
const INTERNAL_BUILD = `${HOST}/use1/api/gpx/internal/heatmap-build`;

const OUT_DIR = __dirname;
// 71-08-probes → 71-heat-map-… → phases → .planning → repo root.
const REPO = path.resolve(OUT_DIR, '..', '..', '..', '..');
// The 71-04 artifact verifier. Assertion 5 SHELLS OUT to it against the live URLs
// rather than reimplementing the attribution sweep — that file self-tests against
// doctored fixtures, so it cannot pass vacuously.
const VERIFIER = path.join(REPO, 'apps/run.gpx/webapp/scripts/verify-heatmap-artifact.mjs');
const SUMMARY_04 = path.join(OUT_DIR, '..', '71-04-SUMMARY.md');

// The one place this literal appears. Everything else references the constant.
const DC33_GENERATED_AT = '2025-08-15T02:41:54.347Z';
// Kurt-locked flame colours (D-02), read from 71-05's HEAT_PAINT.
const HEAT_COLOR = { dc33: '#ff8c00', dc34: '#ff0000' };
const HEAT_LAYER = { dc33: 'heatmap-dc33', dc34: 'heatmap-dc34' };
const META_KEYS = ['year', 'generatedAt', 'runCount', 'totalKm'];
const META_MAX_BYTES = 500;
const FRESH_HOURS = 26;

// 71-07's planned schedules. The module sets no group_name, so both land in `default`.
const SCHED_TZ = 'America/Los_Angeles';
const SCHEDULES = [
    { name: 'heatmap-build-use1-hourly', expr: 'cron(0 * 5-10 8 ? 2026)' },
    { name: 'heatmap-build-use1-daily', expr: 'cron(0 4 * * ? *)' },
];
const AWS_ARGS = ['--profile', 'dc34-application', '--region', 'us-east-1'];

const EXECUTABLE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
// Las Vegas — where the flames are. The probe parks the camera here before the
// screenshots so the visual record shows the stacks rather than an empty ocean.
const VEGAS = { center: [-115.17, 36.12], zoom: 10.5 };
// Public mapbox tokens carry a fixed prefix. Spelled as a pattern rather than a
// literal so the artifact directory can be swept for a leaked token by plain grep.
const TOKEN_PREFIX = /^pk\./;

const token = process.env.MAPBOX_TOKEN || '';
if (!token) {
    console.log('ERROR: the mapbox token env var is unset. Read it from SSM (see this file header).');
    process.exit(2);
}
if (!TOKEN_PREFIX.test(token)) {
    console.log('ERROR: the mapbox token has the wrong prefix — it looks like KMS ciphertext.');
    console.log('       The SSM read must pass the decryption flag documented above.');
    process.exit(2);
}

let passed = 0;
function pass(n, label, note) {
    passed++;
    console.log(`PASS  ${n}. ${label}${note ? ` — ${note}` : ''}`);
}
function bad(n, label, note) {
    console.log(`FAIL  ${n}. ${label}${note ? ` — ${note}` : ''}`);
}
function info(text) {
    console.log(`      ${text}`);
}
function oneLine(e) {
    return String((e && e.message) || e).split('\n')[0];
}

/** GET, reading the body to completion. A truncated read here would manufacture a
 * phantom failure (or, worse, a phantom pass on a length check). */
function httpGet(url) {
    return new Promise((resolve, reject) => {
        https
            .get(url, { headers: { accept: 'application/json' } }, (res) => {
                let body = '';
                res.setEncoding('utf8');
                res.on('data', (c) => (body += c));
                res.on('end', () =>
                    resolve({ status: res.statusCode, headers: res.headers, body })
                );
            })
            .on('error', reject);
    });
}

function httpPost(url) {
    return new Promise((resolve, reject) => {
        const req = https.request(url, { method: 'POST' }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (c) => (body += c));
            res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', reject);
        req.end();
    });
}

function sha() {
    try {
        return execSync('git rev-parse --short HEAD', { cwd: OUT_DIR }).toString().trim();
    } catch {
        return 'unknown';
    }
}

/** Assertion 6's parse. Throws on anything ambiguous — a broken handoff must score
 * red, not quietly waive the only check tying the served DC33 bytes to what 71-04
 * verified locally. */
function dc33RunCountFromSummary() {
    if (!fs.existsSync(SUMMARY_04)) {
        throw new Error(`71-04-SUMMARY.md not found at ${SUMMARY_04}`);
    }
    const text = fs.readFileSync(SUMMARY_04, 'utf8');
    const hits = [...text.matchAll(/^HEATMAP_DC33_RUNCOUNT=(\d+)$/gm)].map((m) => m[1]);
    if (hits.length === 0) throw new Error('no HEATMAP_DC33_RUNCOUNT= line in 71-04-SUMMARY.md');
    const distinct = [...new Set(hits)];
    if (distinct.length > 1) {
        throw new Error(`HEATMAP_DC33_RUNCOUNT= appears ${hits.length}x with differing values: ${distinct.join(', ')}`);
    }
    const n = Number(distinct[0]);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`parsed runCount "${distinct[0]}" is not a positive integer`);
    return n;
}

// The session shape the studio needs to render the layer control at all.
const SESSION = {
    user: {
        id: 'probe-user',
        email: 'probe@defcon.run',
        name: 'Probe Runner',
        services: ['gpxstudio'],
        hasStrava: false,
    },
};

/** Route stubs, verbatim from the Phase 70 probe's convention: broad catch-alls are
 * registered FIRST so the narrow handlers registered after them win. The heat-map
 * routes fall under `api/gpx/public/**`, which continues to the real network — the
 * whole point is to assert against what production serves. */
async function installRoutes(page) {
    await page.route('**/use1/api/gpx/**', (r) =>
        r.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    );
    await page.route('**/use1/api/user/**', (r) =>
        r.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    );
    await page.route('**/use1/api/auth/**', (r) =>
        r.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    );
    await page.route('**/use1/api/gpx/public/**', (r) => r.continue());
    await page.route('**/use1/api/user/mapbox-token*', (r) =>
        r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token }) })
    );
    await page.route('**/use1/api/auth/session*', (r) =>
        r.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ...SESSION, expires: new Date(Date.now() + 3600_000).toISOString() }),
        })
    );
    await page.route('**/use1/api/gpx/files*', (r) =>
        r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ files: [] }) })
    );
    await page.route('**/use1/api/gpx/folders*', (r) =>
        r.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ folders: [], globalFolders: [] }),
        })
    );
}

async function openStudio(browser, { record = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const requests = [];
    if (record) page.on('request', (r) => requests.push(r.url()));
    await installRoutes(page);
    const response = await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(() => !!window._map, null, { timeout: 90_000 });
    // Terrain on a software rasteriser is the usual hang.
    await page.evaluate(() => window._map.setTerrain(null));
    return { ctx, page, requests, response };
}

async function openLayersDialog(page) {
    await page.waitForSelector('[data-dc34-layers-btn]', { timeout: 45_000 });
    if ((await page.locator('[data-dc34-dialog="layers"]').count()) === 0) {
        await page.click('[data-dc34-layers-btn]');
    }
    await page.locator('[data-dc34-dialog="layers"]').waitFor({ state: 'visible', timeout: 15_000 });
    // Sections stream in as their data resolves, so give the HEAT MAP one a real
    // window to appear before reading. The catch is deliberate and does NOT soften
    // anything: on timeout the read below simply finds no section and every
    // assertion that needs one scores FAIL. This wait removes a render race, not a
    // failure mode.
    await page
        .waitForFunction(
            () =>
                [...document.querySelectorAll('[data-dc34-dialog="layers"] [data-section-label]')].some(
                    (e) => /^heat map$/i.test(e.textContent.trim())
                ),
            null,
            { timeout: 20_000 }
        )
        .catch(() => {});
    await page.waitForTimeout(2500);
}

/** Read the HEAT MAP section out of the open dialog. Returns `null` when no section
 * carries that label — which is a FAIL for every assertion that needs it, never a skip. */
function readHeatSection(page) {
    return page.evaluate(() => {
        const dlg = document.querySelector('[data-dc34-dialog="layers"]');
        if (!dlg) return { dialog: false };
        const sections = [...dlg.querySelectorAll('[data-section]')];
        const labels = sections.map((s) => {
            const b = s.querySelector('[data-section-label]');
            return b ? b.textContent.trim() : '';
        });
        const idx = labels.findIndex((t) => /^heat map$/i.test(t));
        if (idx === -1) return { dialog: true, found: false, labels };
        const sec = sections[idx];
        const header = sec.querySelector('[data-section-label]').parentElement;
        const spans = [...header.querySelectorAll('span')]
            .map((s) => s.textContent.trim())
            .filter((t) => t.length > 0);
        const rows = [...sec.querySelectorAll('[data-layer-row]')].map((r) => ({
            text: r.textContent.trim(),
            hint: r.getAttribute('data-hint') || '',
        }));
        return { dialog: true, found: true, labels, index: idx, stamp: spans[spans.length - 1] || '', rows };
    });
}

async function main() {
    console.log('='.repeat(78));
    console.log('Phase 71 HEAT-06 — DC33/DC34 heat-map production probe');
    console.log('='.repeat(78));
    console.log(`timestamp   : ${new Date().toISOString()}`);
    console.log(`git sha     : ${sha()}`);
    console.log(`target      : ${TARGET}`);
    console.log(`heat base   : ${HEAT_BASE}`);
    if (process.env.PROBE_NOTES) {
        for (const line of process.env.PROBE_NOTES.split('\n')) console.log(line);
    }
    console.log('-'.repeat(78));

    // ================= HTTP assertions (no browser) =========================

    // ---- 1 / 2. the two public artifact routes -----------------------------
    const artifact = {};
    for (const [n, year] of [[1, 'dc34'], [2, 'dc33']]) {
        const L = `GET /api/gpx/public/heatmap/${year} is 200 JSON with an s-maxage CDN header`;
        try {
            const res = await httpGet(`${HEAT_BASE}/${year}`);
            artifact[year] = res;
            const ct = res.headers['content-type'] || '';
            const cc = res.headers['cache-control'] || '';
            const problems = [];
            if (res.status !== 200) problems.push(`status ${res.status}`);
            if (!/json/i.test(ct)) problems.push(`content-type "${ct}"`);
            if (!cc.includes('s-maxage=')) problems.push(`cache-control "${cc || '(absent)'}"`);
            const note = `status=${res.status} content-type="${ct}" cache-control="${cc}" bytes=${res.body.length}`;
            if (problems.length) bad(n, L, `${problems.join('; ')} — ${note}`);
            else pass(n, L, note);
        } catch (e) {
            bad(n, L, oneLine(e));
        }
    }

    // ---- 3. the year allowlist holds in production -------------------------
    {
        const L = 'GET /api/gpx/public/heatmap/dc32 is 404 (year allowlist holds)';
        try {
            const res = await httpGet(`${HEAT_BASE}/dc32`);
            if (res.status === 404) pass(3, L, 'status=404');
            else bad(3, L, `status=${res.status}`);
        } catch (e) {
            bad(3, L, oneLine(e));
        }
    }

    // ---- 4. the cheap meta projection really is cheap ----------------------
    const meta = {};
    for (const year of ['dc33', 'dc34']) {
        try {
            const res = await httpGet(`${HEAT_BASE}/${year}?meta=1`);
            meta[year] = res;
        } catch (e) {
            meta[year] = { status: 0, body: '', error: oneLine(e) };
        }
    }
    {
        const L = '?meta=1 on dc34 returns only the bare meta block, under 500 bytes';
        try {
            const res = meta.dc34;
            const problems = [];
            if (res.status !== 200) problems.push(`status ${res.status}${res.error ? ` (${res.error})` : ''}`);
            let keys = [];
            if (res.status === 200) {
                let doc;
                try {
                    doc = JSON.parse(res.body);
                } catch (e) {
                    problems.push(`body is not JSON: ${oneLine(e)}`);
                }
                if (doc && (typeof doc !== 'object' || Array.isArray(doc))) problems.push('body is not an object');
                else if (doc) {
                    keys = Object.keys(doc).sort();
                    const want = [...META_KEYS].sort();
                    if (keys.length !== want.length || keys.some((k, i) => k !== want[i])) {
                        problems.push(`keys are [${keys.join(', ')}], expected [${want.join(', ')}]`);
                    }
                }
                if (res.body.length >= META_MAX_BYTES) {
                    problems.push(`${res.body.length} bytes, expected < ${META_MAX_BYTES}`);
                }
            }
            const note = `status=${res.status} bytes=${res.body.length} keys=[${keys.join(', ')}]`;
            if (problems.length) bad(4, L, `${problems.join('; ')} — ${note}`);
            else pass(4, L, note);
        } catch (e) {
            bad(4, L, oneLine(e));
        }
    }

    // ---- 5. NON-ATTRIBUTABILITY of the live bytes, both years --------------
    // The phase's central control (T-71-34). Never soften this: it runs
    // verify-heatmap-artifact.mjs against what production serves, not a local file.
    {
        const L = 'Live bytes are non-attributable for BOTH years (verify-heatmap-artifact.mjs, exit 0)';
        const results = [];
        for (const year of ['dc33', 'dc34']) {
            const url = `${HEAT_BASE}/${year}`;
            try {
                const out = execFileSync('node', [VERIFIER, url], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
                const last = out.trim().split('\n').pop();
                results.push({ year, ok: true, detail: last });
            } catch (e) {
                const detail = [e.stdout, e.stderr].filter(Boolean).join(' ').trim().split('\n').pop() || oneLine(e);
                results.push({ year, ok: false, detail });
            }
        }
        for (const r of results) info(`verifier ${r.year}: ${r.ok ? 'exit 0' : 'NON-ZERO EXIT'} — ${r.detail}`);
        const failed = results.filter((r) => !r.ok);
        if (failed.length === 0) pass(5, L, 'dc33 exit 0, dc34 exit 0');
        else bad(5, L, `${failed.map((r) => `${r.year}: ${r.detail}`).join(' | ')}`);
    }

    // ---- 6. served DC33 matches what 71-04 built (FAILS CLOSED) ------------
    {
        const L = 'Served dc33 meta matches 71-04 (generatedAt exact, runCount from the summary)';
        let parsedRunCount = null;
        let parseError = null;
        try {
            parsedRunCount = dc33RunCountFromSummary();
        } catch (e) {
            parseError = oneLine(e);
        }
        info(`71-04-SUMMARY.md HEATMAP_DC33_RUNCOUNT parsed as: ${parsedRunCount === null ? `UNPARSEABLE (${parseError})` : parsedRunCount}`);
        let liveGen = null;
        let liveCount = null;
        try {
            if (meta.dc33 && meta.dc33.status === 200) {
                const doc = JSON.parse(meta.dc33.body);
                liveGen = doc.generatedAt;
                liveCount = doc.runCount;
            }
        } catch (e) {
            parseError = parseError || `live meta unreadable: ${oneLine(e)}`;
        }
        info(`live dc33 meta: generatedAt=${liveGen} runCount=${liveCount} (HTTP ${meta.dc33 ? meta.dc33.status : 'n/a'})`);
        const problems = [];
        if (parsedRunCount === null) problems.push(`summary unparseable: ${parseError}`);
        if (!meta.dc33 || meta.dc33.status !== 200) problems.push(`live ?meta=1 for dc33 returned ${meta.dc33 ? meta.dc33.status : 'n/a'}`);
        if (liveGen !== DC33_GENERATED_AT) problems.push(`generatedAt is "${liveGen}", expected "${DC33_GENERATED_AT}"`);
        if (parsedRunCount !== null && liveCount !== parsedRunCount) {
            problems.push(`runCount is ${liveCount}, summary says ${parsedRunCount}`);
        }
        if (problems.length) bad(6, L, problems.join('; '));
        else pass(6, L, `generatedAt=${liveGen} runCount=${liveCount} (== summary ${parsedRunCount})`);
    }

    // ---- 7. dc34 was produced by the SCHEDULED path, recently --------------
    // SCOPE, recorded honestly: 26 hours is satisfied by the daily 04:00 PT baseline
    // ALONE. This proves the scheduled path produced the artifact. It does NOT prove
    // the hourly con-window cadence, which cannot fire before 5 August 2026 — that
    // half is closed as far as it can be closed today by assertion 13 (the schedule
    // exists, is ENABLED, and carries the exact expression and timezone). Do not read
    // this assertion as evidence the hourly cadence was observed.
    {
        const L = `dc34 meta.generatedAt is a valid instant within the last ${FRESH_HOURS}h`;
        try {
            if (!meta.dc34 || meta.dc34.status !== 200) {
                bad(7, L, `?meta=1 for dc34 returned ${meta.dc34 ? meta.dc34.status : 'n/a'}`);
            } else {
                const doc = JSON.parse(meta.dc34.body);
                const t = Date.parse(doc.generatedAt);
                if (!Number.isFinite(t)) bad(7, L, `generatedAt "${doc.generatedAt}" does not parse`);
                else {
                    const ageH = (Date.now() - t) / 3_600_000;
                    const note = `generatedAt=${doc.generatedAt} age=${ageH.toFixed(2)}h runCount=${doc.runCount} totalKm=${doc.totalKm}`;
                    if (ageH < 0) bad(7, L, `generatedAt is in the future — ${note}`);
                    else if (ageH > FRESH_HOURS) bad(7, L, `stale — ${note}`);
                    else pass(7, L, note);
                }
            }
        } catch (e) {
            bad(7, L, oneLine(e));
        }
    }

    // ---- 8. the internal build route is not publicly triggerable -----------
    {
        const L = 'Unauthenticated POST to /api/gpx/internal/heatmap-build is non-2xx';
        try {
            const res = await httpPost(INTERNAL_BUILD);
            const note = `status=${res.status}`;
            if (res.status >= 200 && res.status < 300) bad(8, L, `PUBLICLY TRIGGERABLE — ${note}`);
            else pass(8, L, note);
        } catch (e) {
            bad(8, L, oneLine(e));
        }
    }

    // ---- 13. the DC34 schedules are real, enabled, and say what 71-07 planned
    // Fail closed: a non-zero CLI exit, a ResourceNotFoundException, an expired SSO
    // session or any mismatched field scores FAIL. A probe that cannot see the
    // schedule has not proven the schedule.
    {
        const L = 'Both DC34 schedules exist, are ENABLED, and carry 71-07\'s exact expression + timezone';
        const problems = [];
        for (const s of SCHEDULES) {
            let doc = null;
            try {
                const out = execFileSync(
                    'aws',
                    ['scheduler', 'get-schedule', '--name', s.name, '--group-name', 'default', ...AWS_ARGS],
                    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
                );
                doc = JSON.parse(out);
            } catch (e) {
                const detail = [e.stderr, e.stdout].filter(Boolean).join(' ').trim().split('\n')[0] || oneLine(e);
                info(`schedule ${s.name}: UNREADABLE — ${detail}`);
                problems.push(`${s.name}: ${detail}`);
                continue;
            }
            info(`schedule ${s.name}: State=${doc.State} ScheduleExpression=${doc.ScheduleExpression} ScheduleExpressionTimezone=${doc.ScheduleExpressionTimezone}`);
            if (doc.State !== 'ENABLED') problems.push(`${s.name}: State=${doc.State}`);
            if (doc.ScheduleExpression !== s.expr) {
                problems.push(`${s.name}: ScheduleExpression="${doc.ScheduleExpression}", expected "${s.expr}"`);
            }
            if (doc.ScheduleExpressionTimezone !== SCHED_TZ) {
                problems.push(`${s.name}: timezone="${doc.ScheduleExpressionTimezone}", expected "${SCHED_TZ}"`);
            }
        }
        if (problems.length) bad(13, L, problems.join('; '));
        else pass(13, L, `both ENABLED in ${SCHED_TZ}; hourly=${SCHEDULES[0].expr}, daily=${SCHEDULES[1].expr}`);
    }

    // ================= browser assertions ===================================

    const browser = await chromium.launch({
        executablePath: EXECUTABLE,
        args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
    });

    try {
        // ---- 9 / 10 / 11: the section, its stamp+hint, and both stacks at once
        let page = null;
        let ctx = null;
        let section = null;
        try {
            ({ ctx, page } = await openStudio(browser));
            await openLayersDialog(page);
            section = await readHeatSection(page);
        } catch (e) {
            info(`studio setup failed: ${oneLine(e)}`);
        }

        // ---- 9. the HEAT MAP section and its two flame rows -----------------
        {
            const L = 'Map Layers has a "Heat Map" section with exactly two rows labelled DC34 and DC33';
            if (!section || !section.dialog) {
                bad(9, L, 'the layers dialog never rendered');
            } else if (!section.found) {
                bad(9, L, `no section labelled "Heat Map" — sections present: [${(section.labels || []).join(' | ')}]`);
            } else {
                const texts = section.rows.map((r) => r.text);
                const problems = [];
                if (section.rows.length !== 2) problems.push(`${section.rows.length} row(s), expected 2`);
                if (!texts.some((t) => /DC34/.test(t))) problems.push('no row label contains DC34');
                if (!texts.some((t) => /DC33/.test(t))) problems.push('no row label contains DC33');
                const note = `section #${section.index + 1} of ${section.labels.length}; rows [${texts.join(' | ')}]`;
                if (problems.length) bad(9, L, `${problems.join('; ')} — ${note}`);
                else pass(9, L, note);
            }
        }

        // ---- 10. the "last calculated" stamp and the hint bar ---------------
        {
            const L = 'Section header carries a relative stamp and hovering DC34 fills the hint bar';
            try {
                if (!section || !section.found) {
                    bad(10, L, 'the Heat Map section does not exist');
                } else {
                    const stamp = section.stamp || '';
                    const dc34Row = page.locator('[data-dc34-dialog="layers"] [data-layer-row]', { hasText: 'DC34' }).first();
                    let hint = '';
                    if ((await dc34Row.count()) > 0) {
                        await dc34Row.hover();
                        await page.waitForTimeout(500);
                        hint = (await page.locator('[data-dc34-dialog="layers"] [data-hint-out]').textContent()).trim();
                    }
                    info(`stamp="${stamp}" hint="${hint}"`);
                    const problems = [];
                    if (!stamp || stamp === '—') problems.push(`stamp is "${stamp || '(empty)'}"`);
                    if (!/runs/.test(hint)) problems.push(`hint has no "runs": "${hint}"`);
                    if (!/\b\d{4}\b/.test(hint)) problems.push(`hint has no four-digit year: "${hint}"`);
                    if (problems.length) bad(10, L, problems.join('; '));
                    else pass(10, L, `stamp="${stamp}" hint="${hint}"`);
                }
            } catch (e) {
                bad(10, L, oneLine(e));
            }
        }

        // ---- 11. BOTH flame stacks visible simultaneously (D-12) ------------
        {
            const L = 'Both heat layers render simultaneously with their locked colours (D-12)';
            try {
                if (!section || !section.found || section.rows.length !== 2) {
                    bad(11, L, 'the Heat Map section with two rows does not exist');
                } else {
                    const rowFor = (y) =>
                        page.locator('[data-dc34-dialog="layers"] [data-layer-row]', { hasText: y.toUpperCase() }).first();
                    const setRow = async (y, want) => {
                        const cb = rowFor(y).locator('input[type="checkbox"]');
                        if ((await cb.isChecked()) !== want) await cb.click();
                        await page.waitForTimeout(250);
                    };
                    const parkAndShoot = async (name) => {
                        await page.keyboard.press('Escape');
                        await page.waitForTimeout(400);
                        await page.evaluate((v) => window._map.jumpTo({ center: v.center, zoom: v.zoom, bearing: 0, pitch: 0 }), VEGAS);
                        await page.waitForTimeout(2500);
                        await page.screenshot({ path: path.join(OUT_DIR, name), fullPage: false }).catch(() => {});
                        await openLayersDialog(page);
                    };

                    // DC34 only
                    await setRow('dc34', true);
                    await page.waitForFunction((id) => !!window._map.getLayer(id), HEAT_LAYER.dc34, { timeout: 90_000 }).catch(() => {});
                    await parkAndShoot('shot-dc34-only.png');

                    // DC33 only
                    await setRow('dc34', false);
                    await setRow('dc33', true);
                    await page.waitForFunction((id) => !!window._map.getLayer(id), HEAT_LAYER.dc33, { timeout: 90_000 }).catch(() => {});
                    await parkAndShoot('shot-dc33-only.png');

                    // Both — the shot Kurt asked for.
                    await setRow('dc34', true);
                    await page.waitForTimeout(1500);
                    await parkAndShoot('shot-both-layers.png');

                    const seen = await page.evaluate((a) => {
                        const m = window._map;
                        if (!m) return { map: false };
                        const read = (id) => {
                            const layer = m.getLayer(id);
                            const src = m.getSource(id);
                            let features = null;
                            if (src) {
                                try {
                                    const ser = typeof src.serialize === 'function' ? src.serialize() : null;
                                    const d = (ser && ser.data) || src._data;
                                    features = d && Array.isArray(d.features) ? d.features.length : -1;
                                } catch {
                                    features = -1;
                                }
                            }
                            return {
                                layer: !!layer,
                                source: !!src,
                                features,
                                visibility: layer ? m.getLayoutProperty(id, 'visibility') || 'visible' : null,
                                color: layer ? m.getPaintProperty(id, 'line-color') : null,
                            };
                        };
                        return { map: true, dc33: read(a.dc33), dc34: read(a.dc34) };
                    }, HEAT_LAYER);

                    if (!seen.map) {
                        bad(11, L, 'window._map is not resolvable');
                    } else {
                        const problems = [];
                        for (const y of ['dc33', 'dc34']) {
                            const s = seen[y];
                            info(`${y}: layer=${s.layer} source=${s.source} features=${s.features} visibility=${s.visibility} line-color=${s.color}`);
                            if (!s.layer) problems.push(`${y} layer ${HEAT_LAYER[y]} absent`);
                            if (!s.source) problems.push(`${y} source ${HEAT_LAYER[y]} absent`);
                            if (!(typeof s.features === 'number' && s.features > 0)) problems.push(`${y} feature count is ${s.features}`);
                            if (s.visibility !== 'visible') problems.push(`${y} visibility=${s.visibility}`);
                            if (String(s.color).toLowerCase() !== HEAT_COLOR[y]) {
                                problems.push(`${y} line-color=${s.color}, expected ${HEAT_COLOR[y]}`);
                            }
                        }
                        const note =
                            `dc34 ${seen.dc34.features} features @ ${seen.dc34.color}, ` +
                            `dc33 ${seen.dc33.features} features @ ${seen.dc33.color}, both visible`;
                        if (problems.length) bad(11, L, problems.join('; '));
                        else pass(11, L, note);
                    }
                }
            } catch (e) {
                bad(11, L, oneLine(e));
            }
        }
        if (ctx) await ctx.close().catch(() => {});

        // ---- 12. default-off + lazy-load, MEASURED from the network log -----
        {
            const L = 'Heat layers are off by default and fetch no geometry until toggled (SC-4)';
            let ctx2 = null;
            try {
                const opened = await openStudio(browser, { record: true });
                ctx2 = opened.ctx;
                const page2 = opened.page;
                const requests = opened.requests;
                // Let map load settle so loadMeta's two probes have certainly fired.
                await page2.waitForTimeout(6000);

                const isHeat = (u) => u.includes('/api/gpx/public/heatmap/');
                const isMeta = (u) => isHeat(u) && /[?&]meta=1/.test(u);
                const isBare = (u) => isHeat(u) && !/[?&]meta=/.test(u);
                const metaBefore = requests.filter(isMeta);
                const bareBefore = requests.filter(isBare);

                const onMap = await page2.evaluate((a) => {
                    const m = window._map;
                    if (!m) return { map: false };
                    return {
                        map: true,
                        dc33: { layer: !!m.getLayer(a.dc33), source: !!m.getSource(a.dc33) },
                        dc34: { layer: !!m.getLayer(a.dc34), source: !!m.getSource(a.dc34) },
                    };
                }, HEAT_LAYER);

                info(`before toggle: meta requests=${metaBefore.length} [${metaBefore.map((u) => u.split('/').pop()).join(', ')}] bare requests=${bareBefore.length}`);
                info(`before toggle on map: dc33=${JSON.stringify(onMap.dc33)} dc34=${JSON.stringify(onMap.dc34)}`);

                const problems = [];
                if (!onMap.map) problems.push('window._map is not resolvable');
                else {
                    for (const y of ['dc33', 'dc34']) {
                        if (onMap[y].layer) problems.push(`${y} layer exists before any toggle`);
                        if (onMap[y].source) problems.push(`${y} source exists before any toggle`);
                    }
                }
                if (!metaBefore.some((u) => u.includes('dc33'))) problems.push('no ?meta=1 request for dc33');
                if (!metaBefore.some((u) => u.includes('dc34'))) problems.push('no ?meta=1 request for dc34');
                if (bareBefore.length !== 0) problems.push(`${bareBefore.length} bare artifact request(s) before any toggle`);

                // Now toggle DC34 on and require exactly one bare fetch for it.
                let afterNote = 'not reached';
                try {
                    await openLayersDialog(page2);
                    const cb = page2
                        .locator('[data-dc34-dialog="layers"] [data-layer-row]', { hasText: 'DC34' })
                        .first()
                        .locator('input[type="checkbox"]');
                    if ((await cb.count()) === 0) {
                        problems.push('no DC34 row to toggle');
                    } else {
                        await cb.click();
                        await page2
                            .waitForFunction((id) => !!window._map.getLayer(id), HEAT_LAYER.dc34, { timeout: 90_000 })
                            .catch(() => {});
                        await page2.waitForTimeout(1500);
                        const bareAfter = requests.filter((u) => isBare(u) && u.includes('dc34'));
                        const bare33After = requests.filter((u) => isBare(u) && u.includes('dc33'));
                        afterNote = `dc34 bare fetches=${bareAfter.length}, dc33 bare fetches=${bare33After.length}`;
                        info(`after toggling DC34 on: ${afterNote}`);
                        if (bareAfter.length !== 1) problems.push(`dc34 artifact fetched ${bareAfter.length}x after toggle, expected exactly 1`);
                        if (bare33After.length !== 0) problems.push(`dc33 artifact fetched ${bare33After.length}x though it was never toggled`);
                    }
                } catch (e) {
                    problems.push(`toggle step: ${oneLine(e)}`);
                }

                const note = `meta=${metaBefore.length}, bare-before=${bareBefore.length}, ${afterNote}`;
                if (problems.length) bad(12, L, `${problems.join('; ')} — ${note}`);
                else pass(12, L, note);
            } catch (e) {
                bad(12, L, oneLine(e));
            } finally {
                if (ctx2) await ctx2.close().catch(() => {});
            }
        }
    } finally {
        await browser.close();
    }

    console.log('-'.repeat(78));
    console.log(`RESULT: ${passed}/${TOTAL} assertions passed`);
    if (passed !== TOTAL) process.exitCode = 1;
}

main().catch((e) => {
    console.log(`ERROR: probe aborted — ${oneLine(e)}`);
    console.log('-'.repeat(78));
    console.log(`RESULT: ${passed}/${TOTAL} assertions passed`);
    process.exitCode = 1;
});
