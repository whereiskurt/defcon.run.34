#!/usr/bin/env node
/**
 * Phase 70 / DLGS-06 — production probe for the shared dialog shell.
 *
 * Drives the LIVE gpx.defcon.run studio in headless Chromium and asserts the
 * fifteen DOM contracts from 70-UI-SPEC.md §8: click-to-open (and NOT hover-to-open)
 * on the Map Layers dialog, zero native hover-tooltip attributes inside layer rows
 * and file rows, Map Layers section order, hint-bar default plus hint-bar update on
 * hover, Esc dismissal, and the My Maps section order plus its footer action.
 *
 * Assertion 13 runs a SECOND pass in a fresh context whose session stub carries no
 * `gpxstudio` service, so My Maps renders its access-denied gate. It asserts the
 * footer's "Add run" button is absent there — the Phase 70 regression recorded in
 * .planning/todos/…-my-maps-footer-gate-regression.md, where the button closed the
 * dialog, opened nothing (QuickStartHub gates on the same two conditions), and left
 * `quickStartOpen` latched true. Assertions 1-12 stub a session WITH the service and
 * therefore never touch either gate screen, which is why they went 12/12 green while
 * the defect was live.
 *
 * Assertion 14 covers the shared shell's scroll mechanism: it injects an element of
 * known height into the Map Layers body and asserts the body overflows AND can be
 * scrolled. It is measured against an injected element rather than against real route
 * data on purpose — the public manifest is not a fixed size between runs, so anything
 * that waits for prod content to be tall enough flakes. Assertions 1-13 never measure
 * geometry, which is why they scored 13/13 green while the body was silently crushing
 * every section flat.
 *
 * Assertion 16 covers layer VISIBILITY persistence across a PAGE LOAD. It seeds
 * localStorage in a fresh browser context (via addInitScript, before any app code runs)
 * with values that are the OPPOSITE of the built-in defaults, then does exactly one page
 * load and asserts the map layers came up in the seeded state — and that the camera did
 * not move as a result. The camera half is not decoration: every user-facing visibility
 * setter fitBounds, so a restore wired through one of them would yank the map away from
 * wherever the runner is, on every page load. Reloading in-page is deliberately NOT used
 * — re-initialising mapbox in the same page under swiftshader times out.
 *
 * Assertion 15 covers collapse-state PERSISTENCE across a dialog close/reopen. The
 * shell portals without forceMount, so closing the dialog removes its whole subtree
 * from the DOM and every `$state` declared by a component rendered inside it is
 * destroyed. Sections whose collapse state lived inside that subtree therefore always
 * reopened at their literal default — the reported "I collapsed it, it always opens
 * expanded". Assertions 1-14 only ever look at a single open, which is why they scored
 * 14/14 green while the defect was live.
 *
 * The denominator is a fixed literal. A sub-check whose subject legitimately does
 * not exist in production data scores as a pass and says so in the transcript, so
 * the ship gate stays reachable without ever shrinking what is asserted.
 *
 * Usage — the caller supplies the public mapbox token from SSM. The decryption flag
 * is load-bearing: without it the value is KMS ciphertext, mapbox never fires its
 * load event, and every DOM assertion times out.
 *
 *   MAPBOX_TOKEN=$(aws ssm get-parameter \
 *     --name /dc34/secrets/use1/mapbox/public_token --with-decryption \
 *     --query Parameter.Value --output text \
 *     --profile dc34-application --region us-east-1) \
 *   node dialog-shell-probe.cjs > transcript-post-deploy.txt 2>&1
 *
 * Optional: PROBE_NOTES — newline-separated extra header lines (run URLs, the
 * released version, the roll-verification sentinel hit). Header-only; it cannot
 * change what is asserted, so the same script serves the pre- and post-deploy runs.
 *
 * The token is never printed and never written to disk.
 */

const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const { chromium } = require('/Users/khundeck/working/defcon.run.34/apps/run.auth/e2e/node_modules/playwright-core');

const TOTAL = 16;
const TARGET = 'https://gpx.defcon.run/use1/studio/app';
// Read directly (not through the browser) by assertion 16, to learn the real fileIds it
// must seed. Keying the seed off an id from the live manifest is what stops the
// assertion passing vacuously against a route that does not exist.
const PUBLIC_MANIFEST = 'https://gpx.defcon.run/use1/api/gpx/public/maps';
// The GLOBAL folder the app ships ON by default (public-overlays.ts DEFAULT_ON_FOLDER).
const DEFAULT_ON_FOLDER = 'DEF CON 34 Maps';
// localStorage keys the two persisted dialog stores use.
const LS_VISIBILITY = 'dc34LayerVisibility';
const LS_COLLAPSE = 'dc34LayerSectionCollapse';
// Somewhere unmistakably not Las Vegas: any fitBounds fired by a restore would move the
// camera thousands of km, so an unchanged reading here is not a near-miss.
const CAMERA_SENTINEL = { center: [-0.1276, 51.5074], zoom: 9 };
const EXECUTABLE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const OUT_DIR = __dirname;
const DEFAULT_HINT = 'Hover a row for details';
// Public mapbox tokens carry a fixed prefix. Spelled as a pattern rather than a
// literal so the artifact directory can be swept for a leaked token by plain grep.
const TOKEN_PREFIX = /^pk\./;

