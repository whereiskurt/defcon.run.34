import type { LayerTreeType } from '$lib/assets/layers';

/**
 * Flatten a layer tree into the ids of every enabled leaf, depth-first in
 * key-insertion order. Object values recurse; disabled leaves are skipped; an
 * absent tree yields nothing.
 *
 * Insertion order is the whole point: it is what makes the `basemaps.world`
 * group come out ahead of the per-country groups, matching the order the
 * nested tree renders today. Dependency-free on purpose (the `*-pure.ts`
 * convention) — gpx-studio has no test runner, so this stays readable and
 * checkable without a component harness.
 */
export function flattenLayerTree(tree: LayerTreeType | undefined): string[] {
    if (!tree) {
        return [];
    }
    const ids: string[] = [];
    const walk = (node: LayerTreeType) => {
        for (const key of Object.keys(node)) {
            const value = node[key];
            if (typeof value === 'boolean') {
                if (value) {
                    ids.push(key);
                }
            } else if (value) {
                walk(value);
            }
        }
    };
    walk(tree);
    return ids;
}
