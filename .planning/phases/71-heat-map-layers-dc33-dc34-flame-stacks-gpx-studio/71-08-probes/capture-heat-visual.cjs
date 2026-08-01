#!/usr/bin/env node
/**
 * Phase 71 / 71-08 — VISUAL CAPTURE ONLY. Not a probe, asserts nothing, gates nothing.
 *
 * Why this file exists, recorded plainly: the three screenshots taken by
 * `heatmap-probe.cjs` are a poor record of D-12. They were shot at zoom 10.5 with the
 * studio's default-ON public layer groups (DEF CON 34 Routes, Rabbit Routes, User
 * Check-ins) drawn over the same few blocks, so `shot-both-layers.png` and
 * `shot-dc33-only.png` came out visually indistinguishable and neither demonstrates a
 * flame stack. That is a CAPTURE-METHOD gap, separate from the data gap (DC34 has no
 * runs until the con). This script fixes the capture-method half only.
 *
 * It does three things the probe does not:
 *   1. Turns the other sections' master checkboxes OFF, so nothing but the basemap and
 *      the heat layers is drawn.
 *   2. Parks the camera on the measured density hotspot rather than a guessed centre.
 *      The hotspot is derived from the LIVE artifact, not hardcoded by eye: a 0.005°
 *      grid over all 20 001 coordinates peaks at -115.1650,36.1250 with 1 334 points,
 *      and 40 of the 110 runs pass through that one cell.
 *   3. Shoots at two zooms — corridor context and individual-line detail — because
 *      "overlap is heat" is only judgeable when single translucent strokes are resolvable.
 *
 * It CANNOT fix the data gap. DC34 has zero runs (0 of 133 items carry a conDay;
 * DEF CON 34 is 2026-08-05..10), so no camera or layer state makes DC34 draw anything.
 * No synthetic data is injected here and the DC34 row is not hidden — Kurt declined both.
 *
 *   MAPBOX_TOKEN=$(aws ssm get-parameter \
 *     --name /dc34/secrets/use1/mapbox/public_token --with-decryption \
 *     --query Parameter.Value --output text \
 *     --profile dc34-application --region us-east-1) \
 *   node capture-heat-visual.cjs
 *
 * The token is never printed and never written to disk.
 */

const path = require('path');
const { chromium } = require('/Users/khundeck/working/defcon.run.34/apps/run.auth/e2e/node_modules/playwright-core');

