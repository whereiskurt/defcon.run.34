<script lang="ts">
    // One multi-select pill. When ON with a type colour, border/text take the colour and
    // the background gets the ~13% hex-alpha tint.
    let {
        label,
        on = false,
        color,
        onclick,
        hint,
    }: {
        label: string;
        on?: boolean;
        color?: string;
        onclick: () => void;
        hint?: string;
    } = $props();
</script>

<button
    type="button"
    aria-pressed={on}
    data-hint={hint}
    {onclick}
    class="rounded-full border px-2.5 py-1 text-xs transition-colors {on
        ? 'font-semibold'
        : 'border-border text-muted-foreground hover:bg-accent'} {on && !color
        ? 'border-primary bg-primary/15 text-primary'
        : ''}"
    style={on && color
        ? `border-color:${color};background:${color}22;color:${color}`
        : ''}
>
    {label}
</button>
