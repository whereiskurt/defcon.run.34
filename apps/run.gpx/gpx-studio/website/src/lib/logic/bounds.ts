import { get } from 'svelte/store';
import { selection } from '$lib/logic/selection';
import mapboxgl from 'mapbox-gl';
import { ListFileItem, ListWaypointItem } from '$lib/components/file-list/file-list';
import { fileStateCollection, GPXFileStateCollectionObserver } from '$lib/logic/file-state';
import { gpxStatistics } from '$lib/logic/statistics';
import { map } from '$lib/components/map/map';
import type { GPXFileWithStatistics } from './statistics-tree';
import type { Coordinates } from 'gpx';

/**
 * NOTE: there is deliberately NO auto-fit observer in this class.
 *
 * A blanket `GPXFileStateCollectionObserver` used to live in the constructor and
 * fit the camera whenever ANY file entered the collection — no user action
 * involved. On a normal studio load that meant the files restored from IndexedDB
 * (`fileStateCollection.connectToDatabase`) yanked the map: it fired LAST
 * (`finalizeFitBounds` waits for every file's bounds to resolve), snapped
 * instantly (`easing: () => 1`), and passed no `maxZoom` — unlike every other fit
 * in this codebase — so a runner who had already zoomed into an area was pulled
 * back out to the union of everything they had open.
 *
 * Its only guard was `page.url.hash.length == 0`, which does not hold up in
 * practice: mapbox maintains the `#zoom/lat/lng` hash itself via
 * `history.replaceState`, which SvelteKit's `page.url` never observes. So once
 * the runner had panned or zoomed, the guard still read an empty hash and the
 * fit ran anyway.
 *
 * Fitting on a REAL user action is unchanged and still explicit — opening,
 * importing, or dropping a file calls `fitBoundsOnLoad` directly (file-actions,
 * strava-import, CloudStorage, Embedding), and the menu's recenter calls
 * `centerMapOnSelection`. A fresh visitor still lands framed on the LVCC via the
 * map's default center. This matches the rule the layer modules already follow:
 * a restore must never move the camera. (Kurt 2026-08-04)
 */
export class BoundsManager {
    private _bounds: mapboxgl.LngLatBounds = new mapboxgl.LngLatBounds();
    private _files: Set<string> = new Set();
    private _fileStateCollectionObserver: GPXFileStateCollectionObserver | null = null;
    private _unsubscribes: (() => void)[] = [];

    fitBoundsOnLoad(files: string[]) {
        this.reset();

        this._files = new Set(files);
        this._fileStateCollectionObserver = new GPXFileStateCollectionObserver(
            (newFiles) => {
                newFiles.forEach((fileState, fileId) => {
                    if (this._files.has(fileId)) {
                        this._unsubscribes.push(
                            fileState.subscribe((state) => {
                                this.addBoundsFromFile(fileId, state);
                            })
                        );
                    }
                });
            },
            (fileId) => {},
            () => {}
        );
    }

    addBoundsFromFile(fileId: string, file: GPXFileWithStatistics | undefined) {
        if (!file || !this._files.has(fileId)) return;

        this._files.delete(fileId);

        const bounds = file.statistics.getStatisticsFor(new ListFileItem(fileId)).global.bounds;
        if (!this.validBounds(bounds)) return;

        this._bounds.extend(bounds.southWest);
        this._bounds.extend(bounds.northEast);

        if (this._files.size === 0) {
            this.finalizeFitBounds();
        }
    }

    finalizeFitBounds() {
        if (
            this._bounds.getSouth() >= this._bounds.getNorth() &&
            this._bounds.getWest() >= this._bounds.getEast()
        ) {
            return;
        }

        this._unsubscribes.push(
            map.subscribe((map_) => {
                if (!map_) return;
                // Switch from globe to mercator projection when viewing files
                // Globe is only shown at startup, flat map is better for editing tracks
                if (map_.getProjection().name === 'globe') {
                    map_.setProjection('mercator');
                }
                map_.fitBounds(this._bounds, { padding: 80, linear: true, easing: () => 1 });
                this.reset();
            })
        );
    }

    reset() {
        if (this._fileStateCollectionObserver) {
            this._fileStateCollectionObserver.destroy();
        }
        this._unsubscribes.forEach((unsubscribe) => unsubscribe());
        this._unsubscribes = [];
        this._bounds = new mapboxgl.LngLatBounds([180, 90, -180, -90]);
    }

    centerMapOnSelection() {
        let selected = get(selection).getSelected();
        let bounds = new mapboxgl.LngLatBounds();

        if (selected.find((item) => item instanceof ListWaypointItem)) {
            selection.applyToOrderedSelectedItemsFromFile((fileId, level, items) => {
                let file = fileStateCollection.getFile(fileId);
                if (file) {
                    items.forEach((item) => {
                        if (item instanceof ListWaypointItem) {
                            let waypoint = file.wpt[item.getWaypointIndex()];
                            if (waypoint) {
                                bounds.extend([waypoint.getLongitude(), waypoint.getLatitude()]);
                            }
                        }
                    });
                }
            });
        } else {
            let selectionBounds = get(gpxStatistics).global.bounds;
            bounds.setNorthEast(selectionBounds.northEast);
            bounds.setSouthWest(selectionBounds.southWest);
        }

        get(map)?.fitBounds(bounds, {
            padding: 80,
            easing: () => 1,
            maxZoom: 15,
        });
    }

    validBounds(bounds: { southWest: Coordinates; northEast: Coordinates }) {
        return (
            bounds.southWest.lat !== 90 ||
            bounds.southWest.lon !== 180 ||
            bounds.northEast.lat !== -90 ||
            bounds.northEast.lon !== -180
        );
    }
}

export const boundsManager = new BoundsManager();
