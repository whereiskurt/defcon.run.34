/**
 * "Decrypt" text reveal — the ghost-mode popup effect. Takes an element whose
 * textContent is the final string, then scrambles it with random glyphs and
 * resolves left-to-right over ~600ms, so a name materializes as if descrambled.
 *
 * Purely cosmetic and self-contained: it only rewrites textContent (never HTML,
 * so it can't inject markup) and no-ops when the user prefers reduced motion.
 */
const GLYPHS = '!<>-_\\/[]{}—=+*^?#01ﾊﾋﾃﾉ§▓░'.split('');

function prefersReducedMotion(): boolean {
    return (
        typeof matchMedia !== 'undefined' &&
        matchMedia('(prefers-reduced-motion: reduce)').matches
    );
}

function randGlyph(): string {
    // No Math.random gate here (this is browser code, not a workflow script).
    return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
}

export function decryptReveal(el: HTMLElement, durationMs = 620): void {
    const target = el.textContent ?? '';
    if (!target || prefersReducedMotion() || typeof requestAnimationFrame === 'undefined') return;

    const start = performance.now();
    el.classList.add('dc34-decrypting');

    const tick = (now: number) => {
        const t = Math.min(1, (now - start) / durationMs);
        // How many characters have "locked in" so far (left-to-right).
        const locked = Math.floor(t * target.length);
        let out = '';
        for (let i = 0; i < target.length; i++) {
            const ch = target[i];
            out += i < locked || ch === ' ' ? ch : randGlyph();
        }
        el.textContent = out;
        if (t < 1) {
            requestAnimationFrame(tick);
        } else {
            el.textContent = target;
            el.classList.remove('dc34-decrypting');
        }
    };
    requestAnimationFrame(tick);
}
