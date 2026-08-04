/**
 * Covert CTF award for the secret KPH payphone — mirrors the shipped
 * rainbow-egg / deuce-egg / sao-egg mechanism (no new server code). We inject a
 * `<link rel=stylesheet>` to run.human's covert text/css channel; if the visitor
 * holds a run.human SSO session (cookie `sess_run`, scoped to `.defcon.run`),
 * the server records a one-time `CtfSolve` for the `kph-phone` challenge and
 * returns a stylesheet setting `--accent-ramp`. Logged-out visitors get an
 * indistinguishable decoy sheet and leave no footprint. The DB solve is
 * idempotent, so re-fires are safe no-ops.
 *
 * `v` = encodeFlag('kph-phone', 'kph') — cross-checked against the known-good
 * shipped rainbow-egg and deuce-egg values with run.human's ctf-covert-codec.
 * Requires the `kph-phone` Ctf row (enabled, answerHash = hashAnswer('kph'),
 * 250 points) to exist in run.human prod — without it the fire is a decoy no-op.
 */
const COVERT_ENDPOINT = 'https://run.defcon.run/use1/assets/theme';
const KPH_COVERT_V = '519304316278516300587786913994762451';

let fired = false;

/** Fire the covert award once per page load. */
export function fireKphEgg() {
    if (fired || typeof document === 'undefined') return;
    fired = true;
    const bust = Date.now().toString(36) + Math.random().toString(36).slice(2);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${COVERT_ENDPOINT}?v=${KPH_COVERT_V}&_=${bust}`;
    const done = () => link.remove();
    link.addEventListener('load', done);
    link.addEventListener('error', done);
    setTimeout(done, 1500);
    document.head.appendChild(link);
}
