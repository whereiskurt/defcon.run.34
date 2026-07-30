<script lang="ts">
    import * as Dialog from '$lib/components/ui/dialog/index.js';
    import HintBar from './HintBar.svelte';
    import type { Snippet } from 'svelte';

    // `heading` / `subheading` are the header text slots. See the SUMMARY for why they
    // are spelled this way rather than after the native hover-tooltip attribute.
    let {
        open,
        onOpenChange,
        dialogId,
        heading,
        subheading,
        icon,
        footer,
        children,
    }: {
        open: boolean;
        onOpenChange: (o: boolean) => void;
        dialogId: string;
        heading: string;
        subheading?: string;
        icon?: Snippet;
        footer?: Snippet;
        children: Snippet;
    } = $props();

    const DEFAULT_HINT = 'Hover a row for details';
    let hint = $state(DEFAULT_HINT);

    // Delegated hover/focus read: any descendant carrying data-hint feeds the hint bar.
    // The `?.closest?.()` optional-call defensiveness matches LayerControl's delegated
    // document listener — the event target may be a text node's parent or null.
    function readHint(e: Event) {
        const el = (e.target as HTMLElement | null)?.closest?.('[data-hint]') as HTMLElement | null;
        hint = el?.dataset.hint || DEFAULT_HINT;
    }
</script>

<Dialog.Root {open} {onOpenChange}>
    <Dialog.Content
        data-dc34-dialog={dialogId}
        class="!max-w-[420px] !w-[94vw] !gap-0 !p-0 max-h-[72vh] overflow-hidden flex flex-col rounded-xl"
    >
        <!-- Header: hand-rolled (Dialog.Header is flex-col, which fights a single row).
             `pe-10` reserves space for the built-in close button at end-4 top-4. -->
        <div class="flex flex-shrink-0 items-center gap-2.5 border-b px-4 py-3.5 pe-10">
            {#if icon}
                <span class="shrink-0 text-[17px] leading-none">{@render icon()}</span>
            {/if}
            <div class="min-w-0 flex-1">
                <Dialog.Title class="truncate text-lg font-bold leading-tight">
                    {heading}
                </Dialog.Title>
                {#if subheading}
                    <Dialog.Description class="mt-0.5 text-xs text-muted-foreground">
                        {subheading}
                    </Dialog.Description>
                {:else}
                    <!-- bits-ui warns when a dialog has no description; keep one for a11y. -->
                    <Dialog.Description class="sr-only">{heading}</Dialog.Description>
                {/if}
            </div>
        </div>

        <!-- Scrollable body. Handlers are Svelte attributes, not manual addEventListener:
             Svelte attaches/detaches them with the portalled node, so there is no cleanup
             to get wrong.

             `[&>*]:shrink-0` is load-bearing, not cosmetic. This body is a column flex
             container with a definite height, so every direct child is a flex item with
             the default `flex-shrink: 1`. Normally `min-height: auto` floors how far a
             flex item may shrink — but that floor only applies while the item's overflow
             is visible, and Section's card variant carries `overflow-hidden` (needed for
             the rounded-corner clip). That resolves its min-height to 0, so once the
             content exceeds the body the cards were SQUASHED to fit instead of
             overflowing: `scrollHeight` never exceeded `clientHeight`, `overflow-y-auto`
             never produced a scrollbar, and Section clipped the crushed remainder into
             permanent unreachability. Measured live: a "DEF CON 34 Routes" card at
             offsetHeight 134 over scrollHeight 527, and a 1400px probe element that added
             nothing at all to the body's scrollHeight.

             The child selector is deliberately `*` rather than `[data-section]`: consumers
             render plain divs here too (CloudStorage's breadcrumb strip, its error banner
             and both gate screens), and every one of them is subject to the same crush. -->
        <!-- svelte-ignore a11y_mouse_events_have_key_events -->
        <div
            data-dialog-body
            class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3 [&>*]:shrink-0"
            onmouseover={readHint}
            onfocusin={readHint}
            onmouseleave={() => (hint = DEFAULT_HINT)}
        >
            {@render children()}
        </div>

        {#if footer}
            <!-- Hand-rolled footer: Dialog.Footer is sm:justify-end, but the spec wants
                 quiet helper text left / primary action right. -->
            <div
                class="flex flex-shrink-0 items-center justify-between gap-3 border-t px-4 py-3"
            >
                {@render footer()}
            </div>
        {/if}

        <HintBar text={hint} />
    </Dialog.Content>
</Dialog.Root>
