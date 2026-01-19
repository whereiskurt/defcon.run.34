<script lang="ts">
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Textarea } from '$lib/components/ui/textarea';
    import { Label } from '$lib/components/ui/label/index.js';
    import * as Popover from '$lib/components/ui/popover';
    import { Save } from '@lucide/svelte';
    import { ListFileItem, ListTrackItem, type ListItem } from '../file-list';
    import { GPXTreeElement, Track, type AnyGPXTreeElement, Waypoint, GPXFile } from 'gpx';
    import { i18n } from '$lib/i18n.svelte';
    import { editMetadata } from '$lib/components/file-list/metadata/utils.svelte';
    import { fileActionManager } from '$lib/logic/file-action-manager';
    import { autoSaveManager } from '$lib/auto-save';

    let {
        node,
        item,
        open = $bindable(),
    }: {
        node: GPXTreeElement<AnyGPXTreeElement> | Waypoint[] | Waypoint;
        item: ListItem;
        open: boolean;
    } = $props();

    let name: string = $derived(
        node instanceof GPXFile
            ? (node.metadata.name ?? '')
            : node instanceof Track
              ? (node.name ?? '')
              : ''
    );
    let description: string = $derived(
        node instanceof GPXFile
            ? (node.metadata.desc ?? '')
            : node instanceof Track
              ? (node.desc ?? '')
              : ''
    );

    $effect(() => {
        if (!open) {
            editMetadata.current = false;
        }
    });
</script>

<Popover.Root bind:open>
    <Popover.Trigger class="-mx-1" />
    <Popover.Content side="top" sideOffset={22} alignOffset={30} class="flex flex-col gap-3">
        <Label for="name">{i18n._('menu.metadata.name')}</Label>
        <Input bind:value={name} id="name" class="font-semibold h-8" />
        <Label for="description">{i18n._('menu.metadata.description')}</Label>
        <Textarea bind:value={description} id="description" />
        <Button
            variant="outline"
            onclick={() => {
                const fileId = item.getFileId();
                const isFileRename = item instanceof ListFileItem && node instanceof GPXFile;
                const previousName = isFileRename ? node.metadata.name : null;

                fileActionManager.applyToFile(fileId, (file) => {
                    if (item instanceof ListFileItem && node instanceof GPXFile) {
                        file.metadata.name = name;
                        file.metadata.desc = description;
                        if (file.trk.length === 1) {
                            file.trk[0].name = name;
                        }
                    } else if (item instanceof ListTrackItem && node instanceof Track) {
                        file.trk[item.getTrackIndex()].name = name;
                        file.trk[item.getTrackIndex()].desc = description;
                    }
                });

                // Handle cloud file rename if this is a file-level rename
                if (isFileRename && name !== previousName) {
                    autoSaveManager.handleFileRenamed(fileId, name);
                }

                open = false;
            }}
        >
            <Save size="16" />
            {i18n._('menu.metadata.save')}
        </Button>
    </Popover.Content>
</Popover.Root>
