<script lang="ts">
    // Phase 60 — the on-map "quick-start" card hub. Three explicit intents, each
    // doing exactly what it says: Record Activity, Check out the routes (light up
    // the DEF CON overlays), Show me the runners (rabbit runner layer).
    // Dismissible → corner launcher → re-summonable. Ghost mode is intentionally
    // NOT exposed here.
    //
    // Record Activity used to ask "which day?" FIRST and then tag the upload with
    // whatever chip was left selected — which defaulted to the latest selectable
    // con-day. Thursday's GPX uploaded on Friday was silently logged as FRIDAY,
    // even though the file's own <time> said Thursday. It now asks for the SOURCE
    // first, reads the date out of what you picked, and shows a confirm screen.
    // The "I missed a day" case is therefore detected, not asked about.
    import { onMount } from 'svelte';
    import { get } from 'svelte/store';
    import { isAuthenticated, hasGpxStudioAccess, hasStrava, isAdmin } from '$lib/stores/auth';
    import { getConDayUsage, QuotaExceededError, type ConDayUsage } from '$lib/cloud-sync';
    import { logRunFromFile, uploadRouteFromFile } from '$lib/logic/file-actions';
    import { openStravaStrip } from '$lib/stores/strava-strip';
    import { quickStartAction, quickStartOpen } from '$lib/stores/quickstart';
    import { guessDateFromGpxText, readGpxText } from '$lib/logic/bulk-upload';
    import {
        resolveConDayConfirm,
        pickableConDays,
        conDayChipLabel,
        longConDayLabel,
        shortConDate,
        isConDayFull,
        type ConDayConfirm,
    } from '$lib/logic/con-day-confirm';
    import { stravaConnectUrl, addRunReturnUrl } from '$lib/logic/strava-connect';
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
        CalendarClock,
        TriangleAlert,
        Route,
    } from '@lucide/svelte';

    type View = 'collapsed' | 'hub' | 'logrun' | 'confirm';
    // Starts collapsed; the "+Activity" button in the top menu bar opens the hub,
    // and the ?addrun deep link opens Record Activity directly.
    let view = $state<View>('collapsed');

    quickStartOpen.subscribe((target) => {
        if (!target) return;
        quickStartOpen.set(null);
        if (target === 'logrun') openLogRun();
        else view = 'hub';
    });

    let usage = $state<ConDayUsage[]>([]);
    let selectedDate = $state<string | null>(null);
    let loadingUsage = $state(false);
    let uploading = $state(false);
    let message = $state<string | null>(null);
    let error = $state<string | null>(null);
    let fileInput = $state<HTMLInputElement>();

    // Confirm-step state: the file we've read but NOT yet committed, and what we
    // concluded about its date. Nothing touches the map or the cloud until the
    // runner presses "Log it".
    let pendingFile = $state<File | null>(null);
    let confirm = $state<ConDayConfirm | null>(null);
    let showPicker = $state(false);
    let reading = $state(false);

    const canShow = $derived($isAuthenticated && $hasGpxStudioAccess);
    // Every picker offers the same set now: con-days that have actually happened.
    // `selectable` is the server's own not-in-the-future answer.
    const selectableDays = $derived(pickableConDays(usage));
    const selectedUsage = $derived(usage.find((u) => u.date === selectedDate) ?? null);
    const capped = $derived(!!selectedUsage && isConDayFull(selectedUsage));
    const todayUsage = $derived(
        selectableDays.length ? selectableDays[selectableDays.length - 1] : null
    );

    async function refreshUsage() {
        loadingUsage = true;
        error = null;
        try {
            // Coerce to an array: a malformed/empty body yields `undefined`, which
            // then throws inside the `$derived` day filters and blanks the whole
            // screen rather than showing the error line below.
            const next = await getConDayUsage();
            usage = Array.isArray(next) ? next : [];
        } catch (e) {
            error = e instanceof Error ? e.message : 'Could not load your con-days';
        } finally {
            loadingUsage = false;
        }
    }

    onMount(() => {
        if (canShow) void refreshUsage();
    });

    function openLogRun() {
        message = null;
        error = null;
        resetConfirm();
        view = 'logrun';
        void refreshUsage();
    }
    function resetConfirm() {
        pendingFile = null;
        confirm = null;
        showPicker = false;
        selectedDate = null;
    }
    function checkRoutes() {
        quickStartAction.set('routes');
        view = 'collapsed';
    }
    function showRunners() {
        quickStartAction.set('runners');
        view = 'collapsed';
    }

    /** Strava door. Linked → the strip; unlinked → link it, and come back here. */
    function openStravaDoor() {
        if ($hasStrava) {
            view = 'collapsed';
            openStravaStrip();
            return;
        }
        window.location.href = stravaConnectUrl(
            location.pathname,
            addRunReturnUrl(location.origin, location.pathname)
        );
    }

    // The upload door no longer needs a day up front — that's the whole point.
    function pickFile() {
        error = null;
        fileInput?.click();
    }

    async function onFilePicked(e: Event) {
        const input = e.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';
        if (!file) return;
        reading = true;
        error = null;
        message = null;
        try {
            const text = await readGpxText(file);
            const guessed = guessDateFromGpxText(text);
            const resolved = resolveConDayConfirm(guessed, usage, Date.now());
            pendingFile = file;
            confirm = resolved;
            // Pre-select ONLY when we trust the date. An `offcon`/`unknown` file
            // with a day already selected is one tap from a wrong tag.
            selectedDate =
                resolved.kind === 'today' || resolved.kind === 'missed' ? resolved.date : null;
            showPicker = resolved.kind === 'offcon' || resolved.kind === 'unknown';
            view = 'confirm';
        } catch (e) {
            error = e instanceof Error ? e.message : 'Could not read that file';
        } finally {
            reading = false;
        }
    }

    async function logIt() {
        if (!pendingFile || !selectedDate) return;
        uploading = true;
        error = null;
        try {
            await logRunFromFile(pendingFile, selectedDate);
            const label = usage.find((u) => u.date === selectedDate)?.label ?? 'that day';
            message = `Logged! Your run is on the map for ${label}.`;
            resetConfirm();
            view = 'logrun';
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

    /**
     * Escape hatch for a file that can't honestly be a con run: save it with NO
     * con-day. It lands on the map and in My Routes, costs no per-day quota, and
     * can never satisfy the leaderboard's scored-run predicate.
     */
    async function saveAsRoute() {
        if (!pendingFile) return;
        uploading = true;
        error = null;
        try {
            await uploadRouteFromFile(pendingFile);
            message = 'Saved as a route — on the map, but not counted as a con day.';
            resetConfirm();
            view = 'logrun';
        } catch (e) {
            error = e instanceof Error ? e.message : 'Could not save that route';
        } finally {
            uploading = false;
        }
    }
</script>

{#if canShow}
    <input bind:this={fileInput} type="file" accept=".gpx" class="hidden" onchange={onFilePicked} />
    {#if view !== 'collapsed'}
        <!-- Dimming backdrop: click anywhere off the card collapses to the launcher. -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="absolute inset-0 z-40 bg-black/40 backdrop-blur-[1px]"
            onclick={() => (view = 'collapsed')}
        ></div>

        <div
            class="absolute left-1/2 top-1/2 z-50 max-h-[85%] w-[min(92vw,380px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-background text-foreground shadow-2xl"
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
                        class="add-run-glow flex items-center gap-3 rounded-lg p-3 text-left transition"
                        onclick={openLogRun}
                    >
                        <Footprints size={22} class="shrink-0 text-white" />
                        <span>
                            <span class="block text-sm font-semibold">Record Activity</span>
                            <span class="block text-xs text-white/80">Get your run on the map</span>
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
            {:else if view === 'logrun'}
                <!-- Two doors. No day picker: the source carries the date. -->
                <div class="flex items-center justify-between px-4 pt-4">
                    <button
                        class="flex items-center gap-1 rounded-md p-1 text-sm text-muted-foreground transition hover:bg-accent"
                        onclick={() => (view = 'hub')}
                    >
                        <ArrowLeft size={16} /> All options
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
                    <div class="mb-3 flex items-center gap-2">
                        <Footprints size={20} class="text-primary" />
                        <h2 class="text-base font-semibold">Record Activity</h2>
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
                        <!-- Strava door is ALWAYS here. It used to render only for
                             already-linked runners, so everyone else saw no mention
                             of Strava at all in this flow — the sole Connect CTA was
                             buried in the bottom strip's expanded empty state. -->
                        <button
                            class="strava-cta flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition"
                            disabled={uploading || reading}
                            onclick={openStravaDoor}
                        >
                            <RefreshCw size={18} class="shrink-0" />
                            <span>
                                <span class="block text-sm font-semibold"
                                    >{$hasStrava ? 'From Strava' : 'Connect Strava'}</span
                                >
                                <span class="block text-xs opacity-80">
                                    {$hasStrava
                                        ? 'Pick from your recent activity'
                                        : 'Then your runs log themselves'}
                                </span>
                            </span>
                        </button>

                        <button
                            class="mt-2 flex w-full items-center gap-3 rounded-lg border bg-primary px-3 py-2.5 text-left font-semibold text-primary-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={uploading || reading}
                            onclick={pickFile}
                        >
                            {#if reading}
                                <LoaderCircle size={18} class="shrink-0 animate-spin" />
                                <span class="text-sm">Reading your file…</span>
                            {:else}
                                <Upload size={18} class="shrink-0" />
                                <span>
                                    <span class="block text-sm">Upload a GPX file</span>
                                    <span class="block text-xs font-normal opacity-80"
                                        >We'll read the date from the file</span
                                    >
                                </span>
                            {/if}
                        </button>

                        {#if todayUsage}
                            <p class="mt-3 text-xs text-muted-foreground">
                                {todayUsage.count} of {todayUsage.count + todayUsage.remaining} logged
                                for {longConDayLabel(todayUsage)}
                            </p>
                        {/if}
                    {/if}

                    {#if message}
                        <p
                            class="mt-3 flex items-center gap-1.5 text-sm font-medium text-green-600 dark:text-green-400"
                        >
                            <Check size={16} />
                            {message}
                        </p>
                    {/if}
                    {#if error}
                        <p class="mt-3 text-sm text-destructive">{error}</p>
                    {/if}
                </div>
            {:else if view === 'confirm' && confirm}
                <!-- Confirm the date we read out of the file, before anything is
                     committed to the map or the cloud. -->
                <div class="flex items-center justify-between px-4 pt-4">
                    <button
                        class="flex items-center gap-1 rounded-md p-1 text-sm text-muted-foreground transition hover:bg-accent"
                        onclick={() => {
                            resetConfirm();
                            view = 'logrun';
                        }}
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
                    <p class="truncate text-sm font-semibold">{pendingFile?.name}</p>

                    {#if confirm.kind === 'today' || confirm.kind === 'missed'}
                        <p class="mb-1.5 mt-3 text-xs font-medium text-muted-foreground">
                            This run is from
                        </p>
                        <div
                            class="flex items-center gap-2 rounded-lg border border-primary bg-primary/10 px-3 py-2.5"
                        >
                            <CalendarClock size={18} class="shrink-0 text-primary" />
                            <span class="text-sm font-semibold">
                                {confirm.label}, {shortConDate(confirm.date)}
                                {#if confirm.kind === 'today'}
                                    <span class="text-primary"> — TODAY</span>
                                {/if}
                            </span>
                        </div>
                        {#if confirm.kind === 'missed'}
                            <p class="mt-1.5 text-xs text-muted-foreground">
                                Catching up on a missed day.
                            </p>
                        {/if}
                    {:else}
                        <div
                            class="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5"
                        >
                            <TriangleAlert
                                size={18}
                                class="mt-0.5 shrink-0 text-amber-600 dark:text-amber-500"
                            />
                            <p class="text-xs">
                                {#if confirm.kind === 'offcon'}
                                    Recorded <span class="font-semibold"
                                        >{shortConDate(confirm.date)}</span
                                    > — outside the DEF CON window (Aug 5–10).
                                {:else}
                                    This file has no timestamps, so we can't tell when it was run.
                                {/if}
                            </p>
                        </div>
                        <p class="mb-1.5 mt-3 text-xs font-medium text-muted-foreground">
                            Tag it anyway? Pick a day:
                        </p>
                    {/if}

                    {#if (confirm.kind === 'today' || confirm.kind === 'missed') && !showPicker}
                        <button
                            class="mt-2 text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
                            onclick={() => (showPicker = true)}
                        >
                            Not right? Pick a day
                        </button>
                    {/if}

                    {#if showPicker}
                        <div class="mt-2 flex flex-wrap gap-1.5">
                            {#each selectableDays as day (day.date)}
                                <button
                                    class="rounded-full border px-3 py-1 text-sm transition {selectedDate ===
                                    day.date
                                        ? 'border-primary bg-primary text-primary-foreground'
                                        : 'hover:bg-accent'} {isConDayFull(day)
                                        ? 'cursor-not-allowed opacity-40'
                                        : ''}"
                                    disabled={isConDayFull(day)}
                                    title={isConDayFull(day) ? 'full' : undefined}
                                    onclick={() => (selectedDate = day.date)}
                                >
                                    {conDayChipLabel(day)}
                                </button>
                            {/each}
                        </div>
                        {#if $isAdmin}
                            <label
                                class="mb-1 mt-3 block text-xs font-medium text-muted-foreground"
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
                        {/if}
                    {/if}

                    {#if selectedUsage}
                        <p class="mt-3 text-xs text-muted-foreground">
                            {selectedUsage.count} of {selectedUsage.count + selectedUsage.remaining}
                            logged · {selectedUsage.label}
                        </p>
                    {/if}

                    <button
                        class="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={uploading || !selectedDate || capped}
                        onclick={logIt}
                    >
                        {#if uploading}
                            <LoaderCircle size={16} class="animate-spin" /> Logging…
                        {:else}
                            <Check size={16} /> Log it
                        {/if}
                    </button>
                    {#if capped}
                        <p class="mt-2 text-center text-xs text-muted-foreground">
                            Daily limit reached for {selectedUsage?.label}.
                        </p>
                    {/if}

                    <button
                        class="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={uploading}
                        onclick={saveAsRoute}
                    >
                        <Route size={14} /> Save as a route instead
                    </button>
                    <p class="mt-1 text-center text-[11px] text-muted-foreground">
                        On the map, but not counted as a con day.
                    </p>

                    {#if error}
                        <p class="mt-3 text-sm text-destructive">{error}</p>
                    {/if}
                </div>
            {/if}
        </div>
    {/if}
{/if}
