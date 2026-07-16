/**
 * Small on-map countdown to the next layer refresh — a depleting ring + "Ns"
 * so the periodic "jump" of the rabbits is telegraphed instead of surprising.
 * Owned by the polling layer: start() on show, reset() on each poll, stop() on hide.
 */
const R = 14;
const CIRC = 2 * Math.PI * R;

export class RefreshCue {
    private el: HTMLDivElement | null = null;
    private prog: SVGCircleElement | null = null;
    private label: HTMLSpanElement | null = null;
    private raf = 0;
    private startMs = 0;

    constructor(private parent: HTMLElement, private periodMs: number, private text = 'rabbits') {}

    start() {
        if (this.el) return;
        this.el = document.createElement('div');
        this.el.className = 'dc34-refresh-cue';
        this.el.innerHTML =
            `<svg viewBox="0 0 32 32" aria-hidden="true">` +
            `<circle class="track" cx="16" cy="16" r="${R}"></circle>` +
            `<circle class="prog" cx="16" cy="16" r="${R}"></circle></svg>` +
            `<span class="lbl"></span>`;
        this.parent.appendChild(this.el);
        this.prog = this.el.querySelector('.prog');
        this.label = this.el.querySelector('.lbl');
        if (this.prog) this.prog.style.strokeDasharray = String(CIRC);
        this.reset();
        this.raf = requestAnimationFrame(this.tick);
    }

    /** Call on every successful poll to restart the countdown. */
    reset() {
        this.startMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    }

    private tick = () => {
        if (!this.el) return;
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const frac = Math.min(1, (now - this.startMs) / this.periodMs);
        const remaining = Math.max(0, Math.ceil((this.periodMs * (1 - frac)) / 1000));
        if (this.prog) this.prog.style.strokeDashoffset = String(CIRC * frac);
        if (this.label) this.label.textContent = `${this.text} ↻ ${remaining}s`;
        this.raf = requestAnimationFrame(this.tick);
    };

    stop() {
        cancelAnimationFrame(this.raf); this.raf = 0;
        this.el?.remove(); this.el = null; this.prog = null; this.label = null;
    }
}
