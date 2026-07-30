<script lang="ts">
    import { Section, Row } from '$lib/components/dialog-shell/index.js';
    import { flattenLayerTree } from '$lib/logic/basemap-tree-pure';
    import { i18n } from '$lib/i18n.svelte';
    import { settings } from '$lib/logic/settings';
    import { extensionAPI } from '$lib/components/map/layer-control/extension-api';

    let {
        collapsed = false,
        ontoggle,
    }: { collapsed?: boolean; ontoggle?: (c: boolean) => void } = $props();

    const { currentBasemap, previousBasemap, selectedBasemapTree, customLayers } = settings;
    const { isLayerFromExtension, getLayerName } = extensionAPI;

    // One flat radio list instead of a nested collapsible tree, so this card has
    // exactly one collapse affordance (its own header chevron).
    const ids = $derived(flattenLayerTree($selectedBasemapTree));

    // Same resolution chain LayerTreeNode uses: a user's own layer name wins,
    // then whatever name an extension supplies, then the translated fallback.
    function labelFor(id: string): string {
        if ($customLayers.hasOwnProperty(id)) {
            return $customLayers[id].name;
        }
        if ($isLayerFromExtension(id)) {
            return $getLayerName(id);
        }
        return i18n._(`layers.label.${id}`);
    }

    // Recording the outgoing choice is load-bearing: the rest of the app reads it
    // to restore the style the user was on.
    function select(id: string) {
        $previousBasemap = $currentBasemap;
        $currentBasemap = id;
    }
</script>

<Section label="Basemap" {collapsed} {ontoggle} hint="Choose the background map style.">
    <!-- Checked against the user's stored choice, NOT the effective style key:
         dark mode swaps the rendered style but must not move the selection. -->
    {#each ids as id (id)}
        <Row
            control="radio"
            name="basemap"
            checked={$currentBasemap === id}
            label={labelFor(id)}
            onchange={() => select(id)}
        />
    {/each}
</Section>
