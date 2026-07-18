/**
 * Covert CTF award for the PublicUs coffee cup — mirrors the shipped
 * rainbow-egg / sao-egg / apex-`!!!` mechanism (no new server code). We inject a
 * `<link rel=stylesheet>` to run.human's covert text/css channel; if the visitor
 * holds a run.human SSO session (cookie `sess_run`, scoped to `.defcon.run`),
 * the server records a one-time `CtfSolve` for the `coffee-egg` challenge.
 * Logged-out visitors get an indistinguishable decoy sheet and leave no
 * footprint. The DB solve is idempotent, so re-fires are safe no-ops.
 *
 * `v` = encodeFlag('coffee-egg', 'coffee') — verified against run.human's
 * ctf-covert-codec (the rainbow known-value cross-checks). Requires the
 * `coffee-egg` Ctf row (enabled, answerHash = hashAnswer('coffee')) to exist in
 * run.human prod, else the covert hit is a harmless decoy.
 */
const COVERT_ENDPOINT = 'https://run.defcon.run/use1/assets/theme';
const COFFEE_COVERT_V = '2230428019419328496265843840902740576556784501';

let fired = false;

/** Fire the covert award once per page load. */
export function fireCoffeeEgg() {
    if (fired || typeof document === 'undefined') return;
    fired = true;
    const bust = Date.now().toString(36) + Math.random().toString(36).slice(2);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${COVERT_ENDPOINT}?v=${COFFEE_COVERT_V}&_=${bust}`;
    const done = () => link.remove();
    link.addEventListener('load', done);
    link.addEventListener('error', done);
    setTimeout(done, 1500);
    document.head.appendChild(link);
}
