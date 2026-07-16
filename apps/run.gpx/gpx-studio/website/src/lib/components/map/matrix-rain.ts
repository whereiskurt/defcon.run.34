// apps/run.gpx/gpx-studio/website/src/lib/components/map/matrix-rain.ts
/**
 * Matrix digital-rain + green tint overlay for ghost mode. Ported from
 * apps/static/landing/index.html, recolored to matrix-green. Mounts a fixed
 * full-viewport canvas over the map (pointer-events:none) plus a tint layer.
 * User-triggered easter egg → if reduced-motion, show the static tint but no
 * animated rain (lesson from cash-rain: a hard reduced-motion gate made a
 * user-triggered effect invisible in prod).
 */
const GREEN = '#00ff41';
const GLYPHS = '01</>{}[]#$ラ ンドセキュ▚▞◆·'.split('');

export class MatrixRain {
    private canvas: HTMLCanvasElement | null = null;
    private tint: HTMLDivElement | null = null;
    private raf = 0;
    private running = false;
    private drops: number[] = [];
    private cols = 0; private w = 0; private h = 0; private dpr = 1;
    private last = 0;
    private readonly fontSize = 15;
    private readonly reduce = typeof window !== 'undefined'
        && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    constructor(private parent: HTMLElement) {}

    private resize = () => {
        if (!this.canvas) return;
        this.dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.w = this.canvas.width = Math.floor(innerWidth * this.dpr);
        this.h = this.canvas.height = Math.floor(innerHeight * this.dpr);
        this.canvas.style.width = innerWidth + 'px';
        this.canvas.style.height = innerHeight + 'px';
        this.cols = Math.floor(innerWidth / this.fontSize);
        this.drops = new Array(this.cols).fill(0).map(() => Math.random() * -50);
    };

    private draw = (ts: number) => {
        const c = this.canvas; if (!c) return;
        const ctx = c.getContext('2d'); if (!ctx) return;
        if (ts - this.last > 55) {
            this.last = ts;
            ctx.fillStyle = 'rgba(0, 8, 2, 0.28)';
            ctx.fillRect(0, 0, this.w, this.h);
            ctx.font = (this.fontSize * this.dpr) + "px 'JetBrains Mono', monospace";
            for (let i = 0; i < this.cols; i++) {
                const txt = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
                const x = i * this.fontSize * this.dpr;
                const y = this.drops[i] * this.fontSize * this.dpr;
                ctx.fillStyle = Math.random() > 0.975 ? '#ffffff' : GREEN;
                ctx.fillText(txt, x, y);
                if (y > this.h && Math.random() > 0.975) this.drops[i] = Math.random() * -20;
                this.drops[i]++;
            }
        }
        this.raf = requestAnimationFrame(this.draw);
    };

    start() {
        if (this.running) return;
        this.running = true;
        this.tint = document.createElement('div');
        this.tint.className = 'dc34-matrix-tint';
        this.parent.appendChild(this.tint);
        requestAnimationFrame(() => this.tint?.classList.add('on'));
        if (this.reduce) return; // static tint only
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'dc34-matrix-canvas';
        this.parent.appendChild(this.canvas);
        this.resize();
        addEventListener('resize', this.resize);
        requestAnimationFrame(() => this.canvas?.classList.add('on'));
        this.raf = requestAnimationFrame(this.draw);
    }

    stop() {
        if (!this.running) return;
        this.running = false;
        cancelAnimationFrame(this.raf); this.raf = 0;
        removeEventListener('resize', this.resize);
        this.canvas?.remove(); this.canvas = null;
        this.tint?.remove(); this.tint = null;
    }
}
