<script lang="ts">
    // Phase 60 — the on-map "quick-start" card hub. Three explicit intents, each
    // doing exactly what it says: Log a run (upload → map + saved + tagged),
    // Check out the routes (light up the DEF CON overlays), Show me the runners
    // (rabbit runner layer). Dismissible → corner launcher → re-summonable.
    // Ghost mode is intentionally NOT exposed here.
    import { onMount } from 'svelte';
    import { get } from 'svelte/store';
    import { isAuthenticated, hasGpxStudioAccess, hasStrava, isAdmin } from '$lib/stores/auth';
    import { getConDayUsage, QuotaExceededError, type ConDayUsage } from '$lib/cloud-sync';
    import { logRunFromFile } from '$lib/logic/file-actions';
    import { logRunFromStrava, StravaSyncError } from '$lib/logic/strava-import';
    import { quickStartAction, quickStartOpen } from '$lib/stores/quickstart';
    import {
        Footprints,
        Map as MapIcon,
        Users,
        Upload,
        RefreshCw,
        X,
        ArrowLeft,
        LoaderCircle,
        Check,
    } from '@lucide/svelte';

    type View = 'collapsed' | 'hub' | 'logrun';
    // Starts collapsed; the "Add run" button in the top menu bar opens the hub.
    let view = $state<View>('collapsed');

    // Open the hub when the menu-bar "Add run" button fires (one-shot).
    quickStartOpen.subscribe((open) => {
        if (open) {
            view = 'hub';
            quickStartOpen.set(false);
        }
    });
    let usage = $state<ConDayUsage[]>([]);
    let selectedDate = $state<string | null>(null);
    let loadingUsage = $state(false);
    let uploading = $state(false);
    let syncing = $state(false);
    let message = $state<string | null>(null);
    let error = $state<string | null>(null);
    let fileInput = $state<HTMLInputElement>();

    const canShow = $derived($isAuthenticated && $hasGpxStudioAccess);
    const selectableDays = $derived(usage.filter((u) => u.selectable));
    const selectedUsage = $derived(usage.find((u) => u.date === selectedDate) ?? null);
    const capped = $derived(!!selectedUsage && selectedUsage.remaining <= 0);

    async function refreshUsage() {
        loadingUsage = true;
        error = null;
        try {
            usage = await getConDayUsage();
            // Non-admins: default to the latest selectable con-day (today), keeping a
            // valid prior pick. Admins choose any date via the date input, so never
            // clobber their selection here.
            if (!get(isAdmin)) {
                if (!selectedDate || !usage.find((u) => u.date === selectedDate && u.selectable)) {
                    const sel = usage.filter((u) => u.selectable);
                    selectedDate = sel.length ? sel[sel.length - 1].date : null;
                }
            }
        } catch (e) {
            error = e instanceof Error ? e.message : 'Could not load your con-days';
        } finally {
            loadingUsage = false;
        }
    }

    onMount(() => {
        if (canShow) void refreshUsage();
    });

    /** Local YYYY-MM-DD (en-CA formats as ISO date). For the admin any-date default. */
    function todayStr(): string {
        return new Date().toLocaleDateString('en-CA');
    }

    function openLogRun() {
        message = null;
        error = null;
        view = 'logrun';
        // Admins pick any date via a date input; seed it to today so it's ready.
        if (get(isAdmin) && !selectedDate) selectedDate = todayStr();
        void refreshUsage();
    }
    function checkRoutes() {
        quickStartAction.set('routes');
        view = 'collapsed';
    }
    function showRunners() {
        quickStartAction.set('runners');
        view = 'collapsed';
    }

    function pickFile() {
        if (!selectedDate) {
            error = 'Pick a day first';
            return;
        }
        error = null;
        fileInput?.click();
    }

    async function onFilePicked(e: Event) {
        const input = e.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';
        if (!file || !selectedDate) return;
        uploading = true;
        error = null;
        message = null;
        try {
            await logRunFromFile(file, selectedDate);
            message = `Logged! Your run is on the map for ${selectedUsage?.label ?? 'that day'}.`;
            await refreshUsage();
        } catch (e) {
            if (e instanceof QuotaExceededError) {
                error = "You've logged all your runs for that day.";
            } else {
                error = e instanceof Error ? e.message : 'Upload failed';
            }
            await refreshUsage();
        } finally {
            uploading = false;
        }
    }

    // "Sync my Strava" door (Phase 61): pull the runner's recent Strava activities
    // into the selected con-day. Same landing as the upload door; the server does
    // dedupe + per-con-day cap + quota + burst guard, so we just surface the result.
    async function syncStrava() {
        if (!selectedDate) {
            error = 'Pick a day first';
            return;
        }
        syncing = true;
        error = null;
        message = null;
        try {
            const res = await logRunFromStrava(selectedDate);
            if (res.imported === 0) {
                message =
                    res.skipped > 0
                        ? `Already up to date — nothing new for ${selectedUsage?.label ?? 'that day'}.`
                        : `No recent Strava runs to log for ${selectedUsage?.label ?? 'that day'}.`;
            } else {
                message = `Logged ${res.imported} ${res.imported === 1 ? 'run' : 'runs'} from Strava for ${selectedUsage?.label ?? 'that day'}!`;
            }
            await refreshUsage();
        } catch (e) {
            if (e instanceof StravaSyncError) {
                error = e.message;
            } else {
                error = e instanceof Error ? e.message : 'Strava sync failed';
            }
            await refreshUsage();
        } finally {
            syncing = false;
        }
    }
