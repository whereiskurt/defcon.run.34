<script lang="ts">
    import type { Snippet } from 'svelte';

    let {
        control = 'checkbox',
        name,
        checked = false,
        onchange,
        color,
        icon,
        label,
        meta,
        hint,
        trailing,
    }: {
        control?: 'checkbox' | 'radio' | 'none';
        name?: string;
        checked?: boolean;
        onchange?: (v: boolean) => void;
        color?: string;
        icon?: Snippet;
        label: string;
        meta?: string;
        hint?: string;
        trailing?: Snippet;
    } = $props();
</script>

<!-- The row marker attribute below is on EVERY Row: it is the selector the prod probe
     uses to prove no native hover-tooltip attribute survives inside a layer row. -->
<label
    data-layer-row
    data-hint={hint}
    class="group/row flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm transition-colors hover:bg-foreground/5"
>
    {#if control === 'radio'}
        <input
            type="radio"
            {name}
            {checked}
            class="size-[15px] shrink-0 cursor-pointer accent-primary"
            onchange={(e) => {
                if (e.currentTarget.checked) onchange?.(true);
            }}
        />
    {:else if control === 'checkbox'}
        <input
            type="checkbox"
            {checked}
            class="size-[15px] shrink-0 cursor-pointer accent-primary"
            onchange={(e) => onchange?.(e.currentTarget.checked)}
        />
    {/if}

    {#if color}
        <span
            class="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style="background-color: {color}"
        ></span>
    {/if}

    {#if icon}
        <span class="shrink-0">{@render icon()}</span>
    {/if}

    <!-- min-w-0 flex-1 + truncate is a pair; dropping either breaks flex-row truncation. -->
    <span class="min-w-0 flex-1 truncate">{label}</span>

    {#if meta}
        <span class="shrink-0 text-[11px] text-muted-foreground">{meta}</span>
    {/if}

    {@render trailing?.()}
</label>
