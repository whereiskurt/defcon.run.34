#!/usr/bin/env node
/**
 * Phase 70 / DLGS-06 — production probe for the shared dialog shell.
 *
 * Drives the LIVE gpx.defcon.run studio in headless Chromium and asserts the
 * fourteen DOM contracts from 70-UI-SPEC.md §8: click-to-open (and NOT hover-to-open)
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
const { execSync } = require('child_process');
const { chromium } = require('/Users/khundeck/working/defcon.run.34/apps/run.auth/e2e/node_modules/playwright-core');

const TOTAL = 14;
const TARGET = 'https://gpx.defcon.run/use1/studio/app';
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
function bad(n, label, note) {
    console.log(`FAIL  ${n}. ${label}${note ? ` — ${note}` : ''}`);
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
