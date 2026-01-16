<script lang="ts">
    import CustomControl from '$lib/components/map/custom-control/CustomControl.svelte';
    import LayerTree from './LayerTree.svelte';
    import { OverpassLayer } from './overpass-layer';
    import { Separator } from '$lib/components/ui/separator';
    import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
    import { Layers } from '@lucide/svelte';
    import { basemaps, defaultBasemap, overlays } from '$lib/assets/layers';
    import { settings } from '$lib/logic/settings';
    import { map } from '$lib/components/map/map';
    import { customBasemapUpdate, getLayers } from './utils';
    import type { ImportSpecification, StyleSpecification } from 'mapbox-gl';
    import { untrack } from 'svelte';

    let container: HTMLDivElement;
    let overpassLayer: OverpassLayer;

    const {
        currentBasemap,
        previousBasemap,
        currentOverlays,
        currentOverpassQueries,
        selectedBasemapTree,
        selectedOverlayTree,
        selectedOverpassTree,
        customLayers,
        opacities,
    } = settings;

    function setStyle() {
        if (!$map) {
            return;
        }
        let basemap = basemaps.hasOwnProperty($currentBasemap)
            ? basemaps[$currentBasemap]
            : ($customLayers[$currentBasemap]?.value ?? basemaps[defaultBasemap]);
        $map.removeImport('basemap');
        if (typeof basemap === 'string') {
            if (basemap.trim().length === 0) {
                // Fall back to default basemap if URL is empty
                basemap = basemaps[defaultBasemap];
            }
            $map.addImport({ id: 'basemap', url: basemap as string }, 'overlays');
        } else {
            // Validate tile URLs for inline styles
            if (!hasValidTileUrls(basemap as StyleSpecification, `basemap:${$currentBasemap}`)) {
                // Fall back to default basemap if tile URLs are invalid
                console.warn(`[LayerControl] Falling back to default basemap due to invalid URLs in "${$currentBasemap}"`);
                $map.addImport({ id: 'basemap', url: basemaps[defaultBasemap] as string }, 'overlays');
                return;
            }
            $map.addImport(
                {
                    id: 'basemap',
                    url: '',
                    data: basemap as StyleSpecification,
                },
                'overlays'
            );
        }
    }

    $effect(() => {
        if ($map && ($currentBasemap || $customBasemapUpdate)) {
            untrack(() => setStyle());
        }
    });

    function hasValidTileUrls(style: StyleSpecification, debugId?: string): boolean {
        // Check if all raster/vector sources have valid tile URLs
        if (!style.sources) return true;
        for (const [sourceId, source] of Object.entries(style.sources)) {
            if (source.type === 'raster' || source.type === 'vector' || source.type === 'raster-dem') {
                const tileSource = source as { tiles?: string[]; url?: string };
                if (tileSource.tiles) {
                    // Check that tiles array has at least one non-empty URL
                    const hasValidTile = tileSource.tiles.some((url) => url && url.trim().length > 0);
                    if (!hasValidTile) {
                        console.warn(`[LayerControl] Invalid tiles in source "${sourceId}" for ${debugId || 'unknown'}:`, tileSource.tiles);
                        return false;
                    }
                }
                if (tileSource.url !== undefined && tileSource.url.trim().length === 0) {
                    console.warn(`[LayerControl] Empty URL in source "${sourceId}" for ${debugId || 'unknown'}`);
                    return false;
                }
            }
        }
        return true;
    }

    function addOverlay(id: string) {
        if (!$map) {
            return;
        }
        try {
            let overlay = $customLayers.hasOwnProperty(id) ? $customLayers[id].value : overlays[id];
            if (typeof overlay === 'string') {
                if (overlay.trim().length === 0) {
                    // Skip overlays with empty URLs
                    return;
                }
                $map.addImport({ id, url: overlay });
            } else {
                // Skip overlays with invalid tile URLs
                if (!hasValidTileUrls(overlay as StyleSpecification, `overlay:${id}`)) {
                    console.warn(`[LayerControl] Skipping overlay "${id}" due to invalid tile URLs`);
                    return;
                }
                if ($opacities.hasOwnProperty(id)) {
                    overlay = {
                        ...overlay,
                        layers: (overlay as StyleSpecification).layers.map((layer) => {
                            if (layer.type === 'raster') {
                                if (!layer.paint) {
                                    layer.paint = {};
                                }
                                layer.paint['raster-opacity'] = $opacities[id];
                            }
                            return layer;
                        }),
                    };
                }
                $map.addImport({
                    id,
                    url: '',
                    data: overlay as StyleSpecification,
                });
            }
        } catch (e) {
            // No reliable way to check if the map is ready to add sources and layers
        }
    }

    function updateOverlays() {
        if ($map && $currentOverlays && $opacities) {
            let overlayLayers = getLayers($currentOverlays);
            try {
                let activeOverlays =
                    $map
                        .getStyle()
                        .imports?.reduce(
                            (
                                acc: Record<string, ImportSpecification>,
                                imprt: ImportSpecification
                            ) => {
                                if (!['basemap', 'overlays'].includes(imprt.id)) {
                                    acc[imprt.id] = imprt;
                                }
                                return acc;
                            },
                            {}
                        ) || {};
                let toRemove = Object.keys(activeOverlays).filter((id) => !overlayLayers[id]);
                toRemove.forEach((id) => {
                    $map?.removeImport(id);
                });
                let toAdd = Object.entries(overlayLayers)
                    .filter(([id, selected]) => selected && !activeOverlays.hasOwnProperty(id))
                    .map(([id]) => id);
                toAdd.forEach((id) => {
                    addOverlay(id);
                });
            } catch (e) {
                // No reliable way to check if the map is ready to add sources and layers
            }
        }
    }

    $effect(() => {
        if ($map && $currentOverlays && $opacities) {
            untrack(() => updateOverlays());
        }
    });

    map.onLoad((_map: mapboxgl.Map) => {
        if (overpassLayer) {
            overpassLayer.remove();
        }
        overpassLayer = new OverpassLayer(_map);
        overpassLayer.add();
        let first = true;
        _map.on('style.import.load', () => {
            if (!first) return;
            first = false;
            updateOverlays();
        });
    });

    let open = $state(false);
    function openLayerControl() {
        open = true;
    }
    function closeLayerControl() {
        open = false;
    }
    let cancelEvents = $state(false);
