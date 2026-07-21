import { writable } from 'svelte/store';

/** Bump to make the My DEF CON Runs layer re-fetch its manifest (post-import / re-tag). */
export const myConRunsRefresh = writable<number>(0);

export function refreshMyConRuns(): void {
    myConRunsRefresh.update((n) => n + 1);
}
