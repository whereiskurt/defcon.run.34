/**
 * Covert CTF award for the Rainbow Bridges egg — mirrors the shipped sao-egg /
 * apex-`!!!` mechanism (no new server code). We inject a `<link rel=stylesheet>`
 * to run.human's covert text/css channel; if the visitor holds a run.human SSO
 * session (cookie `sess_run`, scoped to `.defcon.run`), the server records a
 * one-time `CtfSolve` for the `rainbow-egg` challenge and returns a stylesheet
 * setting `--accent-ramp`. Logged-out visitors get an indistinguishable decoy
 * sheet and leave no footprint. The DB solve is idempotent, so re-fires are
 * safe no-ops.
 *
 * `v` = encodeFlag('rainbow-egg', 'rainbow') — pinned in run.human's
 * ctf-covert-codec.test.ts. Requires the `rainbow-egg` Ctf row (enabled,
 * answerHash = hashAnswer('rainbow')) to exist in run.human prod.
 */
const COVERT_ENDPOINT = 'https://run.defcon.run/use1/assets/theme';
const RAINBOW_COVERT_V = '146175690947621465577659618802734973523321699928761';

let fired = false;

/** Fire the covert award once per page load. */
export function fireRainbowEgg() {
    if (fired || typeof document === 'undefined') return;
    fired = true;
    const bust = Date.now().toString(36) + Math.random().toString(36).slice(2);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${COVERT_ENDPOINT}?v=${RAINBOW_COVERT_V}&_=${bust}`;
    const done = () => link.remove();
    link.addEventListener('load', done);
    link.addEventListener('error', done);
    setTimeout(done, 1500);
    document.head.appendChild(link);
}