const TARGET = 'https://gpx.defcon.run/use1/studio/app';
const OUT_DIR = __dirname;
const EXECUTABLE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell`;

// Measured from the live dc33 artifact (see header), not chosen by eye.
const HOTSPOT = [-115.163, 36.127];
const SHOTS = [
    { name: 'shot-dc33-strip-context.png', zoom: 12.6, what: 'corridor context' },
    { name: 'shot-dc33-strip-detail.png', zoom: 14.2, what: 'individual-line detail' },
];

const TOKEN_PREFIX = /^pk\./;
const token = process.env.MAPBOX_TOKEN || '';
if (!token || !TOKEN_PREFIX.test(token)) {
    console.log('ERROR: the mapbox token env var is unset or looks like KMS ciphertext.');
    console.log('       The SSM read must pass the decryption flag documented above.');
    process.exit(2);
}

const SESSION = {
    user: {
        id: 'probe-user',
        email: 'probe@defcon.run',
        name: 'Probe Runner',
        services: ['gpxstudio'],
        hasStrava: false,
    },
};

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

async function openDialog(page) {
    await page.waitForSelector('[data-dc34-layers-btn]', { timeout: 45_000 });
    if ((await page.locator('[data-dc34-dialog="layers"]').count()) === 0) {
        await page.click('[data-dc34-layers-btn]');
    }
    await page.locator('[data-dc34-dialog="layers"]').waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(2500);
}

async function main() {
    console.log('='.repeat(78));
    console.log('Phase 71 — heat-map VISUAL CAPTURE (no assertions)');
    console.log('='.repeat(78));
    console.log(`timestamp : ${new Date().toISOString()}`);
    console.log(`target    : ${TARGET}`);
    console.log(`hotspot   : ${HOTSPOT.join(', ')} (measured from the live dc33 artifact)`);

    const browser = await chromium.launch({
        executablePath: EXECUTABLE,
        args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
    });

    try {
        const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
        const page = await ctx.newPage();
        await installRoutes(page);
        await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await page.waitForFunction(() => !!window._map, null, { timeout: 90_000 });
        await page.evaluate(() => window._map.setTerrain(null));

        await openDialog(page);

        // 1. Every master OFF except Heat Map. Basemap is a radio group and has no master.
        const turnedOff = await page.evaluate(() => {
            const dlg = document.querySelector('[data-dc34-dialog="layers"]');
            const off = [];
            for (const sec of dlg.querySelectorAll('[data-section]')) {
                const label = (sec.querySelector('[data-section-label]') || {}).textContent || '';
                if (/^heat map$/i.test(label.trim())) continue;
                const master = sec.querySelector('input[aria-label^="Toggle all in"]');
                if (master && master.checked) {
                    master.click();
                    off.push(label.trim());
                }
            }
            return off;
        });
        console.log(`masters turned off : ${turnedOff.join(' | ') || '(none were on)'}`);
        await page.waitForTimeout(2000);

        // 2. DC33 on. DC34 is left alone — it has no runs and nothing is faked.
        const dc33 = page
            .locator('[data-dc34-dialog="layers"] [data-layer-row]', { hasText: 'DC33' })
            .first()
            .locator('input[type="checkbox"]');
        if (!(await dc33.isChecked())) await dc33.click();
        await page
            .waitForFunction(() => !!window._map.getLayer('heatmap-dc33'), null, { timeout: 90_000 })
            .catch(() => {});
        await page.waitForTimeout(2000);

        await page.keyboard.press('Escape');
        await page.waitForTimeout(600);

        // 2b. Force-hide whatever the master checkboxes did not catch.
        //
        // Added for the 71-16 post-deploy re-capture. The master-checkbox pass above only
        // clicks a master that reports `checked`; a section whose master sits in the
        // INDETERMINATE state (some children on, some off) reports false and is skipped.
        // On the current five-section tree that left `overpass` and the three
        // `dc34-rabbits-*` layers drawing over the heat stack, which the plan's framing
        // requirement ("every non-heat layer hidden") forbids in the visual record.
        // This drives the map API directly so the outcome does not depend on the tri-state
        // of a checkbox. It changes only what is DRAWN in the capture; this file asserts
        // nothing and gates nothing, and heatmap-probe.cjs was not touched.
        const forcedOff = await page.evaluate(() => {
            const m = window._map;
            const off = [];
            for (const l of m.getStyle().layers) {
                if (!l.source || l.source === 'composite' || /^mapbox/.test(l.source)) continue;
                if (/^heatmap-/.test(l.id)) continue;
                if ((m.getLayoutProperty(l.id, 'visibility') || 'visible') !== 'visible') continue;
                m.setLayoutProperty(l.id, 'visibility', 'none');
                off.push(l.id);
            }
            // Markers and popups are DOM nodes, not style layers, so hiding every layer
            // above does not remove them — "The Spot" check-in pin and its label survived
            // the layer sweep on the first re-capture. Remove them so nothing but the
            // basemap and the heat stack is in frame.
            for (const p of document.querySelectorAll(
                '.mapboxgl-popup, .maplibregl-popup, .mapboxgl-marker, .maplibregl-marker'
            )) {
                p.remove();
                off.push('(dom) ' + (p.className || 'marker'));
            }
            return off;
        });
        console.log(`force-hidden (master checkbox missed) : ${forcedOff.join(', ') || '(none)'}`);
        await page.waitForTimeout(1500);

        // What is actually still drawn, so the caption cannot overstate the cleanup.
        const remaining = await page.evaluate(() => {
            const m = window._map;
            const style = m.getStyle();
            const appish = style.layers
                .filter((l) => l.source && l.source !== 'composite' && !/^mapbox/.test(l.source))
                .filter((l) => (m.getLayoutProperty(l.id, 'visibility') || 'visible') === 'visible')
                .map((l) => l.id);
            return appish;
        });
        console.log(`non-basemap layers still visible : ${remaining.join(', ') || '(none)'}`);

        for (const s of SHOTS) {
            await page.evaluate(
                (a) => window._map.jumpTo({ center: a.c, zoom: a.z, bearing: 0, pitch: 0 }),
                { c: HOTSPOT, z: s.zoom }
            );
            await page.waitForTimeout(4000);
            await page.screenshot({ path: path.join(OUT_DIR, s.name), fullPage: false });
            console.log(`wrote ${s.name} (zoom ${s.zoom} — ${s.what})`);
        }

        // 3. Both years on, overlays off — the honest D-12 record as of today.
        await openDialog(page);
        const dc34 = page
            .locator('[data-dc34-dialog="layers"] [data-layer-row]', { hasText: 'DC34' })
            .first()
            .locator('input[type="checkbox"]');
        if (!(await dc34.isChecked())) await dc34.click();
        await page.waitForTimeout(2500);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(600);
        await page.evaluate(
            (a) => window._map.jumpTo({ center: a.c, zoom: a.z, bearing: 0, pitch: 0 }),
            { c: HOTSPOT, z: 12.6 }
        );
        await page.waitForTimeout(4000);
        await page.screenshot({ path: path.join(OUT_DIR, 'shot-both-layers-clean.png') });
        console.log('wrote shot-both-layers-clean.png (both rows ON; DC34 draws nothing — 0 runs)');

        const final = await page.evaluate(() => {
            const m = window._map;
            const read = (id) => {
                const l = m.getLayer(id);
                if (!l) return `${id}: ABSENT`;
                return `${id}: visibility=${m.getLayoutProperty(id, 'visibility') || 'visible'} color=${m.getPaintProperty(id, 'line-color')} opacity=${m.getPaintProperty(id, 'line-opacity')} width=${m.getPaintProperty(id, 'line-width')}`;
            };
            return [read('heatmap-dc33'), read('heatmap-dc34')];
        });
        for (const line of final) console.log(`  ${line}`);
    } finally {
        await browser.close();
    }
    console.log('-'.repeat(78));
    console.log('capture complete');
}

main().catch((e) => {
    console.log(`ERROR: ${String((e && e.message) || e).split('\n')[0]}`);
    process.exitCode = 1;
});
