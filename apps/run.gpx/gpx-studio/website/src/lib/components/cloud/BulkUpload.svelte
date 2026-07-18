<script lang="ts">
    // Phase 62 — "Upload many" (File ▸ Bulk). Multi-file GPX import with one
    // con-day per file: each file's day is auto-guessed from its first <time>
    // trackpoint (guessDateFromGpxText), shown in an editable per-row dropdown.
    // Files with no timestamp / an off-con or future date are flagged ⚠ and block
    // import until a day is assigned. A live per-con-day tally shows how the batch
    // lands against each day's cap. Import saves each file via logRunFromFile
    // (same tagged/saved/scored path as single log-a-run); the server enforces the
    // per-con-day cap and a QuotaExceededError surfaces per row.
    import * as Dialog from '$lib/components/ui/dialog/index.js';
    import { Button } from '$lib/components/ui/button';
    import {
        Upload,
        Check,
        Clock,
        TriangleAlert,
        Loader2,
        Trash2,
        Zap,
    } from '@lucide/svelte';
    import { isAuthenticated, hasGpxStudioAccess, isAdmin } from '$lib/stores/auth';
    import { getConDayUsage, QuotaExceededError, type ConDayUsage } from '$lib/cloud-sync';
    import { logRunFromFile } from '$lib/logic/file-actions';
    import { guessDateFromGpxText, readGpxText } from '$lib/logic/bulk-upload';

    let { open = $bindable(false) }: { open?: boolean } = $props();

    interface Row {
        file: File;
        name: string;
        guessedDate: string | null; // raw guess (may be off-con / future / null)
        assignedDate: string; // '' = unassigned; must be a selectable con-day to import
        status: 'pending' | 'imported' | 'error';
        error?: string;
    }

    let usage = $state<ConDayUsage[]>([]);
    let loadingUsage = $state(false);
    let rows = $state<Row[]>([]);
    let importing = $state(false);
    let summary = $state<string | null>(null);
    let loadError = $state<string | null>(null);
    let fileInput = $state<HTMLInputElement>();

    const canShow = $derived($isAuthenticated && $hasGpxStudioAccess);
    const selectableDays = $derived(usage.filter((u) => u.selectable));
    const selectableDates = $derived(new Set(selectableDays.map((d) => d.date)));

    function isValid(r: Row): boolean {
        if (r.assignedDate === '') return false;
        // Admin override: any valid calendar date is loggable (bypass the con-day
        // set + no-future gate). Non-admins are held to selectable con-days.
        if ($isAdmin) return /^\d{4}-\d{2}-\d{2}$/.test(r.assignedDate);
        return selectableDates.has(r.assignedDate);
    }

    const pendingRows = $derived(rows.filter((r) => r.status !== 'imported'));
    const needCount = $derived(pendingRows.filter((r) => !isValid(r)).length);
    const autoCount = $derived(pendingRows.filter((r) => isValid(r)).length);

    // Per-con-day count of the pending batch, keyed by con-day date.
    const batchByDate = $derived.by(() => {
        const m: Record<string, number> = {};
        for (const r of pendingRows) {
            if (r.assignedDate) m[r.assignedDate] = (m[r.assignedDate] ?? 0) + 1;
        }
        return m;
    });

    async function refreshUsage() {
        loadingUsage = true;
        loadError = null;
        try {
            usage = await getConDayUsage();
        } catch (e) {
            loadError = e instanceof Error ? e.message : 'Could not load your con-days';
        } finally {
            loadingUsage = false;
        }
    }

    // Load usage whenever the dialog opens.
    $effect(() => {
        if (open && canShow) void refreshUsage();
    });

    function handleOpenChange(next: boolean) {
        open = next;
        if (!next) {
            // Reset the batch on close so the next open starts clean.
            rows = [];
            summary = null;
            loadError = null;
        }
    }

    function pickFiles() {
        fileInput?.click();
    }

    async function onFilesPicked(e: Event) {
        const input = e.currentTarget as HTMLInputElement;
        const files = Array.from(input.files ?? []);
        input.value = '';
        if (files.length === 0) return;
        summary = null;

        const added: Row[] = [];
        for (const file of files) {
            let guessedDate: string | null = null;
            try {
                const text = await readGpxText(file);
                guessedDate = guessDateFromGpxText(text);
            } catch {
                guessedDate = null;
            }
            // Admins accept any guessed date; non-admins only a selectable con-day.
            const assignedDate = guessedDate
                ? ($isAdmin || selectableDates.has(guessedDate) ? guessedDate : '')
                : '';
            added.push({ file, name: file.name, guessedDate, assignedDate, status: 'pending' });
        }
        rows = [...rows, ...added];
    }

    // Re-apply the GPS guess to every pending row whose guess is a loggable con-day.
    function autoGuess() {
        rows = rows.map((r) => {
            if (r.status === 'imported') return r;
            if (r.guessedDate && ($isAdmin || selectableDates.has(r.guessedDate))) {
                return { ...r, assignedDate: r.guessedDate };
            }
            return r;
        });
    }

    function setDay(index: number, date: string) {
        rows = rows.map((r, i) => (i === index ? { ...r, assignedDate: date } : r));
    }

    function removeRow(index: number) {
        rows = rows.filter((_, i) => i !== index);
    }

    /** Short weekday for a guessed date; raw date if off-con; "none" if no guess. */
    function guessLabel(r: Row): string {
        if (!r.guessedDate) return 'none';
        const u = usage.find((x) => x.date === r.guessedDate);
        return u ? u.label.slice(0, 3) : r.guessedDate;
    }

    async function doImport() {
        if (importing || needCount > 0 || pendingRows.length === 0) return;
        importing = true;
        summary = null;
        let ok = 0;
        let failed = 0;
        for (const r of rows) {
            if (r.status === 'imported') continue;
            try {
                await logRunFromFile(r.file, r.assignedDate);
                r.status = 'imported';
                r.error = undefined;
                ok++;
            } catch (e) {
                r.status = 'error';
                r.error =
                    e instanceof QuotaExceededError
                        ? "Daily limit reached for that day"
                        : e instanceof Error
                          ? e.message
                          : 'Import failed';
                failed++;
            }
            rows = [...rows]; // trigger reactivity after each mutation
        }
        importing = false;
        summary = `Imported ${ok} run${ok !== 1 ? 's' : ''}${failed ? `, ${failed} failed` : ''}.`;
        await refreshUsage();
    }
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
    <Dialog.Content class="!max-w-[720px] !w-[92vw] max-h-[85vh] overflow-hidden flex flex-col">
        <Dialog.Header>
            <Dialog.Title class="flex items-center gap-2">
                <Upload class="h-5 w-5" />
                Upload many — one day per file
            </Dialog.Title>
        </Dialog.Header>

        {#if !canShow}
            <div class="flex flex-col items-center justify-center py-8 text-center">
                <TriangleAlert class="mb-4 h-10 w-10 text-muted-foreground" />
                <p class="text-muted-foreground">Sign in with GPX Studio access to upload runs.</p>
            </div>
        {:else}
            <input
                bind:this={fileInput}
                type="file"
                accept=".gpx"
                multiple
                class="hidden"
                onchange={onFilesPicked}
            />

            <!-- Toolbar -->
            <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="text-sm text-muted-foreground">
                    {#if rows.length === 0}
                        No files chosen yet
                    {:else}
                        {rows.length} file{rows.length !== 1 ? 's' : ''}
                    {/if}
                </div>
                <div class="flex items-center gap-2">
                    <Button variant="outline" size="sm" onclick={autoGuess} disabled={rows.length === 0}>
                        <Zap class="mr-1 h-4 w-4" /> Auto-guess from GPS
                    </Button>
                    <Button variant="outline" size="sm" onclick={pickFiles} disabled={importing}>
                        <Upload class="mr-1 h-4 w-4" /> Choose files
                    </Button>
                </div>
            </div>

            {#if loadError}
                <div class="mt-2 rounded-md bg-destructive/10 px-4 py-2 text-sm text-destructive">
                    {loadError}
                </div>
            {/if}

            <!-- File rows -->
            <div class="mt-3 min-h-0 flex-1 overflow-y-auto rounded-md border">
                {#if rows.length === 0}
                    <div class="p-8 text-center text-muted-foreground">
                        <p>Pick multiple <span class="font-mono">.gpx</span> files.</p>
                        <p class="mt-1 text-sm">
                            Each file's con-day is guessed from its first timestamp — edit any that
                            need a day.
                        </p>
                    </div>
                {:else}
                    <div class="divide-y">
                        {#each rows as row, i (row.name + i)}
                            <div class="flex items-center gap-3 px-3 py-2">
                                <!-- Name + guessed time -->
                                <div class="min-w-0 flex-1">
                                    <div class="truncate text-sm font-medium" title={row.name}>
                                        {row.name}
                                    </div>
                                    <div class="flex items-center gap-1 text-xs text-muted-foreground">
                                        <Clock class="h-3 w-3" />
                                        {guessLabel(row)}
                                    </div>
                                </div>

                                <!-- Day picker: admins get any-date input; others a con-day dropdown -->
                                {#if $isAdmin}
                                    <input
                                        type="date"
                                        class="rounded-md border bg-background px-2 py-1 text-sm disabled:opacity-50"
                                        value={row.assignedDate}
                                        disabled={importing || row.status === 'imported'}
                                        onchange={(e) => setDay(i, (e.currentTarget as HTMLInputElement).value)}
                                    />
                                {:else}
                                    <select
                                        class="rounded-md border bg-background px-2 py-1 text-sm disabled:opacity-50"
                                        value={row.assignedDate}
                                        disabled={importing || row.status === 'imported'}
                                        onchange={(e) => setDay(i, (e.currentTarget as HTMLSelectElement).value)}
                                    >
                                        <option value="">pick…</option>
                                        {#each selectableDays as day (day.date)}
                                            <option value={day.date}>{day.label.slice(0, 3)}</option>
                                        {/each}
                                    </select>
                                {/if}

                                <!-- Status -->
                                <div class="w-6 text-center">
                                    {#if row.status === 'imported'}
                                        <Check class="mx-auto h-4 w-4 text-green-600" />
                                    {:else if row.status === 'error'}
                                        <TriangleAlert class="mx-auto h-4 w-4 text-destructive" />
                                    {:else if isValid(row)}
                                        <Check class="mx-auto h-4 w-4 text-green-600" />
                                    {:else}
                                        <TriangleAlert class="mx-auto h-4 w-4 text-amber-500" />
                                    {/if}
                                </div>

                                <!-- Remove -->
                                <button
                                    class="rounded-md p-1 text-muted-foreground transition hover:bg-accent hover:text-destructive disabled:opacity-40"
                                    aria-label="Remove"
                                    disabled={importing}
                                    onclick={() => removeRow(i)}
                                >
                                    <Trash2 class="h-4 w-4" />
                                </button>
                            </div>
                            {#if row.status === 'error' && row.error}
                                <div class="px-3 pb-2 text-xs text-destructive">{row.error}</div>
                            {/if}
                        {/each}
                    </div>
                {/if}
            </div>

            <!-- Tally + import -->
            {#if rows.length > 0}
                <div class="mt-3 flex flex-col gap-2 border-t pt-3">
                    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                        {#if needCount > 0}
                            <span class="flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400">
                                <TriangleAlert class="h-3.5 w-3.5" />
                                {needCount} need a day
                            </span>
                        {/if}
                        <span class="text-muted-foreground">{autoCount} ready</span>
                        <span class="flex flex-wrap gap-2 text-muted-foreground">
                            {#each selectableDays as day (day.date)}
                                {@const batch = batchByDate[day.date] ?? 0}
                                {@const limit = day.count + day.remaining}
                                {@const over = day.count + batch > limit}
                                <span class={over ? 'font-semibold text-destructive' : ''}>
                                    {day.label.slice(0, 3)}:{batch}
                                    {#if batch > 0}
                                        <span class="opacity-70">({day.count + batch}/{limit})</span>
                                    {/if}
                                </span>
                            {/each}
                        </span>
                    </div>

                    {#if summary}
                        <p class="text-sm font-medium text-green-600 dark:text-green-400">{summary}</p>
                    {/if}

                    <div class="flex justify-end">
                        <Button
                            class="bg-primary px-6 text-primary-foreground"
                            onclick={doImport}
                            disabled={importing || loadingUsage || needCount > 0 || pendingRows.length === 0}
                        >
                            {#if importing}
                                <Loader2 class="mr-2 h-4 w-4 animate-spin" /> Importing…
                            {:else}
                                <Upload class="mr-2 h-4 w-4" />
                                Import {pendingRows.length}
                            {/if}
                        </Button>
                    </div>
                </div>
            {/if}
        {/if}
    </Dialog.Content>
</Dialog.Root>
