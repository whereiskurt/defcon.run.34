<script lang="ts">
    import CustomControl from '$lib/components/map/custom-control/CustomControl.svelte';
    import LayerTree from './LayerTree.svelte';
    import PublicOverlays from './PublicOverlays.svelte';
    import MyConRuns from './MyConRuns.svelte';
    import ConDaySaveDialog from '$lib/components/cloud/ConDaySaveDialog.svelte';
    import { cloudFiles, type CloudFile } from '$lib/cloud-sync';
    import { OverpassLayer } from './overpass-layer';
    import { PublicOverlaysLayer, publicOverlayGroups, publicAggregate } from '../public-overlays';
    import { MyConRunsLayer, myConRunGroups } from '../my-con-runs';
    import { myConRunsRefresh, myConRunsReveal } from '$lib/stores/my-con-runs';
    import { isAuthenticated } from '$lib/stores/auth';
    import { GhostLayer } from '$lib/components/map/ghost-layer';
    import { RabbitLayer } from '$lib/components/map/rabbit-layer';
    import { RainbowArch } from '$lib/components/map/rainbow-arch';
    import { fireRainbowEgg } from '$lib/components/map/rainbow-egg';
    import { CoffeeCup } from '$lib/components/map/coffee-cup';
    import { TheSpot } from '$lib/components/map/the-spot';
    import { fireCoffeeEgg } from '$lib/components/map/coffee-egg';
    import { ghostMode } from '$lib/stores/ghost';
    import { rainbowUnlocked, forcedArchIds } from '$lib/stores/rainbow';
    import { coffeeUnlocked } from '$lib/stores/coffee';
    import { quickStartAction } from '$lib/stores/quickstart';
    import { get } from 'svelte/store';
    import { Separator } from '$lib/components/ui/separator';
    import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
    import { Layers } from '@lucide/svelte';
    import { basemaps, defaultBasemap, overlays } from '$lib/assets/layers';
    import { settings } from '$lib/logic/settings';
    import { map } from '$lib/components/map/map';
    import { customBasemapUpdate, getLayers } from './utils';
    import type { ImportSpecification, StyleSpecification } from 'mapbox-gl';
    import { onMount, untrack } from 'svelte';
    import { mode } from 'mode-watcher';

    // DEF CON: in dark UI mode, swap the outdoors basemap for a dark map so the
    // tiles darken with the theme. Only Mapbox styles have a dark equivalent;
    // other basemaps (OSM, topo, satellite, ...) are left unchanged.
    const darkBasemapFor: Record<string, string> = {
        mapboxOutdoors: 'mapboxDark',
    };

    let container: HTMLDivElement;
    let overpassLayer: OverpassLayer;
    let publicOverlaysLayer: PublicOverlaysLayer | undefined = $state();
    let myConRunsLayer: MyConRunsLayer | undefined = $state();
    // Task 11 fix: isAuthenticated resolves async (session fetch), so a one-shot
    // check at map.onLoad time raced it on a normal page load. These back the
    // subscription below that loads the layer the FIRST time auth resolves true.
    let myConRunsAuthUnsubscribe: (() => void) | undefined;
    let myConRunsLoadAttempted = false;
    let ghostLayer: GhostLayer | undefined;
    let rabbitLayer: RabbitLayer | undefined;
    let rainbowArch: RainbowArch | undefined;
    let coffeeCup: CoffeeCup | undefined;
    let theSpot: TheSpot | undefined;

    // Task 8 (popup -> day-assign bridge): the file whose con-day assign
    // dialog is open, opened from a run-track popup's "Add as accomplishment"
    // button (run-popup.ts's dayChipHtml) via a delegated document click
    // listener + `dc34-open-day-assign` window CustomEvent — see onMount
    // below. Reuses ConDaySaveDialog exactly as CloudStorage.svelte does
    // (a local `CloudFile | null` gating an `{#if}`-rendered dialog instance).
    let assignDialogFile: CloudFile | undefined = $state();

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
        // Resolve the effective basemap key: in dark mode, a Mapbox basemap with a
        // dark equivalent is swapped out. Custom layers still key off $currentBasemap.
        const styleKey =
            mode.current === 'dark' && darkBasemapFor[$currentBasemap]
                ? darkBasemapFor[$currentBasemap]
                : $currentBasemap;
        let basemap = basemaps.hasOwnProperty(styleKey)
            ? basemaps[styleKey]
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
        // Track mode.current so toggling light/dark re-styles the live map.
        const currentMode = mode.current;
        if ($map && ($currentBasemap || $customBasemapUpdate || currentMode)) {
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
        if (publicOverlaysLayer) {
            publicOverlaysLayer.remove();
        }
        publicOverlaysLayer = new PublicOverlaysLayer(_map);
        publicOverlaysLayer.add();
        if (myConRunsLayer) myConRunsLayer.remove();
        if (myConRunsAuthUnsubscribe) {
            myConRunsAuthUnsubscribe();
            myConRunsAuthUnsubscribe = undefined;
        }
        myConRunsLayer = new MyConRunsLayer(_map);
        // Subscribe rather than one-shot check: isAuthenticated flips true only
        // once the async session fetch resolves, well after this callback runs
        // on a normal page load. Load on the FIRST true; loadAttempted stops a
        // second load if the store flips again (MyConRunsLayer.load() also
        // guards internally via `loaded`, so this composes safely with reload()).
        myConRunsLoadAttempted = false;
        myConRunsAuthUnsubscribe = isAuthenticated.subscribe((authed) => {
            if (authed && !myConRunsLoadAttempted && myConRunsLayer) {
                myConRunsLoadAttempted = true;
                void myConRunsLayer.load();
            }
        });
        if (ghostLayer) ghostLayer.remove();
        ghostLayer = new GhostLayer(_map);
        // Reveal/hide with the hidden ghostMode store (default off). map.onLoad
        // callbacks fire exactly once per component lifetime (Map._onLoadCallbacks
        // is drained after firing, and LayerControl is mounted once at app root),
        // so this single subscription does not accumulate/leak.
        ghostMode.subscribe((on) => {
            void ghostLayer?.setVisible(on);
        });
        if (rabbitLayer) rabbitLayer.remove();
        rabbitLayer = new RabbitLayer(_map);
        // Rabbit Layer is default-ON: only opted-in (verified && showOnMap) users appear.
        void rabbitLayer.setVisible(true);
        // Hidden "Rainbow Bridges" easter egg: default-locked, revealed by the
        // rapid-3D-flip gesture (map.toggle3D) then pitch-gated. On unlock we also
        // fire the covert CTF award (rainbow-egg), once — same single-subscription
        // safety as ghostMode above.
        if (rainbowArch) rainbowArch.remove();
        rainbowArch = new RainbowArch(_map);
        rainbowUnlocked.subscribe((on) => {
            void rainbowArch?.setUnlocked(on);
            if (on) fireRainbowEgg();
        });
        // Search keywords (weed/dd/vegas) toggle single arches (see map.ts geocoder).
        forcedArchIds.subscribe((ids) => void rainbowArch?.setForced(ids));
        // Giant PublicUs coffee cup: always-on (tilt-revealed), upgraded by
        // searching publicus/coffee (steam + opacity). Same single-subscription
        // safety as above; unlock + click both fire the covert coffee-egg.
        if (coffeeCup) coffeeCup.remove();
        coffeeCup = new CoffeeCup(_map);
        // "The Spot" rally-point siren at LVCC West: always-on wayfinding beacon,
        // click -> dc34-spot modal. No unlock/CTF wiring.
        if (theSpot) theSpot.remove();
        theSpot = new TheSpot(_map);
        coffeeUnlocked.subscribe((on) => {
            void coffeeCup?.setUnlocked(on);
            if (on) fireCoffeeEgg();
        });
        let first = true;
        _map.on('style.import.load', () => {
            if (!first) return;
            first = false;
            updateOverlays();
        });
    });

    // Task 8: popup "Add as accomplishment" -> day-assign dialog bridge. Run
    // popups are raw-HTML Mapbox popups (run-popup.ts), not Svelte components,
    // so they can't call into this component directly — instead the button
    // carries `data-dc34-assign="<fileId>"` and a SINGLE delegated document
    // click listener (registered once here, cleaned up on destroy via the
    // onMount return) forwards it as a `dc34-open-day-assign` window
    // CustomEvent, which this same component also listens for and handles by
    // opening ConDaySaveDialog for that file (assignDialogFile above).
    onMount(() => {
        const onDocumentClick = (e: MouseEvent) => {
            const target = (e.target as HTMLElement | null)?.closest?.(
                '[data-dc34-assign]'
            ) as HTMLElement | null;
            const fileId = target?.dataset.dc34Assign;
            if (!fileId) return;
            window.dispatchEvent(
                new CustomEvent('dc34-open-day-assign', { detail: { fileId } })
            );
        };
        const onOpenDayAssign = (e: Event) => {
            const fileId = (e as CustomEvent<{ fileId: string }>).detail?.fileId;
            if (!fileId) return;
            // Reuse whatever's already cached in the `cloudFiles` store (warm
            // from an earlier My Maps open) for a richer dialog (createdAt for
            // guessConDay); fall back to a minimal stub for the con-day-cap
            // check + save, same as CloudStorage.svelte's conDayDialogFile.
            assignDialogFile = get(cloudFiles).find((f) => f.fileId === fileId) ?? {
                fileId,
                fileName: '',
                fileSize: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };
        };
        document.addEventListener('click', onDocumentClick);
        window.addEventListener('dc34-open-day-assign', onOpenDayAssign);
        return () => {
            document.removeEventListener('click', onDocumentClick);
            window.removeEventListener('dc34-open-day-assign', onOpenDayAssign);
        };
    });

    // Whether the "Overlays" tree has any actual layers. For DEF CON it's empty
    // (`{ overlays: {} }`), so we hide that whole band to tidy the panel.
    let hasOverlays = $derived(
        !!$selectedOverlayTree &&
            Object.values($selectedOverlayTree).some(
                (v) => v && typeof v === 'object' && Object.keys(v as object).length > 0
            )
    );

    let open = $state(false);
    function openLayerControl() {
        open = true;
    }
    function closeLayerControl() {
        open = false;
    }
    let cancelEvents = $state(false);

    // Phase 60: react to the QuickStart card hub. 'routes' → show every DEF CON
    // route group + open the panel; 'runners' → ensure the rabbit runner layer is
    // on + open the panel. Ghost mode is NEVER touched here. Fires only on a user
    // card click (well after map load), so the layer instances are set by then.
    // LayerControl mounts once at app root, so this single subscription is safe.
    quickStartAction.subscribe((action) => {
        if (!action) return;
        if (action === 'routes' && publicOverlaysLayer) {
            for (const group of get(publicOverlayGroups)) {
                publicOverlaysLayer.setGroupVisible(group.folderId, true);
            }
            open = true;
        } else if (action === 'runners' && rabbitLayer) {
            void rabbitLayer.setVisible(true);
            open = true;
        }
        quickStartAction.set(null);
    });

    // Task 11: bump myConRunsRefresh (e.g. after a fresh import/re-tag) to re-fetch
    // the "My DEF CON Runs" manifest. n starts at 0, so `n > 0` already guards the
    // initial fire. LayerControl mounts once at app root, so this single
    // subscription is safe (same convention as ghostMode/quickStartAction above).
    // UAT round 3 fix B: reload() is async. The one-shot myConRunsReveal
    // command (set by the caller BEFORE bumping myConRunsRefresh) is captured
    // and cleared SYNCHRONOUSLY here — store subscribers run synchronously on
    // set(), so this ties each reveal to its own triggering bump. Consuming it
    // inside .then() instead would let overlapping reloads (multi-card imports,
    // ConDaySaveDialog, sync-now — none of which set a reveal) steal or drop a
    // pending reveal and jump the camera to an unrelated run.
    myConRunsRefresh.subscribe((n) => {
        if (n > 0 && myConRunsLayer) {
            const layer = myConRunsLayer;
            const reveal = get(myConRunsReveal);
            myConRunsReveal.set(null);
            void layer
                .reload()
                .then(() => {
                    if (reveal) layer.revealConRun(reveal.fileId);
                })
                .catch((e) => console.warn('[my-con-runs] reload failed', e));
        }
    });
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
                            defaultState="closed"
                            onselect={(value) => {
                                $previousBasemap = $currentBasemap;
                                $currentBasemap = value;
                            }}
                        />
                    </div>
                    {#if hasOverlays}
                        <Separator class="w-full" />
                        <div class="p-2 ml-1">
                            <LayerTree
                                layerTree={$selectedOverlayTree}
                                name="overlays"
                                multiple={true}
                                bind:checked={$currentOverlays}
                            />
                        </div>
                    {/if}
                    {#if $publicOverlayGroups.length > 0 || $publicAggregate.available}
                        <Separator class="w-full" />
                        <div class="p-2 ml-1">
                            <PublicOverlays layer={publicOverlaysLayer} />
                        </div>
                    {/if}
                    {#if $myConRunGroups.length > 0}
                        <Separator class="w-full" />
                        <div class="p-2 ml-1">
                            <div class="mb-1 text-xs font-semibold uppercase tracking-wide opacity-60">
                                My DEF CON Runs
                            </div>
                            <MyConRuns layer={myConRunsLayer} />
                        </div>
                    {/if}
                    <!-- POI/Overpass section removed for DEF CON -->
                </div>
            </ScrollArea>
        </div>
    </div>
</CustomControl>

<svelte:window
    on:click={(e: MouseEvent) => {
        // Use composedPath() (captured at dispatch) rather than container.contains(e.target):
        // clicking a collapse chevron swaps its icon node, so by the time this handler
        // runs the original target is detached and contains() would wrongly report the
        // click as "outside", closing the panel on every expand/collapse.
        if (!open || cancelEvents || !container) return;
        if (!e.composedPath().includes(container)) {
            closeLayerControl();
        }
    }}
/>

{#if assignDialogFile}
    <ConDaySaveDialog
        file={assignDialogFile}
        open={true}
        onClose={() => (assignDialogFile = undefined)}
        onSaved={() => (assignDialogFile = undefined)}
    />
{/if}
