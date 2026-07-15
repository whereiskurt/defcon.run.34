/** Escape a string for safe interpolation into popup innerHTML. Mirrors the
 * local helper in public-overlays.ts — shared by the ghost/rabbit map layers,
 * whose popups render user-controlled values (displayName, etc.) via setHTML. */
export function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
    );
}
