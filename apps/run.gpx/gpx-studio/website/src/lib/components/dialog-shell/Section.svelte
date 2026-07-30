<script lang="ts">
    import { ChevronDown } from '@lucide/svelte';
    import type { Snippet } from 'svelte';

    // `collapsed` is a plain input prop paired with an `ontoggle` callback, deliberately
    // NOT bindable: consumers own the collapse state because their existing
    // master-visibility effects (PublicOverlays and its clones) must keep writing it.
    let {
        label,
        count,
        master = null,
        onmaster,
        collapsed = false,
        ontoggle,
        variant = 'card',
        collapsible = true,
        hint,
        menu,
        children,
    }: {
        label: string;
        count?: number | string;
        master?: boolean | null;
        onmaster?: (v: boolean) => void;
        collapsed?: boolean;
        ontoggle?: (c: boolean) => void;
        variant?: 'card' | 'plain';
        collapsible?: boolean;
        hint?: string;
        menu?: Snippet;
        children?: Snippet;
    } = $props();

    const showChevron = $derived(collapsible && !!children);
    const isOpen = $derived(!collapsed || !collapsible);
</script>

<div data-section class={variant === 'card' ? 'overflow-hidden rounded-md border bg-muted/20' : ''}>
    <div
        data-hint={hint}
        class="flex items-center gap-2 {variant === 'card'
            ? 'px-3 py-2.5'
            : 'py-1.5 pr-1'} {isOpen && showChevron && variant === 'card' ? 'border-b' : ''}"
    >
        {#if showChevron}
            <!-- ONE rotating glyph. Never swap between two icon components: a node swap
                 detaches the click target, which is what forced the old hand-rolled
                 outside-click handler to misreport containment. -->
            <button
                type="button"
                data-section-chevron
                aria-label={collapsed ? 'Expand' : 'Collapse'}
                aria-expanded={!collapsed}
                class="grid size-[18px] shrink-0 place-items-center text-muted-foreground transition-transform duration-150 hover:text-foreground {collapsed
                    ? '-rotate-90'
                    : ''}"
                onclick={() => ontoggle?.(!collapsed)}
            >
                <ChevronDown size="14" />
            </button>
        {:else}
            <span class="size-[18px] shrink-0"></span>
        {/if}

        <button
            type="button"
            data-section-label
            class="min-w-0 flex-1 truncate text-left text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground {master ===
            false
                ? 'opacity-55'
                : ''}"
            onclick={() => ontoggle?.(!collapsed)}
            disabled={!showChevron}
        >
            {label}
        </button>

        {#if count !== undefined}
            <span class="shrink-0 font-mono text-[11px] text-muted-foreground">{count}</span>
        {/if}

        {@render menu?.()}

        {#if master !== null}
            <input
                type="checkbox"
                checked={master}
                class="size-[15px] shrink-0 cursor-pointer accent-primary"
                aria-label={'Toggle all in ' + label}
                onchange={(e) => onmaster?.(e.currentTarget.checked)}
            />
        {/if}
    </div>

    {#if isOpen && children}
        <div class={variant === 'card' ? 'py-1' : 'pl-4'}>
            {@render children()}
        </div>
    {/if}
</div>
