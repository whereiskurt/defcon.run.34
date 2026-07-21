<script lang="ts">
    // Task 10 — "Save as defcon.run Activity" con-day dialog. Lets a runner
    // assign / move / clear which DEF CON day a My Maps file counts toward.
    // Chips are NOT gated on `selectable` — the server accepts any of the six
    // con days at any time for non-admins; only fullness (remaining<=0) disables
    // a chip, and re-saving the file's own current day is always allowed even
    // when that day is full.
    import { getConDayUsage, updateCloudFile, type CloudFile, type ConDayUsage } from '$lib/cloud-sync';
    import { guessConDay, isUnlimitedQuota } from '$lib/logic/strava-strip-pure';
    import { refreshMyConRuns } from '$lib/stores/my-con-runs';
    import { isAdmin } from '$lib/stores/auth';
    import { CalendarCheck } from '@lucide/svelte';

    let {
        file,
        open,
        onClose,
        onSaved,
    }: {
        file: CloudFile;
        open: boolean;
        onClose: () => void;
        onSaved: (conDay: string | null) => void;
    } = $props();

    let usage = $state<ConDayUsage[]>([]);
    let loading = $state(false);
    let saving = $state(false);
    let error = $state<string | null>(null);
    let selected = $state<string | null>(null);

    const selectedUsage = $derived(usage.find((u) => u.date === selected) ?? null);
    const currentUsage = $derived(usage.find((u) => u.date === file.conDay) ?? null);

    function shortDate(date: string): string {
        return new Date(date + 'T12:00:00').toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
        });
    }

    async function load() {
        loading = true;
        error = null;
        try {
            usage = await getConDayUsage();
            selected =
                file.conDay ??
                guessConDay(
                    new Date(file.createdAt ?? Date.now()).toISOString(),
                    usage.map((u) => u.date)
                );
        } catch (e) {
            error = e instanceof Error ? e.message : 'Could not load con-day usage';
        } finally {
            loading = false;
        }
    }

    // (Re-)load usage every time the dialog opens for a (possibly different) file.
    let loadedFor = $state<string | null>(null);
    $effect(() => {
        if (open && loadedFor !== file.fileId) {
            loadedFor = file.fileId;
            void load();
        }
    });

    async function save(conDay: string | null) {
        saving = true;
        error = null;
        try {
            await updateCloudFile(file.fileId, { conDay });
            refreshMyConRuns();
            onSaved(conDay);
            onClose();
        } catch (e) {
            // Keep the dialog (and its chips) open so the runner can pick another
            // day when the server reports a 429 con-day cap.
            error = e instanceof Error ? e.message : 'Failed to update file';
        } finally {
            saving = false;
        }
    }
</script>

{#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="fixed inset-0 z-[60] bg-black/40" onclick={onClose}></div>

    <div
        class="fixed left-1/2 top-1/2 z-[70] w-[min(92vw,380px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-background text-foreground shadow-2xl"
    >
        <div class="p-4">
            <div class="flex items-center gap-2">
                <CalendarCheck size={18} class="shrink-0 text-primary" />
                <h2 class="text-base font-semibold">Save as defcon.run Activity</h2>
            </div>
            <p class="mt-0.5 text-xs text-muted-foreground">Which DEF CON day is this run for?</p>

            {#if loading}
                <div class="flex items-center gap-2 py-6 text-sm text-muted-foreground">Loading…</div>
            {:else}
                {#if file.conDay}
                    <p class="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span>Currently: {currentUsage?.label ?? file.conDay}</span>
                        <button
                            class="shrink-0 font-medium text-primary underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={saving}
                            onclick={() => void save(null)}
                        >
                            Remove tag
                        </button>
                    </p>
                {/if}

                <div class="mt-3 flex flex-wrap gap-1.5">
                    {#each usage as day (day.date)}
                        {@const isCurrent = day.date === file.conDay}
                        {@const full = day.remaining <= 0 && !isCurrent}
                        <button
                            class="rounded-full border px-3 py-1 text-sm transition {selected === day.date
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'hover:bg-accent'} {full ? 'cursor-not-allowed opacity-40' : ''}"
                            disabled={full}
                            title={full ? 'full' : undefined}
                            onclick={() => (selected = day.date)}
                        >
                            {day.label.slice(0, 3)} <small>{shortDate(day.date)}</small>
                        </button>
                    {/each}
                </div>

                {#if $isAdmin}
                    <label
                        class="mb-1 mt-3 block text-xs font-medium text-muted-foreground"
                        for="conday-save-admin-date"
                    >
                        Which day? <span class="opacity-70">(admin — any date)</span>
                    </label>
                    <input
                        id="conday-save-admin-date"
                        type="date"
                        class="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                        bind:value={selected}
                    />
                {/if}

                {#if selectedUsage}
                    <p class="mt-2 text-xs text-muted-foreground">
                        {#if isUnlimitedQuota(selectedUsage.remaining, selectedUsage.count)}
                            Unlimited · {selectedUsage.label}
                        {:else}
                            {selectedUsage.count} of {selectedUsage.count +
                                selectedUsage.remaining} runs · {selectedUsage.label}
                        {/if}
                    </p>
                {/if}

                {#if error}
                    <p class="mt-2 text-sm text-destructive">{error}</p>
                {/if}

                <div class="mt-4 flex justify-end gap-2">
                    <button
                        class="rounded-md border px-3 py-1.5 text-sm transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={saving}
                        onclick={onClose}
                    >
                        Cancel
                    </button>
                    <button
                        class="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={saving || !selected}
                        onclick={() => void save(selected)}
                    >
                        {#if saving}
                            Saving…
                        {:else}
                            <CalendarCheck size={14} /> Save
                        {/if}
                    </button>
                </div>
            {/if}
        </div>
    </div>
{/if}