const token = process.env.MAPBOX_TOKEN || '';
if (!token) {
    console.log('ERROR: MAPBOX_TOKEN is unset. Read it from SSM (see the header of this script).');
    process.exit(2);
}
if (!TOKEN_PREFIX.test(token)) {
    console.log('ERROR: MAPBOX_TOKEN has the wrong prefix — it looks like KMS ciphertext.');
    console.log('       The SSM read must pass the decryption flag documented above.');
    process.exit(2);
}

let passed = 0;
function pass(n, label, note) {
    passed++;
    console.log(`PASS  ${n}. ${label}${note ? ` — ${note}` : ''}`);
}
function skip(n, label, what) {
    passed++;
    console.log(`PASS (skipped: no ${what} in prod data)  ${n}. ${label}`);
}
// Same scoring contract as skip(), for a subject whose absence is a COUNT rather than
// a kind ("only 1 section(s)"). Kept separate so the skip wording stays literal.
function skipWhy(n, label, why) {
    passed++;
    console.log(`PASS (skipped: ${why})  ${n}. ${label}`);
}
function bad(n, label, note) {
    console.log(`FAIL  ${n}. ${label}${note ? ` — ${note}` : ''}`);
}

/** GET a JSON document, reading the body to completion (a truncated read here would
 * manufacture a phantom "no routes in prod data" skip). */
function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https
            .get(url, { headers: { accept: 'application/json' } }, (res) => {
                if (res.statusCode !== 200) {
                    res.resume();
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }
                let body = '';
                res.setEncoding('utf8');
                res.on('data', (c) => (body += c));
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(body));
                    } catch (e) {
                        reject(e);
                    }
                });
            })
            .on('error', reject);
    });
}

function sha() {
    try {
        return execSync('git rev-parse --short HEAD', { cwd: OUT_DIR }).toString().trim();
    } catch {
        return 'unknown';
    }
}

// The two session shapes the probe drives. GRANTED is what assertions 1-12 have
// always used. DENIED keeps a real user (so the store reports authenticated) but
// drops the service claim, which is exactly what lands My Maps on its access-denied
// gate — the branch assertion 13 exists to cover.
const SESSION_GRANTED = {
    user: {
        id: 'probe-user',
        email: 'probe@defcon.run',
        name: 'Probe Runner',
        services: ['gpxstudio'],
        hasStrava: false,
    },
};
const SESSION_DENIED = {
    user: {
        id: 'probe-user-nogate',
        email: 'probe-nogate@defcon.run',
        name: 'Probe Runner (no service)',
        services: [],
        hasStrava: false,
    },
};

// Route stubs. Playwright resolves the most recently registered matching handler
// first, so the broad catch-alls are registered before the narrow handlers that must
// win. Both passes share this function verbatim — only `session` differs.
async function installRoutes(page, session) {
    await page.route('**/use1/api/gpx/**', (r) =>
        r.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    );
    await page.route('**/use1/api/user/**', (r) =>
        r.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    );
    await page.route('**/use1/api/auth/**', (r) =>
        r.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    );
    // Real public manifest data, so the DEF CON 34 / Rabbit route groups render.
    await page.route('**/use1/api/gpx/public/**', (r) => r.continue());
    await page.route('**/use1/api/user/mapbox-token*', (r) =>
        r.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ token }),
        })
    );
    await page.route('**/use1/api/auth/session*', (r) =>
        r.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                ...session,
                expires: new Date(Date.now() + 3600_000).toISOString(),
            }),
        })
    );
    await page.route('**/use1/api/gpx/files*', (r) =>
        r.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                files: [
                    {
                        fileId: 'probe-file-1',
                        fileName: 'probe-route.gpx',
                        fileSize: 20480,
                        version: 1,
                        trackCount: 1,
                        createdAt: Date.now() - 86_400_000,
                        updatedAt: Date.now() - 3_600_000,
                    },
                ],
            }),
        })
    );
    await page.route('**/use1/api/gpx/folders*', (r) =>
        r.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                folders: [],
                globalFolders: [{ folderId: 'probe-global', folderName: 'DEF CON 34 Maps' }],
            }),
        })
    );
}