</script>

{#if canShow}
    <input
        bind:this={fileInput}
        type="file"
        accept=".gpx"
        class="hidden"
        onchange={onFilePicked}
    />

    {#if view !== 'collapsed'}
        <!-- Dimming backdrop: click anywhere off the card collapses to the launcher. -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="absolute inset-0 z-40 bg-black/40 backdrop-blur-[1px]"
            onclick={() => (view = 'collapsed')}
        ></div>

        <div
            class="absolute left-1/2 top-1/2 z-50 w-[min(92vw,380px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-background text-foreground shadow-2xl"
        >
            {#if view === 'hub'}
                <div class="flex items-center justify-between px-4 pt-4">
                    <h2 class="text-base font-semibold">What do you want to do?</h2>
                    <button
                        class="rounded-md p-1 text-muted-foreground transition hover:bg-accent"
                        aria-label="Dismiss"
                        onclick={() => (view = 'collapsed')}
                    >
                        <X size={18} />
                    </button>
                </div>
                <div class="grid gap-2 p-4">
                    <button
                        class="flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3 text-left transition hover:bg-primary/10"
                        onclick={openLogRun}
                    >
                        <Footprints size={22} class="shrink-0 text-primary" />
                        <span>
                            <span class="block text-sm font-semibold">Log a run</span>
                            <span class="block text-xs text-muted-foreground"
                                >Get today's run on the map</span
                            >
                        </span>
                    </button>
                    <button
                        class="flex items-center gap-3 rounded-lg border p-3 text-left transition hover:bg-accent"
                        onclick={checkRoutes}
                    >
                        <MapIcon size={22} class="shrink-0" />
                        <span>
                            <span class="block text-sm font-semibold">Check out the routes</span>
                            <span class="block text-xs text-muted-foreground"
                                >Light up every DEF CON route</span
                            >
                        </span>
                    </button>
                    <button
                        class="flex items-center gap-3 rounded-lg border p-3 text-left transition hover:bg-accent"
                        onclick={showRunners}
                    >
                        <Users size={22} class="shrink-0" />
                        <span>
                            <span class="block text-sm font-semibold">Show me the runners</span>
                            <span class="block text-xs text-muted-foreground"
                                >Live runner positions</span
                            >
                        </span>
                    </button>
                </div>
            {:else}
                <!-- Log a run sub-flow -->
                <div class="flex items-center justify-between px-4 pt-4">
                    <button
                        class="flex items-center gap-1 rounded-md p-1 text-sm text-muted-foreground transition hover:bg-accent"
                        onclick={() => (view = 'hub')}
                    >
                        <ArrowLeft size={16} /> Back
                    </button>
                    <button
                        class="rounded-md p-1 text-muted-foreground transition hover:bg-accent"
                        aria-label="Dismiss"
                        onclick={() => (view = 'collapsed')}
                    >
                        <X size={18} />
                    </button>
                </div>

                <div class="p-4">
                    <div class="mb-1 flex items-center gap-2">
                        <Footprints size={20} class="text-primary" />
                        <h2 class="text-base font-semibold">Log a run</h2>
                    </div>

                    {#if loadingUsage && usage.length === 0}
                        <div class="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                            <LoaderCircle size={16} class="animate-spin" /> Loading your days…
                        </div>
                    {:else if selectableDays.length === 0 && !$isAdmin}
                        <p class="py-4 text-sm text-muted-foreground">
                            Con-day logging isn't open yet. Come back during the con (Aug 5–10).
                        </p>
                    {:else}
                        {#if $isAdmin}
                            <!-- Admin override: log/test a run for ANY date. -->
                            <label
                                class="mb-2 mt-3 block text-xs font-medium text-muted-foreground"
                                for="qs-admin-date"
                            >
                                Which day? <span class="opacity-70">(admin — any date)</span>
                            </label>
                            <input
                                id="qs-admin-date"
                                type="date"
                                class="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                                bind:value={selectedDate}
                            />
                        {:else}
                            <p class="mb-2 mt-3 text-xs font-medium text-muted-foreground">Which day?</p>
                            <div class="flex flex-wrap gap-1.5">
                                {#each selectableDays as day (day.date)}
                                    <button
                                        class="rounded-full border px-3 py-1 text-sm transition {selectedDate ===
                                        day.date
                                            ? 'border-primary bg-primary text-primary-foreground'
                                            : 'hover:bg-accent'} {day.remaining <= 0
                                            ? 'opacity-40'
                                            : ''}"
                                        onclick={() => (selectedDate = day.date)}
                                    >
                                        {day.label.slice(0, 3)}
                                    </button>
                                {/each}
                            </div>
                        {/if}

                        {#if selectedUsage}
                            <p class="mt-3 text-xs text-muted-foreground">
                                {selectedUsage.count} of
                                {selectedUsage.count + selectedUsage.remaining} runs · {selectedUsage.label}
                            </p>
                        {/if}

                        {#if $hasStrava}
                            <button
                                class="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2.5 text-sm font-semibold text-primary transition hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={uploading || syncing || capped || !selectedDate}
                                onclick={syncStrava}
                            >
                                {#if syncing}
                                    <LoaderCircle size={16} class="animate-spin" /> Syncing from Strava…
                                {:else}
                                    <RefreshCw size={16} /> From Strava
                                {/if}
                            </button>
                        {/if}

                        <button
                            class="{$hasStrava ? 'mt-2' : 'mt-4'} flex w-full items-center justify-center gap-2 rounded-lg border bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={uploading || syncing || capped || !selectedDate}
                            onclick={pickFile}
                        >
                            {#if uploading}
                                <LoaderCircle size={16} class="animate-spin" /> Uploading…
                            {:else}
                                <Upload size={16} /> Upload a file
                            {/if}
                        </button>
                        {#if capped}
                            <p class="mt-2 text-center text-xs text-muted-foreground">
                                Daily limit reached for {selectedUsage?.label}.
                            </p>
                        {/if}
                    {/if}

                    {#if message}
                        <p
                            class="mt-3 flex items-center gap-1.5 text-sm font-medium text-green-600 dark:text-green-400"
                        >
                            <Check size={16} /> {message}
                        </p>
                    {/if}
                    {#if error}
                        <p class="mt-3 text-sm text-destructive">{error}</p>
                    {/if}
                </div>
            {/if}
        </div>
    {/if}
{/if}
