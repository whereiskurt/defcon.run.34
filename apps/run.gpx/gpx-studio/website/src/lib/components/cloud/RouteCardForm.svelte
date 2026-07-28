<script lang="ts">
    // Route card editor (routes-vs-runs spec) — name/description/type for a
    // shareable route template. Client-side limits mirror the server
    // (name<=80, description<=2000, enum type); the server re-validates and
    // sanitizes everything regardless.
    interface Props {
        initial?: { name?: string; description?: string; routeType?: string };
        submitLabel: string;
        busy?: boolean;
        onsubmit: (card: { name: string; description?: string; routeType?: string }) => void;
        oncancel?: () => void;
    }
    let { initial = {}, submitLabel, busy = false, onsubmit, oncancel }: Props = $props();

    let name = $state(initial.name ?? '');
    let description = $state(initial.description ?? '');
    let routeType = $state(initial.routeType ?? '');
    let error = $state<string | null>(null);

    function submit() {
        const trimmed = name.trim();
        if (!trimmed) {
            error = 'Give your route a name';
            return;
        }
        error = null;
        onsubmit({
            name: trimmed,
            ...(description.trim() ? { description: description.trim() } : {}),
            ...(routeType ? { routeType } : {}),
        });
    }
</script>

<div class="grid gap-2">
    <label class="text-xs font-medium text-muted-foreground" for="route-card-name">
        Route name
    </label>
    <input
        id="route-card-name"
        type="text"
        maxlength={80}
        placeholder="e.g. LVCC sunrise 5k"
        class="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
        bind:value={name}
    />

    <label class="mt-1 text-xs font-medium text-muted-foreground" for="route-card-desc">
        Details <span class="opacity-70">(optional)</span>
    </label>
    <textarea
        id="route-card-desc"
        maxlength={2000}
        rows={3}
        placeholder="Meetup spot, pace, water stops…"
        class="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
        bind:value={description}
    ></textarea>

    <label class="mt-1 text-xs font-medium text-muted-foreground" for="route-card-type">
        Route type <span class="opacity-70">(optional)</span>
    </label>
    <select
        id="route-card-type"
        class="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
        bind:value={routeType}
    >
        <option value="">—</option>
        <option value="loop">Loop</option>
        <option value="out-and-back">Out and back</option>
        <option value="point-to-point">Point to point</option>
    </select>

    <div class="mt-2 flex gap-2">
        <button
            class="flex-1 rounded-lg border bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy}
            onclick={submit}
        >
            {submitLabel}
        </button>
        {#if oncancel}
            <button
                class="rounded-lg border px-3 py-2 text-sm transition hover:bg-accent"
                disabled={busy}
                onclick={() => oncancel?.()}
            >
                Cancel
            </button>
        {/if}
    </div>

    {#if error}
        <p class="text-sm text-destructive">{error}</p>
    {/if}
</div>
