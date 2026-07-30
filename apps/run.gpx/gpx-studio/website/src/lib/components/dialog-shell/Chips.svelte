<script lang="ts">
    // Segmented single-select group (joined pills). Selected state is weight AND tint,
    // never colour alone.
    let {
        options,
        value,
        onselect,
        hint,
    }: {
        options: { key: string; label: string }[];
        value: string;
        onselect: (key: string) => void;
        hint?: string;
    } = $props();
</script>

<div class="flex flex-wrap gap-1.5 px-3 py-1" data-hint={hint}>
    <span class="inline-flex overflow-hidden rounded-full border border-border">
        {#each options as o, i (o.key)}
            <button
                type="button"
                aria-pressed={value === o.key}
                class="px-3 py-1 text-xs transition-colors {i > 0
                    ? 'border-l border-border'
                    : ''} {value === o.key
                    ? 'bg-primary/15 font-semibold text-primary'
                    : 'text-muted-foreground hover:bg-accent'}"
                onclick={() => onselect(o.key)}
            >
                {o.label}
            </button>
        {/each}
    </span>
</div>
