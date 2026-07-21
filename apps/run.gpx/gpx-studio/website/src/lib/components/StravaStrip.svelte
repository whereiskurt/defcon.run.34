<script lang="ts">
    // Strava strip (2026-07-21 spec) — bottom-docked, collapsible carousel of the
    // runner's last-7-days Strava activities. Tapping an unimported card opens an
    // in-strip con-day popover; importing lands the run on the map exactly like the
    // Upload door and bumps the My DEF CON Runs layer to re-fetch.
    import { tick, onDestroy } from 'svelte';
    import { isAuthenticated, hasGpxStudioAccess, hasStrava, isAdmin } from '$lib/stores/auth';
    import { getConDayUsage, type ConDayUsage } from '$lib/cloud-sync';
    import {
        fetchStravaActivities,
        importStravaActivity,
        StravaSyncError,
        type StripActivity,
    } from '$lib/logic/strava-import';
    import {
        decodePolyline,
        polylineToSvgPath,
        guessConDay,
        formatKm,
    } from '$lib/logic/strava-strip-pure';
    import { stravaStripExpanded, stravaStripPulse } from '$lib/stores/strava-strip';
    import { refreshMyConRuns } from '$lib/stores/my-con-runs';
    import { ChevronDown, ChevronLeft, ChevronRight, RefreshCw, LoaderCircle, Check, X } from '@lucide/svelte';

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
    let importing = $state(false);
    let importError = $state<string | null>(null);
    let successMessage = $state<string | null>(null);

    let pulsing = $state(false);

    const openActivity = $derived(activities.find((a) => a.id === openActivityId) ?? null);
    const selectedUsage = $derived(usage.find((u) => u.date === selectedDay) ?? null);
    const capped = $derived(!!selectedUsage && selectedUsage.remaining <= 0);

    async function loadStrip() {
        if (!$hasStrava) return;
        loading = true;
        error = null;
        try {
            const [acts, u] = await Promise.all([fetchStravaActivities(), getConDayUsage()]);
            activities = acts;
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
    // (3) the "Show my last 7 days" fallback button in the body for runners whose
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

    function openPopover(a: StripActivity) {
        if (a.imported) return;
        openActivityId = a.id;
        importError = null;
        selectedDay = guessConDay(
            a.startDateLocal,
            usage.map((u) => u.date)
        );
    }

    function closePopover() {
        openActivityId = null;
        importError = null;
    }

    async function doImport() {
        const a = openActivity;
        if (!a || !selectedDay) return;
        importing = true;
        importError = null;
        const day = selectedDay;
        try {
            await importStravaActivity(a.id, day);
            activities = activities.map((act) => (act.id === a.id ? { ...act, imported: true } : act));
            const label = usage.find((u) => u.date === day)?.label ?? 'that day';
            usage = usage.map((u) => (u.date === day ? { ...u, remaining: u.remaining - 1 } : u));
            openActivityId = null;
            refreshMyConRuns();
            successMessage = `Imported! It's on the map for ${label}.`;
            clearTimeout(successTimeout);
            successTimeout = setTimeout(() => {
                successMessage = null;
            }, 4000);
        } catch (e) {
            // Keep the popover (and its con-day chips) open so the runner can pick
            // another day when a StravaSyncError reports quota/cap trouble.
            importError = e instanceof StravaSyncError || e instanceof Error ? e.message : 'Import failed';
        } finally {
            importing = false;
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
    });
</script>

{#if canShow}
    <div
        bind:this={rootEl}
        class="absolute bottom-2 left-2 right-2 z-30 rounded-xl border bg-background/90 backdrop-blur transition-shadow {pulsing
            ? 'ring-2 ring-[#fc4c02]'
            : ''}"
    >
        <div class="flex items-center gap-2 px-3 py-2">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" class="shrink-0">
                <path
                    fill="#fc4c02"
                    d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066M13.828 10.172L11.769 6.02l-4.14 8.1H4.564L11.769 0l3.939 7.856h3.066"
                />
            </svg>
            <span class="text-sm font-semibold">From Strava · last 7 days</span>
            {#if loadedOnce && !error}
                <span class="rounded-full bg-accent px-2 py-0.5 text-xs text-muted-foreground"
                    >{activities.length}</span
                >
            {/if}
            <div class="ml-auto flex items-center gap-1">
                {#if $stravaStripExpanded && $hasStrava}
                    <button
                        class="rounded-md p-1 text-muted-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="Refresh"
                        disabled={loading}
                        onclick={() => void loadStrip()}
                    >
                        <RefreshCw size={16} class={loading ? 'animate-spin' : ''} />
                    </button>
                {/if}
                <button
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
                            Link your Strava account to import your last 7 days of activity onto the
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
                        <LoaderCircle size={16} class="animate-spin" /> Loading your last 7 days…
                    </div>
                {:else if !loadedOnce && !loading && !error}
                    <div class="rounded-lg border border-dashed p-4 text-center">
                        <p class="text-sm text-muted-foreground">
                            Load your last 7 days of Strava activity onto the map.
                        </p>
                        <button
                            class="mt-3 inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white transition hover:brightness-110"
                            style="background:#fc4c02"
                            onclick={() => void loadStrip()}
                        >
                            Show my last 7 days
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
                        No activities in the last 7 days.
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
                                    class="rounded-md p-1 text-muted-foreground transition hover:bg-accent"
                                    aria-label="Cancel"
                                    onclick={closePopover}
                                >
                                    <X size={16} />
                                </button>
                            </div>

                            <p class="mb-1.5 mt-3 text-xs font-medium text-muted-foreground">
                                Which day?
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
                                    {selectedUsage.remaining} of {selectedUsage.count +
                                        selectedUsage.remaining} left · {selectedUsage.label}
                                </p>
                            {/if}

                            {#if importError}
                                <p class="mt-2 text-sm text-destructive">{importError}</p>
                            {/if}

                            <div class="mt-3 flex justify-end gap-2">
                                <button
                                    class="rounded-md border px-3 py-1.5 text-sm transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                                    disabled={importing}
                                    onclick={closePopover}
                                >
                                    Cancel
                                </button>
                                <button
                                    class="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                                    style="background:#fc4c02"
                                    disabled={importing || !selectedDay || capped}
                                    onclick={() => void doImport()}
                                >
                                    {#if importing}
                                        <LoaderCircle size={14} class="animate-spin" /> Importing…
                                    {:else}
                                        Import run
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
                                <button
                                    class="w-40 shrink-0 snap-start rounded-lg border p-2 text-left transition {a.imported
                                        ? 'opacity-60'
                                        : 'hover:border-[#fc4c02] hover:bg-[#fc4c02]/5'}"
                                    disabled={a.imported}
                                    onclick={() => openPopover(a)}
                                >
                                    <svg viewBox="0 0 130 56" class="w-full">
                                        <path
                                            d={polylineToSvgPath(decodePolyline(a.summaryPolyline), 130, 56)}
                                            fill="none"
                                            stroke={a.imported ? 'currentColor' : '#fc4c02'}
                                            stroke-width="2.5"
                                            class={a.imported ? 'text-muted-foreground' : ''}
                                        />
                                    </svg>
                                    <div class="mt-1 flex items-center gap-1.5">
                                        <span
                                            class="rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground"
                                            >{a.type}</span
                                        >
                                        {#if a.imported}
                                            <span
                                                class="flex items-center gap-0.5 text-[10px] font-semibold text-green-600 dark:text-green-400"
                                            >
                                                <Check size={10} /> Imported
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
