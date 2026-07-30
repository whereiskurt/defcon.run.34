<script lang="ts">
    // One-line description strip pinned to the bottom of a DialogShell. This is the
    // replacement for native hover tooltips in the Phase 70 surfaces: nothing floats
    // over the list, ever — the description lands here instead.
    let { text }: { text: string } = $props();
</script>

<div
    data-hint-bar
    class="flex flex-shrink-0 items-center gap-2 border-t bg-black/25 px-4 py-2 text-xs text-muted-foreground min-h-[33px]"
>
    <span class="font-mono text-[10px] text-primary/70" aria-hidden="true">ⓘ</span>
    <!-- Announced politely, so keyboard focus (not just mouse hover) surfaces the hint. -->
    <span data-hint-out aria-live="polite" class="min-w-0 truncate">{text}</span>
</div>
