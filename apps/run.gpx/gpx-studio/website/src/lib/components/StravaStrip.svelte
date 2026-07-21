<script lang="ts">
    // Strava strip (2026-07-21 spec) — bottom-docked, collapsible carousel of the
    // runner's last-7-days Strava activities. Tapping an unimported card opens an
    // in-strip con-day popover; importing lands the run on the map exactly like the
    // Upload door and bumps the My DEF CON Runs layer to re-fetch.
    import { tick, onDestroy } from 'svelte';
    import { get } from 'svelte/store';
    import mapboxgl from 'mapbox-gl';
    import { map } from '$lib/components/map/map';
    import { isAuthenticated, hasGpxStudioAccess, hasStrava, isAdmin } from '$lib/stores/auth';
    import { getConDayUsage, updateCloudFile, type ConDayUsage } from '$lib/cloud-sync';
    import {
        fetchStravaActivities,
        importStravaActivity,
        syncNowStrava,
        StravaSyncError,
        type StripActivity,
    } from '$lib/logic/strava-import';
    import {
        decodePolyline,
        polylineToSvgPath,
        guessConDay,
        formatKm,
        isUnlimitedQuota,
    } from '$lib/logic/strava-strip-pure';
    import { stravaStripExpanded, stravaStripHidden, stravaStripPulse } from '$lib/stores/strava-strip';
    import { refreshMyConRuns } from '$lib/stores/my-con-runs';
    import { ChevronDown, ChevronLeft, ChevronRight, RefreshCw, LoaderCircle, Check, X, Zap } from '@lucide/svelte';

    // Escape user-controlled text (Strava activity name) before it lands in a
    // mapboxgl popup's setHTML() — that's raw HTML insertion, same risk as
    // {@html} in the Svelte template. Mirrors map/my-con-runs.ts's helper.
    function escapeHtml(s: string): string {
        return s.replace(
            /[&<>"']/g,
            (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
        );
    }

    /** Small mapbox popup for a just-imported/tagged Strava run, styled like the
     * existing route popups (map/my-con-runs.ts, map/public-overlays.ts): a
     * border-left color bar, an eyebrow, the name, then a meta row. */
    function trackPopupHtml(a: StripActivity, dayLabel: string | null): string {
        return `
            <div style="min-width:180px;max-width:260px;padding:10px 12px;border-left:4px solid #fc4c02;
                        font-family:system-ui,sans-serif;color:#e4e4ef">
                <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;opacity:.55">Strava import</div>
                <div style="font-size:15px;font-weight:600;margin-top:2px">${escapeHtml(a.name)}</div>
                <div style="font-size:12px;opacity:.85;margin-top:6px;line-height:1.6">
                    📅 ${escapeHtml(formatCardDate(a.startDateLocal))}<br>
                    📏 ${escapeHtml(formatKm(a.distanceMeters))}<br>
                    🏁 ${dayLabel ? escapeHtml(dayLabel) : 'No day assigned'}
                </div>
            </div>`;
    }

    // The studio is served under the region basePath (e.g. /use1/studio/app) but
    // auth.defcon.run needs the region prefix too — derive it the same way
    // public-overlays.ts does: everything before '/studio' in the current path.
    function regionPrefix(): string {
        if (typeof location === 'undefined') return '';
        const i = location.pathname.indexOf('/studio');
        return i > 0 ? location.pathname.slice(0, i) : '';
    }

    const canShow = $derived($isAuthenticated && $hasGpxStudioAccess);

    let activities = $state<StripActivity[]>([]);
    let weeks = $state(1);
    let usage = $state<ConDayUsage[]>([]);
    let loading = $state(false);
    let loadedOnce = $state(false);
    let error = $state<string | null>(null);

    let rootEl = $state<HTMLDivElement>();
    let carouselEl = $state<HTMLDivElement>();
    let canLeft = $state(false);
    let canRight = $state(false);

    let openActivityId = $state<number | null>(null);
    let selectedDay = $state<string | null>(null);
    let popoverMode = $state<'import' | 'assign'>('import');
    let confirming = $state(false);
    let popoverError = $state<string | null>(null);
    let successMessage = $state<string | null>(null);
    let syncingNow = $state(false);

    let pulsing = $state(false);

    const openActivity = $derived(activities.find((a) => a.id === openActivityId) ?? null);
    const selectedUsage = $derived(usage.find((u) => u.date === selectedDay) ?? null);
    const capped = $derived(!!selectedUsage && selectedUsage.remaining <= 0);

    async function loadStrip() {
        if (!$hasStrava) return;
        loading = true;
        error = null;
        try {
            const [res, u] = await Promise.all([fetchStravaActivities(), getConDayUsage()]);
            activities = res.activities;
            weeks = res.weeks;
            usage = u;
        } catch (e) {
            error = e instanceof Error ? e.message : 'Could not load Strava activities';
        } finally {
            loading = false;
            loadedOnce = true;
        }
    }

    // Fetching costs a unit of the lifetime strava_sync quota, so it must only
    // ever happen from explicit user intent — never from an $effect reacting to
    // canShow/expanded/hasStrava. The three triggers are: (1) the chevron below,
    // on the transition to expanded; (2) the hub pulse handler further down; and
    // (3) the "Show my recent activity" fallback button in the body for runners whose
    // persisted state is already expanded.
    function toggleExpanded() {
        const next = !$stravaStripExpanded;
        stravaStripExpanded.set(next);
        if (next && $hasStrava && !loadedOnce && !loading) {
            void loadStrip();
        }
    }

    // Re-measure the carousel scroll state whenever its content (or mount state) changes.
    $effect(() => {
        void activities.length;
        if (carouselEl) {
            void tick().then(updateScrollState);
        }
    });

    function updateScrollState() {
        const el = carouselEl;
        if (!el) {
            canLeft = false;
            canRight = false;
            return;
        }
        canLeft = el.scrollLeft > 4;
        canRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    }

    function scrollCarousel(dir: 1 | -1) {
        const el = carouselEl;
        if (!el) return;
        el.scrollBy({ left: dir * el.clientWidth, behavior: 'smooth' });
    }

    function shortDate(date: string): string {
        return new Date(date + 'T12:00:00').toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
        });
    }

    function formatCardDate(startDateLocal: string): string {
        return new Date(startDateLocal.slice(0, 10) + 'T12:00:00').toLocaleDateString(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
        });
    }

    function weekdayShort(conDay: string): string {
        return new Date(conDay + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' });
    }

    // conDay is a string once tagged, null when imported-but-untagged, and
    // absent (undefined) when the activity was never imported at all.
    function isTagged(a: StripActivity): boolean {
        return !!a.imported && a.conDay !== null && a.conDay !== undefined;
    }

    function isUntaggedImport(a: StripActivity): boolean {
        return !!a.imported && (a.conDay === null || a.conDay === undefined);
    }

    // Tagged imports are inert — reassignment stays in the My Maps "Save as
    // defcon.run Activity" dialog. Untagged imports reopen this SAME popover in
    // 'assign' mode; fresh (unimported) activities open it in 'import' mode.
    function openPopover(a: StripActivity) {
        if (isTagged(a)) return;
        openActivityId = a.id;
        popoverMode = a.imported ? 'assign' : 'import';
        popoverError = null;
        selectedDay = guessConDay(
            a.startDateLocal,
            usage.map((u) => u.date)
        );
    }

    function closePopover() {
        openActivityId = null;
        popoverError = null;
    }

    // The imported/tagged run lands on the map as an editable gpx-studio file
    // (fix 3, 2026-07-21 UAT). Wiring a click-popup into that file's own map
    // click handler (GPXLayer.layerOnClick in map/gpx-layer/gpx-layer.ts) would
    // mean bridging fileId → cloudFileId → CloudFile.conDay (no such lookup
    // exists today — only auto-save.ts's per-file CloudLinkedFile, which has no
    // conDay) inside that handler's already-dense tool/selection branching —
    // genuinely invasive for a UAT fix. Fallback (per spec): show the popup
    // once, right when the import/assign action completes, anchored to the
    // activity's own polyline (already decoded for the card's SVG preview, so
    // no dependency on the map's rendered layer at all).
    let trackPopup: mapboxgl.Popup | null = null;

    function showImportedTrackPopup(a: StripActivity, dayLabel: string | null) {
        const mapInstance = get(map);
        const points = decodePolyline(a.summaryPolyline);
        if (!mapInstance || points.length === 0) return;
        const [lat, lng] = points[Math.floor(points.length / 2)];
        trackPopup?.remove();
        trackPopup = new mapboxgl.Popup({
            closeButton: true,
            closeOnClick: true,
            maxWidth: '280px',
            offset: 12,
            className: 'dc34-route-popup',
        })
            .setLngLat([lng, lat])
            .setHTML(trackPopupHtml(a, dayLabel))
            .addTo(mapInstance);
    }

    async function confirmPopover() {
        const a = openActivity;
        if (!a || !selectedDay) return;
        confirming = true;
        popoverError = null;
        const day = selectedDay;
        try {
            if (popoverMode === 'assign') {
                if (!a.fileId) {
                    // Server contract says imported cards always carry fileId;
                    // if it's ever missing, tell the runner instead of no-oping.
                    popoverError = 'Missing file id — refresh the strip and try again';
                    return;
                }
                // Purely the PUT — no strip re-fetch, no Strava quota touched.
                await updateCloudFile(a.fileId, { conDay: day });
                activities = activities.map((act) => (act.id === a.id ? { ...act, conDay: day } : act));
            } else {
                await importStravaActivity(a.id, day);
                activities = activities.map((act) =>
                    act.id === a.id ? { ...act, imported: true, conDay: day } : act
                );
            }
            const label = usage.find((u) => u.date === day)?.label ?? 'that day';
            usage = usage.map((u) => (u.date === day ? { ...u, remaining: u.remaining - 1 } : u));
            openActivityId = null;
            refreshMyConRuns();
            showImportedTrackPopup(a, label);
            successMessage =
                popoverMode === 'assign'
                    ? `Tagged for ${label}.`
                    : `Imported! It's on the map for ${label}.`;
            clearTimeout(successTimeout);
            successTimeout = setTimeout(() => {
                successMessage = null;
            }, 4000);
        } catch (e) {
            // Keep the popover (and its con-day chips) open so the runner can pick
            // another day when a StravaSyncError (or the PUT's 429 target-day-full
            // Error) reports quota/cap trouble.
            popoverError =
                e instanceof StravaSyncError || e instanceof Error
                    ? e.message
                    : popoverMode === 'assign'
                      ? 'Could not save day'
                      : 'Import failed';
        } finally {
            confirming = false;
        }
    }

    async function doSyncNow() {
        // An explicit user action — allowed to re-run loadStrip() on success (a
        // deliberate refresh) even though fetches otherwise never happen from
        // reactive effects. Also surface the toast/error even if the strip is
        // currently collapsed.
        if (!$stravaStripExpanded) stravaStripExpanded.set(true);
        syncingNow = true;
        error = null;
        try {
            const result = await syncNowStrava();
            await loadStrip();
            refreshMyConRuns();
            successMessage = `Synced ${result.imported} new run${result.imported === 1 ? '' : 's'} (${result.skipped} skipped) · ${result.remainingToday} sync${result.remainingToday === 1 ? '' : 's'} left today`;
            clearTimeout(successTimeout);
            successTimeout = setTimeout(() => {
                successMessage = null;
            }, 4000);
        } catch (e) {
            error = e instanceof StravaSyncError || e instanceof Error ? e.message : 'Strava sync failed';
        } finally {
            syncingNow = false;
        }
    }

    let successTimeout: ReturnType<typeof setTimeout> | undefined;
    let pulseTimeout: ReturnType<typeof setTimeout> | undefined;

    // One-shot attention pulse from the QuickStart hub's "From Strava" hand-off:
    // scroll the strip into view and flash a brief Strava-orange ring.
    let lastPulse = 0;
    const unsubscribePulse = stravaStripPulse.subscribe((n) => {
        if (n === lastPulse) return;
        lastPulse = n;
        queueMicrotask(() => rootEl?.scrollIntoView({ block: 'nearest' }));
        pulsing = true;
        clearTimeout(pulseTimeout);
        pulseTimeout = setTimeout(() => {
            pulsing = false;
        }, 1200);
        // openStravaStrip() already force-expanded the strip before bumping this
        // pulse — fetch now, once, if we haven't already.
        if (canShow && $hasStrava && !loadedOnce && !loading) {
            void loadStrip();
        }
    });

    onDestroy(() => {
        unsubscribePulse();
        clearTimeout(pulseTimeout);
        clearTimeout(successTimeout);
        trackPopup?.remove();
    });
</script>

{#if canShow && !$stravaStripHidden}
    <div
        bind:this={rootEl}
        class="absolute bottom-2 left-2 right-2 z-30 rounded-xl border bg-background/90 backdrop-blur transition-shadow {pulsing
            ? 'ring-2 ring-[#fc4c02]'
            : ''}"
    >
        <div class="flex items-center gap-2 px-3 py-2">
            <button
                type="button"
                class="shrink-0 rounded-md p-2 text-muted-foreground transition hover:bg-accent"
                aria-label="Hide Strava strip"
                title="Hide — reopen via Add run → From Strava"
                onclick={() => stravaStripHidden.set(true)}
            >
                <X size={14} />
            </button>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" class="shrink-0">
                <path
                    fill="#fc4c02"
                    d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066M13.828 10.172L11.769 6.02l-4.14 8.1H4.564L11.769 0l3.939 7.856h3.066"
                />
            </svg>
            <span class="text-sm font-semibold"
                >From Strava · {loadedOnce && weeks > 1 ? `last ${weeks} weeks` : 'last 7 days'}</span
            >
            {#if loadedOnce && !error}
                <span class="rounded-full bg-accent px-2 py-0.5 text-xs text-muted-foreground"
                    >{activities.length}</span
                >
            {/if}
            <div class="ml-auto flex items-center gap-1">
                {#if $hasStrava}
                    <button
                        type="button"
                        class="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-muted-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="Sync now"
                        disabled={syncingNow}
                        onclick={() => void doSyncNow()}
                    >
                        {#if syncingNow}
                            <LoaderCircle size={14} class="animate-spin" />
                        {:else}
                            <Zap size={14} />
                        {/if}
                        Sync now
                    </button>
                {/if}
                {#if $stravaStripExpanded && $hasStrava}
                    <button
                        type="button"
                        class="rounded-md p-1 text-muted-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="Refresh"
                        disabled={loading}
                        onclick={() => void loadStrip()}
                    >
                        <RefreshCw size={16} class={loading ? 'animate-spin' : ''} />
                    </button>
                {/if}
                <button
                    type="button"
                    class="rounded-md p-1 text-muted-foreground transition hover:bg-accent"
                    aria-label={$stravaStripExpanded ? 'Collapse' : 'Expand'}
                    onclick={toggleExpanded}
                >
                    <ChevronDown
                        size={16}
                        class="transition-transform {$stravaStripExpanded ? 'rotate-180' : ''}"
                    />
                </button>
            </div>
        </div>

        {#if $stravaStripExpanded}
            <div class="border-t px-3 pb-3 pt-2">
                {#if !$hasStrava}
                    <div class="rounded-lg border border-dashed p-4 text-center">
                        <p class="text-sm text-muted-foreground">
                            Link your Strava account to import your recent activity onto the
                            map.
                        </p>
                        <button
                            class="mt-3 inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white transition hover:brightness-110"
                            style="background:#fc4c02"
                            onclick={() =>
                                (window.location.href =
                                    'https://auth.defcon.run' + regionPrefix() + '/strava')}
                        >
                            Connect Strava
                        </button>
                        <p class="mt-2 text-xs text-muted-foreground">
                            Just linked? Give it a minute and hit refresh.
                        </p>
                    </div>
                {:else if loading && !loadedOnce}
                    <div class="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                        <LoaderCircle size={16} class="animate-spin" /> Loading your recent activity…
                    </div>
                {:else if !loadedOnce && !loading && !error}
                    <div class="rounded-lg border border-dashed p-4 text-center">
                        <p class="text-sm text-muted-foreground">
                            Load your recent Strava activity onto the map.
                        </p>
                        <button
                            class="mt-3 inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white transition hover:brightness-110"
                            style="background:#fc4c02"
                            onclick={() => void loadStrip()}
                        >
                            Show my recent activity
                        </button>
                    </div>
                {:else if error}
                    <div
                        class="flex items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                    >
                        <span>{error}</span>
                        <button
                            class="shrink-0 rounded-md border px-2 py-1 text-xs font-semibold transition hover:bg-accent"
                            onclick={() => void loadStrip()}
                        >
                            Retry
                        </button>
                    </div>
                {:else if activities.length === 0}
                    <p class="py-4 text-center text-sm text-muted-foreground">
                        No activities in the last {weeks > 1 ? `${weeks} weeks` : '7 days'}.
                    </p>
                {:else}
                    {#if openActivity}
                        <div class="mb-2 rounded-lg border bg-accent/30 p-3">
                            <div class="flex items-start justify-between gap-2">
                                <div>
                                    <p class="text-sm font-semibold">{openActivity.name}</p>
                                    <p class="text-xs text-muted-foreground">
                                        {formatKm(openActivity.distanceMeters)}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    class="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent"
                                    aria-label="Cancel"
                                    onclick={closePopover}
                                >
                                    <X size={16} />
                                </button>
                            </div>

                            <p class="mb-1.5 mt-3 text-xs font-medium text-muted-foreground">
                                {popoverMode === 'assign' ? 'Which DEF CON day is this run for?' : 'Which day?'}
                            </p>
                            <div class="flex flex-wrap gap-1.5">
                                {#each usage as day (day.date)}
                                    <button
                                        class="rounded-full border px-3 py-1 text-sm transition {selectedDay ===
                                        day.date
                                            ? 'border-[#fc4c02] bg-[#fc4c02] text-white'
                                            : 'hover:bg-accent'} {day.remaining <= 0
                                            ? 'cursor-not-allowed opacity-40'
                                            : ''}"
                                        disabled={day.remaining <= 0}
                                        title={day.remaining <= 0 ? 'full' : undefined}
                                        onclick={() => (selectedDay = day.date)}
                                    >
                                        {day.label.slice(0, 3)} {shortDate(day.date)}
                                    </button>
                                {/each}
                            </div>

                            {#if $isAdmin}
                                <label
                                    class="mb-1 mt-2 block text-xs font-medium text-muted-foreground"
                                    for="strava-strip-admin-date"
                                >
                                    Which day? <span class="opacity-70">(admin — any date)</span>
                                </label>
                                <input
                                    id="strava-strip-admin-date"
                                    type="date"
                                    class="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                                    bind:value={selectedDay}
                                />
                            {/if}

                            {#if selectedUsage}
                                <p class="mt-2 text-xs text-muted-foreground">
                                    {#if isUnlimitedQuota(selectedUsage.remaining, selectedUsage.count)}
                                        Unlimited · {selectedUsage.label}
                                    {:else}
                                        {selectedUsage.remaining} of {selectedUsage.count +
                                            selectedUsage.remaining} left · {selectedUsage.label}
                                    {/if}
                                </p>
                            {/if}

                            {#if popoverError}
                                <p class="mt-2 text-sm text-destructive">{popoverError}</p>
                            {/if}

                            <div class="mt-3 flex justify-end gap-2">
                                <button
                                    type="button"
                                    class="rounded-md border px-3 py-1.5 text-sm transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                                    disabled={confirming}
                                    onclick={closePopover}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    class="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                                    style="background:#fc4c02"
                                    disabled={confirming || !selectedDay || capped}
                                    onclick={() => void confirmPopover()}
                                >
                                    {#if confirming}
                                        <LoaderCircle size={14} class="animate-spin" />
                                        {popoverMode === 'assign' ? 'Saving…' : 'Importing…'}
                                    {:else}
                                        {popoverMode === 'assign' ? 'Save day' : 'Import run'}
                                    {/if}
                                </button>
                            </div>
                        </div>
                    {/if}

                    {#if successMessage}
                        <p
                            class="mb-2 flex items-center gap-1.5 text-sm font-medium text-green-600 dark:text-green-400"
                        >
                            <Check size={16} /> {successMessage}
                        </p>
                    {/if}

                    <div class="relative">
                        <button
                            class="absolute left-0 top-1/2 z-10 -translate-y-1/2 rounded-full border bg-background/90 p-1 shadow transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-30"
                            aria-label="Scroll left"
                            disabled={!canLeft}
                            onclick={() => scrollCarousel(-1)}
                        >
                            <ChevronLeft size={16} />
                        </button>
                        <div
                            bind:this={carouselEl}
                            onscroll={updateScrollState}
                            onscrollend={updateScrollState}
                            class="flex snap-x scroll-smooth gap-2 overflow-x-auto px-7"
                        >
                            {#each activities as a (a.id)}
                                {@const tagged = isTagged(a)}
                                {@const untaggedImport = isUntaggedImport(a)}
                                <button
                                    class="w-40 shrink-0 snap-start rounded-lg border p-2 text-left transition {tagged
                                        ? 'opacity-60'
                                        : 'hover:border-[#fc4c02] hover:bg-[#fc4c02]/5'}"
                                    disabled={tagged}
                                    onclick={() => openPopover(a)}
                                >
                                    <svg viewBox="0 0 130 56" class="w-full">
                                        <path
                                            d={polylineToSvgPath(decodePolyline(a.summaryPolyline), 130, 56)}
                                            fill="none"
                                            stroke={tagged ? 'currentColor' : '#fc4c02'}
                                            stroke-width="2.5"
                                            class={tagged ? 'text-muted-foreground' : ''}
                                        />
                                    </svg>
                                    <div class="mt-1 flex items-center gap-1.5">
                                        <span
                                            class="rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground"
                                            >{a.type}</span
                                        >
                                        {#if tagged}
                                            <span
                                                class="text-[10px] font-semibold text-green-600 dark:text-green-400"
                                            >
                                                ✓ {weekdayShort(a.conDay as string)}
                                            </span>
                                        {:else if untaggedImport}
                                            <span
                                                class="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-500"
                                            >
                                                Assign a day
                                            </span>
                                        {/if}
                                    </div>
                                    <p class="mt-1 truncate text-xs font-medium">{a.name}</p>
                                    <p class="text-[11px] text-muted-foreground">
                                        {formatCardDate(a.startDateLocal)} · {formatKm(a.distanceMeters)}
                                    </p>
                                </button>
                            {/each}
                        </div>
                        <button
                            class="absolute right-0 top-1/2 z-10 -translate-y-1/2 rounded-full border bg-background/90 p-1 shadow transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-30"
                            aria-label="Scroll right"
                            disabled={!canRight}
                            onclick={() => scrollCarousel(1)}
                        >
                            <ChevronRight size={16} />
                        </button>
                    </div>
                {/if}
            </div>
        {/if}
    </div>
{/if}
