/**
 * Covert CTF award for the B-Sides shuttle layer — mirrors the shipped
 * rainbow-egg / deuce-egg / kph-egg mechanism (no new server code). We inject a
 * `<link rel=stylesheet>` to run.human's covert text/css channel; if the visitor
 * holds a run.human SSO session (cookie `sess_run`, scoped to `.defcon.run`),
 * the server records a one-time `CtfSolve` for the `bsides-shuttle` challenge.
 * Logged-out visitors get an indistinguishable decoy sheet and leave no
 * footprint. The DB solve is idempotent, so re-fires are safe no-ops.
 *
 * `v` = encodeFlag('bsides-shuttle', 'bsides') — computed with run.human's
 * ctf-covert-codec and cross-checked against the known-good shipped deuce-egg
 * and kph-phone values. Requires the `bsides-shuttle` Ctf row (enabled,
 * answerHash = hashAnswer('bsides')) to exist in run.human prod, else the
 * covert hit is a harmless decoy.
 */
const COVERT_ENDPOINT = 'https://run.defcon.run/use1/assets/theme';
const BSIDES_COVERT_V = '9580199438190287796513706166079891499691313634242699531';

let fired = false;

/** Fire the covert award once per page load. */
export function fireShuttleEgg() {
    if (fired || typeof document === 'undefined') return;
    fired = true;
    const bust = Date.now().toString(36) + Math.random().toString(36).slice(2);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${COVERT_ENDPOINT}?v=${BSIDES_COVERT_V}&_=${bust}`;
    const done = () => link.remove();
    link.addEventListener('load', done);
    link.addEventListener('error', done);
    setTimeout(done, 1500);
    document.head.appendChild(link);
}
