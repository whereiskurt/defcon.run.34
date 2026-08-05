/**
 * Building the "Connect Strava" hand-off URL.
 *
 * Extracted because two components now need it: the Strava strip's unlinked
 * empty state (which had this inline) and the Record Activity screen's Strava
 * door, which offers "Connect Strava" to anyone who hasn't linked yet.
 *
 * Pure — no svelte, no DOM reads. Callers pass `location.pathname` in. That
 * keeps it unit-testable from the run.gpx webapp's vitest, which is the only
 * test runner that can see this package.
 */

/**
 * The region prefix the studio is served under ("/use1" from
 * "/use1/studio/app"), or "" in local dev where there is no prefix.
 * auth.defcon.run needs the same prefix, so it can't be hardcoded.
 */
export function regionPrefix(pathname: string): string {
    const i = pathname.indexOf('/studio');
    return i > 0 ? pathname.slice(0, i) : '';
}

/**
 * Where to send someone to link Strava, and where they land afterwards.
 *
 * `returnTo` is the fix for a dead end: `/strava` hardcoded
 * `signIn('strava', { callbackUrl: '/' })`, so a runner who tapped Connect
 * Strava while logging a run finished OAuth on auth.defcon.run's HOMEPAGE — in
 * a tab they had opened to add a run, with no way back. The auth app validates
 * this parameter against a defcon.run allowlist before honouring it.
 *
 * `autoLink` is an existing parameter on that page: it starts the OAuth
 * redirect immediately instead of showing a second "Link Strava" button. We only
 * ever send unlinked runners here, and the page no-ops the auto-start for anyone
 * who turns out to already be linked.
 */
export function stravaConnectUrl(pathname: string, returnTo: string): string {
    const prefix = regionPrefix(pathname);
    const params = new URLSearchParams({ autoLink: '', returnTo });
    return `https://auth.defcon.run${prefix}/strava?${params.toString()}`;
}

/**
 * The URL that reopens Record Activity where the runner left it, used as the
 * `returnTo` above. `?addrun` is the existing deep link from run.defcon.run and
 * now lands directly on Record Activity.
 */
export function addRunReturnUrl(origin: string, pathname: string): string {
    return `${origin}${pathname}?addrun`;
}
