/**
 * Covert CTF award for the Deuce bus layer — mirrors the shipped rainbow-egg /
 * coffee-egg / sao-egg mechanism (no new server code). We inject a
 * `<link rel=stylesheet>` to run.human's covert text/css channel; if the
 * visitor holds a run.human SSO session (cookie `sess_run`, scoped to
 * `.defcon.run`), the server records a one-time `CtfSolve` for the `deuce-egg`
 * challenge. Logged-out visitors get an indistinguishable decoy sheet and
 * leave no footprint. The DB solve is idempotent, so re-fires are safe no-ops.
 *
 * `v` = encodeFlag('deuce-egg', 'deuce') — computed with run.human's
 * ctf-covert-codec (coffee known-value cross-checks). Requires the `deuce-egg`
 * Ctf row (enabled, answerHash = hashAnswer('deuce')) to exist in run.human
 * prod, else the covert hit is a harmless decoy.
 */
const COVERT_ENDPOINT = 'https://run.defcon.run/use1/assets/theme';
const DEUCE_COVERT_V = '34033113387199996362143627065331898045316';

let fired = false;

/** Fire the covert award once per page load. */
export function fireDeuceEgg() {
    if (fired || typeof document === 'undefined') return;
    fired = true;
    const bust = Date.now().toString(36) + Math.random().toString(36).slice(2);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${COVERT_ENDPOINT}?v=${DEUCE_COVERT_V}&_=${bust}`;
    const done = () => link.remove();
    link.addEventListener('load', done);
    link.addEventListener('error', done);
    setTimeout(done, 1500);
    document.head.appendChild(link);
}