async function main() {
    console.log('='.repeat(78));
    console.log('Phase 70 DLGS-06 — shared dialog shell production probe');
    console.log('='.repeat(78));
    console.log(`timestamp   : ${new Date().toISOString()}`);
    console.log(`git sha     : ${sha()}`);
    console.log(`target      : ${TARGET}`);
    if (process.env.PROBE_NOTES) {
        for (const line of process.env.PROBE_NOTES.split('\n')) console.log(line);
    }

    const browser = await chromium.launch({
        executablePath: EXECUTABLE,
        args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
    });

    try {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const page = await context.newPage();

        await installRoutes(page, SESSION_GRANTED);

        const response = await page.goto(TARGET, {
            waitUntil: 'domcontentloaded',
            timeout: 60_000,
        });
        const headers = response ? response.headers() : {};
        console.log(`bundle etag : ${headers.etag || 'n/a'}`);
        console.log(`bundle date : ${headers['last-modified'] || 'n/a'}`);

        await page.waitForFunction(() => !!window._map, null, { timeout: 90_000 });
        // Terrain on a software rasteriser is the usual hang.
        await page.evaluate(() => window._map.setTerrain(null));

        const entryChunks = await page.evaluate(() =>
            [...document.querySelectorAll('link[rel="modulepreload"], script[type="module"][src]')]
                .map((e) => e.getAttribute('href') || e.getAttribute('src'))
                .filter((h) => h && h.endsWith('.js'))
                .slice(0, 4)
        );
        console.log(`entry chunks: ${entryChunks.join(' ') || 'n/a'}`);
        console.log('-'.repeat(78));

        // ---- 1. layers trigger present -------------------------------------
        const L1 = 'Layers control button is present';
        try {
            await page.waitForSelector('[data-dc34-layers-btn]', { timeout: 45_000 });
            pass(1, L1);
        } catch (e) {
            bad(1, L1, 'selector never appeared');
        }

        // ---- 2. hover must NOT open ----------------------------------------
        const L2 = 'Hovering the layers button does NOT open the dialog';
        try {
            await page.hover('[data-dc34-layers-btn]');
            await page.waitForTimeout(500);
            const n = await page.locator('[data-dc34-dialog="layers"]').count();
            if (n === 0) pass(2, L2);
            else bad(2, L2, `${n} dialog(s) opened on hover`);
        } catch (e) {
            bad(2, L2, String(e.message).split('\n')[0]);
        }

        // ---- 3. click opens a role=dialog ----------------------------------
        const L3 = 'Clicking the layers button opens a visible role=dialog';
        try {
            await page.click('[data-dc34-layers-btn]');
            const dlg = page.locator('[data-dc34-dialog="layers"]');
            await dlg.waitFor({ state: 'visible', timeout: 15_000 });
            const role = await dlg.getAttribute('role');
            if (role === 'dialog') pass(3, L3);
            else bad(3, L3, `role is ${role}`);
        } catch (e) {
            bad(3, L3, String(e.message).split('\n')[0]);
        }
        await page
            .screenshot({ path: path.join(OUT_DIR, 'shot-layers.png'), fullPage: false })
            .catch(() => {});

        // ---- 4. no native tooltips inside layer rows ------------------------
        const L4 = 'Zero native hover-tooltip attributes inside layer rows';
        try {
            const counts = await page.evaluate(() => ({
                inner: document.querySelectorAll('[data-layer-row] [title]').length,
                self: document.querySelectorAll('[data-layer-row][title]').length,
                rows: document.querySelectorAll('[data-layer-row]').length,
            }));
            if (counts.inner === 0 && counts.self === 0)
                pass(4, L4, `${counts.rows} rows inspected`);
            else bad(4, L4, `inner=${counts.inner} self=${counts.self}`);
        } catch (e) {
            bad(4, L4, String(e.message).split('\n')[0]);
        }

        // ---- 5. section order ----------------------------------------------
        const L5 = 'Map Layers section order follows the spec';
        try {
            const labels = await page.evaluate(() =>
                [
                    ...document.querySelectorAll(
                        '[data-dc34-dialog="layers"] [data-section-label]'
                    ),
                ].map((e) => e.textContent.trim())
            );
            const spec = [
                ['Basemap', (t) => /^basemap$/i.test(t)],
                ['User Check-ins', (t) => /check-?ins/i.test(t)],
                ['route groups', (t) => /routes$/i.test(t) && !/^community routes$/i.test(t)],
                ['My DEF CON Runs', (t) => /my def con runs/i.test(t)],
                ['Community Routes', (t) => /^community routes$/i.test(t)],
            ];
            const firstIdx = spec.map(([, t]) => labels.findIndex(t));
            const missing = spec.filter((s, i) => firstIdx[i] === -1).map(([n]) => n);
            const problems = [];
            for (let i = 0; i < spec.length; i++) {
                for (let j = i + 1; j < spec.length; j++) {
                    if (firstIdx[i] === -1 || firstIdx[j] === -1) continue;
                    if (firstIdx[i] > firstIdx[j])
                        problems.push(`${spec[i][0]} after ${spec[j][0]}`);
                }
            }
            const firstIsBasemap = labels.length > 0 && /^basemap$/i.test(labels[0]);
            if (!firstIsBasemap) {
                bad(5, L5, `first section is "${labels[0] || '(none)'}", expected Basemap`);
            } else if (problems.length) {
                bad(5, L5, problems.join('; '));
            } else {
                const note =
                    `order ok [${labels.join(' | ')}]` +
                    (missing.length
                        ? ` — PASS (skipped: no ${missing.join(' / ')} in prod data)`
                        : '');
                pass(5, L5, note);
            }
        } catch (e) {
            bad(5, L5, String(e.message).split('\n')[0]);
        }

        // ---- 6. hint bar default --------------------------------------------
        // Measured with nothing hinted hovered OR focused. Both preconditions are
        // required: UI-SPEC §7 makes the bar answer to focusin as well as hover, and
        // the dialog's focus trap lands focus inside the body on open — so the copy
        // visible the instant the dialog appears is legitimately the focused element's
        // hint, not the default. Neutralising focus first is what isolates the default,
        // and asserting it here additionally proves the bar can RETURN to the default
        // rather than merely being initialised to it.
        const L6 = 'Hint bar shows its default copy once nothing hinted is hovered or focused';
        try {
            const onOpen = (
                await page.locator('[data-dc34-dialog="layers"] [data-hint-out]').textContent()
            ).trim();
            await page.mouse.move(5, 5);
            await page.evaluate(() => {
                const d = document.querySelector('[data-dc34-dialog="layers"]');
                const neutral = [...d.querySelectorAll('button, [tabindex]')].find(
                    (el) => !el.closest('[data-hint]')
                );
                if (neutral) neutral.focus();
                else document.activeElement?.blur?.();
            });
            await page.waitForTimeout(350);
            const t = (
                await page.locator('[data-dc34-dialog="layers"] [data-hint-out]').textContent()
            ).trim();
            if (t === DEFAULT_HINT) pass(6, L6, `"${t}" (on open it read "${onOpen}")`);
            else bad(6, L6, `got "${t}"`);
        } catch (e) {
            bad(6, L6, String(e.message).split('\n')[0]);
        }

        // ---- 7. hint bar updates on hover ------------------------------------
        const L7 = 'Hint bar text changes when a hinted row is hovered';
        try {
            const hintOut = page.locator('[data-dc34-dialog="layers"] [data-hint-out]');
            const rows = page.locator('[data-dc34-dialog="layers"] [data-layer-row][data-hint]');
            let target = null;
            const rowCount = await rows.count();
            for (let i = 0; i < rowCount; i++) {
                const h = await rows.nth(i).getAttribute('data-hint');
                if (h && h.trim()) {
                    target = rows.nth(i);
                    break;
                }
            }
            if (!target) {
                // Section headers always carry a hint, so prefer the fallback over a skip.
                const any = page.locator('[data-dc34-dialog="layers"] [data-hint]');
                const anyCount = await any.count();
                for (let i = 0; i < anyCount; i++) {
                    const h = await any.nth(i).getAttribute('data-hint');
                    if (h && h.trim()) {
                        target = any.nth(i);
                        break;
                    }
                }
            }
            if (!target) {
                skip(7, L7, 'hinted element');
            } else {
                const want = (await target.getAttribute('data-hint')).trim();
                await target.hover();
                await page.waitForTimeout(350);
                const got = (await hintOut.textContent()).trim();
                if (got && got !== DEFAULT_HINT && got === want) pass(7, L7, `"${got}"`);
                else bad(7, L7, `got "${got}", wanted "${want}"`);
            }
        } catch (e) {
            bad(7, L7, String(e.message).split('\n')[0]);
        }

        // ---- 8. Esc closes ----------------------------------------------------
        const L8 = 'Escape closes the Map Layers dialog';
        try {
            await page.keyboard.press('Escape');
            await page.waitForTimeout(600);
            const n = await page.locator('[data-dc34-dialog="layers"]').count();
            if (n === 0) pass(8, L8);
            else bad(8, L8, `${n} dialog(s) still mounted`);
        } catch (e) {
            bad(8, L8, String(e.message).split('\n')[0]);
        }

        // ---- 9. My Maps opens -------------------------------------------------
        const L9 = 'Ctrl+O opens the My Maps dialog';
        try {
            await page.keyboard.press('Control+o');
            await page
                .locator('[data-dc34-dialog="mymaps"]')
                .waitFor({ state: 'visible', timeout: 20_000 });
            pass(9, L9);
        } catch (e) {
            bad(9, L9, String(e.message).split('\n')[0]);
        }
        await page.waitForTimeout(1500);
        await page
            .screenshot({ path: path.join(OUT_DIR, 'shot-mymaps.png'), fullPage: false })
            .catch(() => {});

        // ---- 10. My Maps section order ----------------------------------------
        const L10 = 'My Maps puts MY FILES before SHARED WITH YOU';
        try {
            const labels = await page.evaluate(() =>
                [
                    ...document.querySelectorAll(
                        '[data-dc34-dialog="mymaps"] [data-section-label]'
                    ),
                ].map((e) => e.textContent.trim())
            );
            const mine = labels.findIndex((t) => /my files/i.test(t));
            const shared = labels.findIndex((t) => /shared with you/i.test(t));
            if (mine === -1) bad(10, L10, `no My files section in [${labels.join(' | ')}]`);
            else if (shared === -1) skip(10, L10, 'Shared with you section');
            else if (mine < shared) pass(10, L10, `[${labels.join(' | ')}]`);
            else bad(10, L10, `My files at ${mine}, Shared with you at ${shared}`);
        } catch (e) {
            bad(10, L10, String(e.message).split('\n')[0]);
        }

        // ---- 11. footer action --------------------------------------------------
        const L11 = 'My Maps footer carries the Add run button';
        try {
            const found = await page.evaluate(() => {
                const d = document.querySelector('[data-dc34-dialog="mymaps"]');
                if (!d) return false;
                return [...d.querySelectorAll('button')].some((b) =>
                    (b.textContent || '').includes('Add run')
                );
            });
            if (found) pass(11, L11);
            else bad(11, L11, 'no button whose text contains the action label');
        } catch (e) {
            bad(11, L11, String(e.message).split('\n')[0]);
        }

        // ---- 12. no native tooltips inside file rows -----------------------------
        const L12 = 'Zero native hover-tooltip attributes inside file rows';
        try {
            const counts = await page.evaluate(() => ({
                inner: document.querySelectorAll('[data-file-row] [title]').length,
                self: document.querySelectorAll('[data-file-row][title]').length,
                rows: document.querySelectorAll('[data-file-row]').length,
            }));
            if (counts.inner === 0 && counts.self === 0)
                pass(12, L12, `${counts.rows} rows inspected`);
            else bad(12, L12, `inner=${counts.inner} self=${counts.self}`);
        } catch (e) {
            bad(12, L12, String(e.message).split('\n')[0]);
        }

        // ---- 13. footer must NOT paint on the gate screen ------------------------
        // Second pass, fresh context: same stubs, session WITHOUT the gpxstudio
        // service. My Maps then renders its access-denied gate, where "Add run" is a
        // dead end (QuickStartHub's canShow derives from the same two conditions).
        // Reaching the gate is asserted explicitly — a dialog that never opened, or a
        // body that is not a gate, scores FAIL rather than a vacuous pass.
        const L13 = 'My Maps hides the Add run footer on the access-denied gate screen';
        try {
            const gatedCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
            const gated = await gatedCtx.newPage();
            await installRoutes(gated, SESSION_DENIED);
            await gated.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60_000 });
            await gated.waitForFunction(() => !!window._map, null, { timeout: 90_000 });
            await gated.evaluate(() => window._map.setTerrain(null));
            await gated.keyboard.press('Control+o');
            await gated
                .locator('[data-dc34-dialog="mymaps"]')
                .waitFor({ state: 'visible', timeout: 20_000 });
            await gated.waitForTimeout(1500);
            await gated
                .screenshot({ path: path.join(OUT_DIR, 'shot-mymaps-gated.png'), fullPage: false })
                .catch(() => {});
            const seen = await gated.evaluate(() => {
                const d = document.querySelector('[data-dc34-dialog="mymaps"]');
                if (!d) return null;
                const text = (d.textContent || '').replace(/\s+/g, ' ').trim();
                return {
                    addRun: [...d.querySelectorAll('button')].filter((b) =>
                        (b.textContent || '').includes('Add run')
                    ).length,
                    onGate: /access denied/i.test(text) || /need to sign in/i.test(text),
                    text: text.slice(0, 110),
                };
            });
            if (!seen) bad(13, L13, 'My Maps dialog not present on the gated pass');
            else if (!seen.onGate) bad(13, L13, `not a gate screen — dialog read "${seen.text}"`);
            else if (seen.addRun === 0) pass(13, L13, `gate reads "${seen.text}"`);
            else bad(13, L13, `${seen.addRun} "Add run" button(s) on the gate screen`);
            await gatedCtx.close();
        } catch (e) {
            bad(13, L13, String(e.message).split('\n')[0]);
        }

        // ---- 14. the dialog body scrolls instead of crushing its children ---------
        // The shell's body is a column flex container with a definite height, so its
        // direct children are flex items. Section's card variant carries overflow-hidden
        // for the rounded clip, which resolves its automatic min-height to 0 — so before
        // the fix the cards SHRANK to fit rather than overflowing, scrollHeight never
        // exceeded clientHeight, and overflow-y-auto never produced a scrollbar. Content
        // past the fold was clipped into permanent unreachability.
        //
        // Deliberately measured against an INJECTED element of known height rather than
        // against real content: the public route manifest rendered 15 rows on one run and
        // 0 on the next, so any assertion that waits for prod data to be tall enough
        // flakes. The filler carries height alone and NO flex properties of its own, so
        // the only thing that can stop it being crushed is the shell's own rule — which
        // is precisely the mechanism under test. It is removed again afterwards.
        const L14 = 'Map Layers body overflows and scrolls rather than crushing its children';
        try {
            await page.keyboard.press('Escape'); // dismiss My Maps from assertions 9-12
            await page.waitForTimeout(500);
            await page.click('[data-dc34-layers-btn]');
            await page
                .locator('[data-dc34-dialog="layers"]')
                .waitFor({ state: 'visible', timeout: 15_000 });
            await page.waitForTimeout(800);

            const m = await page.evaluate(() => {
                const body = document.querySelector(
                    '[data-dc34-dialog="layers"] [data-dialog-body]'
                );
                if (!body) return null;
                const filler = document.createElement('div');
                filler.setAttribute('data-probe-filler', '');
                filler.style.height = '1400px';
                filler.textContent = 'probe filler';
                body.appendChild(filler);
                // Read back what the layout engine actually gave the filler, so a crush
                // is reported as a measurement rather than inferred from the totals.
                const fillerH = filler.getBoundingClientRect().height;
                const clientH = body.clientHeight;
                const scrollH = body.scrollHeight;
                const before = body.scrollTop;
                body.scrollTop = 400;
                const after = body.scrollTop;
                body.scrollTop = before;
                filler.remove();
                return { clientH, scrollH, fillerH, after };
            });

            if (!m) {
                bad(14, L14, 'layers dialog body not found');
            } else {
                const overflows = m.scrollH > m.clientH;
                const scrolls = m.after > 0;
                const note =
                    `clientH=${m.clientH} scrollH=${m.scrollH} ` +
                    `filler 1400px rendered ${Math.round(m.fillerH)}px scrollTop=${m.after}`;
                if (overflows && scrolls) pass(14, L14, note);
                else bad(14, L14, note);
            }
        } catch (e) {
            bad(14, L14, String(e.message).split('\n')[0]);
        }

        // ---- 15. collapse state survives closing and reopening the dialog --------
        // Open, record every section's chevron aria-expanded, toggle every chevron,
        // close with Escape (which unmounts the whole portalled subtree), reopen, and
        // require every section still visible to read back its POST-TOGGLE value.
        //
        // Data-volume caveat, hit twice while building this phase: the public route
        // manifest is racy — the dialog rendered 1 section on one run and 4 on the next.
        // So the section count is polled until it stops moving before the first toggle,
        // and a run that genuinely has fewer than two sections scores as a documented
        // skip rather than asserting something vacuous.
        const L15 = 'Section collapse state survives closing and reopening Map Layers';
        try {
            const readSections = () =>
                page.evaluate(() => {
                    const d = document.querySelector('[data-dc34-dialog="layers"]');
                    if (!d) return [];
                    return [...d.querySelectorAll('[data-section]')]
                        .map((s) => {
                            const c = s.querySelector('[data-section-chevron]');
                            const l = s.querySelector('[data-section-label]');
                            return c
                                ? {
                                      label: (l ? l.textContent : '').trim(),
                                      expanded: c.getAttribute('aria-expanded'),
                                  }
                                : null;
                        })
                        .filter(Boolean);
                });

            // Poll until the rendered section count holds steady across 3 reads.
            const settle = async () => {
                let last = -1;
                let steady = 0;
                for (let i = 0; i < 60; i++) {
                    const n = (await readSections()).length;
                    steady = n === last ? steady + 1 : 0;
                    last = n;
                    if (steady >= 3 && n > 0) break;
                    await page.waitForTimeout(500);
                }
                return last;
            };

            const openLayers = async () => {
                await page.click('[data-dc34-layers-btn]');
                await page
                    .locator('[data-dc34-dialog="layers"]')
                    .waitFor({ state: 'visible', timeout: 15_000 });
                return settle();
            };

            // Assertions 9-14 left My Maps and/or Map Layers open; start from closed.
            await page.keyboard.press('Escape');
            await page.waitForTimeout(700);
            while ((await page.locator('[data-dc34-dialog="layers"]').count()) > 0) {
                await page.keyboard.press('Escape');
                await page.waitForTimeout(500);
            }

            const n1 = await openLayers();
            if (n1 < 2) {
                await page.keyboard.press('Escape');
                skipWhy(15, L15, `only ${n1} section(s) in prod data`);
            } else {
                const before = await readSections();

                // Click every chevron that is still attached. Collapsing a parent removes
                // its nested sub-sections, so a stale handle is skipped rather than clicked.
                await page.evaluate(() => {
                    const d = document.querySelector('[data-dc34-dialog="layers"]');
                    for (const s of [...d.querySelectorAll('[data-section]')]) {
                        const c = s.querySelector('[data-section-chevron]');
                        if (c && c.isConnected) c.click();
                    }
                });
                await page.waitForTimeout(700);
                const after = await readSections();

                await page.keyboard.press('Escape');
                await page.waitForTimeout(700);
                const unmounted =
                    (await page.locator('[data-dc34-dialog="layers"]').count()) === 0;

                const n2 = await openLayers();
                const reopened = await readSections();

                // Compare by label. A label that appears more than once in either snapshot
                // is dropped from the comparison rather than matched ambiguously.
                const uniq = (arr) => {
                    const seen = new Map();
                    for (const s of arr)
                        seen.set(s.label, seen.has(s.label) ? null : s.expanded);
                    return seen;
                };
                const wantMap = uniq(after);
                const gotMap = uniq(reopened);
                const mismatches = [];
                let compared = 0;
                for (const [label, want] of wantMap) {
                    const got = gotMap.get(label);
                    if (want === null || got === null || got === undefined) continue;
                    compared++;
                    if (got !== want)
                        mismatches.push(`${label}: expected aria-expanded=${want}, got ${got}`);
                }

                const note =
                    `${n1} section(s) open#1, toggled ${after.length}, ` +
                    `unmounted=${unmounted}, ${n2} section(s) on reopen, ` +
                    `${compared} compared` +
                    ` [before ${before.map((s) => `${s.label}=${s.expanded}`).join(', ')}]` +
                    ` [after ${after.map((s) => `${s.label}=${s.expanded}`).join(', ')}]` +
                    ` [reopen ${reopened.map((s) => `${s.label}=${s.expanded}`).join(', ')}]`;

                if (compared === 0) bad(15, L15, `nothing comparable across reopen — ${note}`);
                else if (mismatches.length) bad(15, L15, `${mismatches.join('; ')} — ${note}`);
                else pass(15, L15, note);
            }
        } catch (e) {
            bad(15, L15, String(e.message).split('\n')[0]);
        }

        // ---- 16. layer visibility survives a PAGE LOAD, without moving the camera ----
        // Collapse state persisted first (assertion 15); the layers a runner had switched
        // on did not, because visibility lives in layer instances that are rebuilt from a
        // manifest on every load with hardcoded defaults.
        //
        // Method: a FRESH context whose localStorage is seeded by addInitScript before any
        // app code runs, then ONE page load. In-page reload is avoided on purpose —
        // re-initialising mapbox in the same page under swiftshader times out.
        //
        // The seed is the OPPOSITE of the built-in default for every subject, keyed off a
        // fileId read from the live manifest, so the assertion cannot pass vacuously:
        //   · a route in the default-ON folder is seeded OFF (expect visibility 'none')
        //   · falling back to a default-OFF folder, its route is seeded ON
        //   · User Check-ins (default OFF) is seeded ON
        // Collapse is seeded too, expanding the owning group, so the row is actually
        // rendered for the DOM half of the check — and so the two stores are proven to
        // coexist rather than one clobbering the other.
        //
        // Camera: the page is jumped to a sentinel view the instant the map object exists
        // and a movestart recorder is attached; the restore must leave both untouched.
        //
        // Data-volume caveat (hit three times in this phase): the public manifest is racy.
        // A run that genuinely has no public routes scores a documented skip rather than
        // asserting something vacuous.
        const L16 = 'Layer visibility survives a page load and the restore does not move the camera';
        try {
            let manifestGroups = [];
            try {
                const doc = await fetchJson(PUBLIC_MANIFEST);
                manifestGroups = (doc && doc.groups) || [];
            } catch (e) {
                manifestGroups = [];
            }
            const onGroup = manifestGroups.find(
                (g) => g.folderName === DEFAULT_ON_FOLDER && g.maps && g.maps.length > 0
            );
            const anyGroup = manifestGroups.find((g) => g.maps && g.maps.length > 0);
            const group = onGroup || anyGroup;

            if (!group) {
                skipWhy(16, L16, 'no public routes in the live manifest');
            } else {
                const target = group.maps[0];
                // Default for this route = whether its folder is the default-ON one.
                const defaultVisible = !!onGroup;
                const seedValue = !defaultVisible;
                const wantRouteVis = seedValue ? 'visible' : 'none';
                const routeLayerId = `public-map-${target.fileId}`;
                const wantLabel = (
                    target.title || String(target.fileName || '').replace(/\.gpx$/i, '')
                ).trim();

                const visSeed = { [`route:${target.fileId}`]: seedValue, checkins: true };
                const collapseSeed = { [`group:${group.folderId}`]: false, checkins: false };

                const visCtx = await browser.newContext({
                    viewport: { width: 1280, height: 900 },
                });
                await visCtx.addInitScript(
                    (s) => {
                        try {
                            localStorage.setItem(s.visKey, JSON.stringify(s.vis));
                            localStorage.setItem(s.collapseKey, JSON.stringify(s.collapse));
                        } catch (e) {
                            /* private mode — the assertion below will report the miss */
                        }
                    },
                    {
                        visKey: LS_VISIBILITY,
                        collapseKey: LS_COLLAPSE,
                        vis: visSeed,
                        collapse: collapseSeed,
                    }
                );
                const visPage = await visCtx.newPage();
                await installRoutes(visPage, SESSION_GRANTED);
                await visPage.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60_000 });
                await visPage.waitForFunction(() => !!window._map, null, { timeout: 90_000 });
                await visPage.evaluate(() => window._map.setTerrain(null));

                // Sentinel view + move recorder, attached AFTER the jump so the jump's own
                // movestart is not counted. `early` records whether the restore had already
                // landed at this point; if it had, the camera half would be vacuous and the
                // note says so.
                const early = await visPage.evaluate(
                    (a) => {
                        const m = window._map;
                        m.jumpTo({ center: a.center, zoom: a.zoom, bearing: 0, pitch: 0 });
                        window.__dc34Moves = [];
                        m.on('movestart', () => window.__dc34Moves.push('movestart'));
                        return { alreadyRestored: !!m.getLayer(a.routeLayerId) };
                    },
                    { ...CAMERA_SENTINEL, routeLayerId }
                );

                // Wait for the restore to actually land (the route layer is added by the
                // same code path that applies the restored visibility).
                let landed = true;
                try {
                    await visPage.waitForFunction(
                        (id) => !!window._map.getLayer(id),
                        routeLayerId,
                        { timeout: 90_000 }
                    );
                } catch (e) {
                    landed = false;
                }

                if (!landed) {
                    skipWhy(16, L16, `route layer ${routeLayerId} never rendered in prod data`);
                } else {
                    // Settle: give any late fitBounds animation room to fire before reading.
                    await visPage.waitForTimeout(2500);

                    const seen = await visPage.evaluate(
                        (a) => {
                            const m = window._map;
                            const vis = (id) =>
                                m.getLayer(id)
                                    ? m.getLayoutProperty(id, 'visibility') || 'visible'
                                    : null;
                            const c = m.getCenter();
                            return {
                                route: vis(a.routeLayerId),
                                checkins: vis('public-checkins-pin'),
                                center: [c.lng, c.lat],
                                zoom: m.getZoom(),
                                moves: (window.__dc34Moves || []).length,
                                stored: localStorage.getItem(a.visKey),
                            };
                        },
                        { routeLayerId, visKey: LS_VISIBILITY }
                    );

                    // DOM corroboration: the seeded row's checkbox in the dialog itself.
                    let row = { found: false };
                    try {
                        await visPage.waitForSelector('[data-dc34-layers-btn]', {
                            timeout: 45_000,
                        });
                        await visPage.click('[data-dc34-layers-btn]');
                        await visPage
                            .locator('[data-dc34-dialog="layers"]')
                            .waitFor({ state: 'visible', timeout: 15_000 });
                        await visPage.waitForTimeout(2500);
                    } catch (e) {
                        /* handled by row.found below */
                    }
                    row = await visPage
                        .evaluate((label) => {
                            const d = document.querySelector('[data-dc34-dialog="layers"]');
                            if (!d) return { found: false, rows: 0 };
                            const rows = [...d.querySelectorAll('[data-layer-row]')];
                            const hit = rows.find(
                                (r) => (r.textContent || '').trim() === label
                            );
                            if (!hit) return { found: false, rows: rows.length };
                            const cb = hit.querySelector('input[type="checkbox"]');
                            return { found: true, checked: !!(cb && cb.checked) };
                        }, wantLabel)
                        .catch(() => ({ found: false, rows: 0 }));

                    await visPage
                        .screenshot({
                            path: path.join(OUT_DIR, 'shot-visibility-restore.png'),
                            fullPage: false,
                        })
                        .catch(() => {});

                    const dLng = Math.abs(seen.center[0] - CAMERA_SENTINEL.center[0]);
                    const dLat = Math.abs(seen.center[1] - CAMERA_SENTINEL.center[1]);
                    const dZoom = Math.abs(seen.zoom - CAMERA_SENTINEL.zoom);
                    const cameraHeld = dLng < 1e-3 && dLat < 1e-3 && dZoom < 1e-3;

                    const problems = [];
                    if (seen.route !== wantRouteVis)
                        problems.push(
                            `route "${wantLabel}" seeded ${seedValue} (default ${defaultVisible}) ` +
                                `renders visibility=${seen.route}, wanted ${wantRouteVis}`
                        );
                    if (seen.checkins !== null && seen.checkins !== 'visible')
                        problems.push(
                            `check-ins seeded ON render visibility=${seen.checkins}`
                        );
                    if (row.found && row.checked !== seedValue)
                        problems.push(
                            `dialog row checkbox is ${row.checked}, wanted ${seedValue}`
                        );
                    if (!cameraHeld)
                        problems.push(
                            `camera moved: centre ${seen.center.map((n) => n.toFixed(4)).join(',')} ` +
                                `zoom ${seen.zoom.toFixed(3)} vs sentinel ` +
                                `${CAMERA_SENTINEL.center.join(',')} zoom ${CAMERA_SENTINEL.zoom}`
                        );
                    if (seen.moves !== 0)
                        problems.push(`${seen.moves} camera move(s) fired during the restore`);

                    const note =
                        `seeded ${JSON.stringify(visSeed)}; ` +
                        `route ${wantRouteVis === seen.route ? 'ok' : 'BAD'} (${seen.route}), ` +
                        `check-ins ${seen.checkins === null ? 'absent in prod data' : seen.checkins}, ` +
                        `row ${row.found ? `checked=${row.checked}` : `not rendered (${row.rows} rows)`}, ` +
                        `camera before ${CAMERA_SENTINEL.center.join(',')}@${CAMERA_SENTINEL.zoom} ` +
                        `after ${seen.center.map((n) => n.toFixed(4)).join(',')}@${seen.zoom.toFixed(3)} ` +
                        `moves=${seen.moves}` +
                        (early.alreadyRestored
                            ? ' [WARN restore had already landed before the recorder attached]'
                            : '');

                    if (problems.length) bad(16, L16, `${problems.join('; ')} — ${note}`);
                    else pass(16, L16, note);
                }
                await visCtx.close();
            }
        } catch (e) {
            bad(16, L16, String(e.message).split('\n')[0]);
        }
    } finally {
        await browser.close();
    }

    console.log('-'.repeat(78));
    console.log(`RESULT: ${passed}/${TOTAL} assertions passed`);
    if (passed !== TOTAL) process.exitCode = 1;
}

main().catch((e) => {
    console.log(`ERROR: probe aborted — ${String(e && e.message).split('\n')[0]}`);
    console.log('-'.repeat(78));
    console.log(`RESULT: ${passed}/${TOTAL} assertions passed`);
    process.exitCode = 1;
});
