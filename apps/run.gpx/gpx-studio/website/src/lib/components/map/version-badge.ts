/**
 * A small always-visible build stamp in the map's bottom-left corner.
 *
 * WHY: when a runner says "the map isn't working", a stale cached bundle and a
 * real bug are indistinguishable over chat. Asking "what does the corner say?"
 * separates them in one message — if it is behind the current release, it is a
 * refresh, not a defect.
 *
 * The version is stamped in by `build-frontend.sh` from the webapp's VERSION
 * file. `import.meta.env` is used rather than `$env/static/public` on purpose:
 * an unset PUBLIC_ var makes SvelteKit fail the whole build (that is exactly how
 * PUBLIC_MAPBOX_TOKEN behaves), whereas an unset VITE_ var is simply undefined,
 * so a local build without the stamp still works and reads "dev".
 */
const VERSION: string =
    (import.meta.env?.VITE_APP_VERSION as string | undefined) || 'dev';

const ID = 'dc34-version-badge';

/** The version this bundle was built from, e.g. "v0.0.129" or "dev". */
export function studioVersion(): string {
    return VERSION;
}

/**
 * Mount the badge into the map container. Idempotent — a second call is a no-op,
 * so it is safe to call from a load handler that may fire more than once.
 */
export function mountVersionBadge(container: HTMLElement): void {
    if (typeof document === 'undefined') return;
    if (document.getElementById(ID)) return;
    const el = document.createElement('div');
    el.id = ID;
    el.className = 'dc34-version-badge';
    el.textContent = `gpx ${VERSION}`;
    el.title = `gpx.defcon.run build ${VERSION} — quote this when reporting a problem`;
    container.appendChild(el);
    // Also in the console, where a technical reporter will look first.
    console.info(`[defcon.run] gpx studio ${VERSION}`);
}