</script>

<CustomControl class="group min-w-[29px] min-h-[29px] overflow-hidden">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        bind:this={container}
        class="size-full"
        onmouseenter={openLayerControl}
        onmouseleave={closeLayerControl}
        onpointerenter={() => {
            if (!open) {
                cancelEvents = true;
                openLayerControl();
                setTimeout(() => {
                    cancelEvents = false;
                }, 500);
            }
        }}
    >
        <div
            class="flex flex-row justify-center items-center delay-100 transition-[opacity] duration-0 {open
                ? 'opacity-0 size-0 delay-0'
                : 'w-[29px] h-[29px]'}"
        >
            <Layers size="20" />
        </div>
        <div
            class="transition-[grid-template-rows grid-template-cols] grid grid-rows-[0fr] grid-cols-[0fr] duration-150 h-full {open
                ? 'grid-rows-[1fr] grid-cols-[1fr]'
                : ''} {cancelEvents ? 'pointer-events-none' : ''}"
        >
            <ScrollArea class="overflow-hidden">
                <div class="h-fit">
                    <div class="p-2 ml-1">
                        <LayerTree
                            layerTree={$selectedBasemapTree}
                            name="basemaps"
                            selected={$currentBasemap}
                            onselect={(value) => {
                                $previousBasemap = $currentBasemap;
                                $currentBasemap = value;
                            }}
                        />
                    </div>
                    <Separator class="w-full" />
                    <div class="p-2 ml-1">
                        {#if $currentOverlays}
                            <LayerTree
                                layerTree={$selectedOverlayTree}
                                name="overlays"
                                multiple={true}
                                bind:checked={$currentOverlays}
                            />
                        {/if}
                    </div>
                    <Separator class="w-full" />
                    <div class="p-2 ml-1">
                        {#if $currentOverpassQueries}
                            <LayerTree
                                layerTree={$selectedOverpassTree}
                                name="overpass"
                                multiple={true}
                                bind:checked={$currentOverpassQueries}
                            />
                        {/if}
                    </div>
                </div>
            </ScrollArea>
        </div>
    </div>
</CustomControl>

<svelte:window
    on:click={(e: MouseEvent) => {
        const target = e.target as Node | null;
        if (open && !cancelEvents && target && container && !container.contains(target)) {
            closeLayerControl();
        }
    }}
/>
