<script lang="ts">
    // The one Share control (2026-08-01 unified-routes spec). Replaces the old
    // two-verb dialog (friend-link + "submit to DEF CON run"): sharing is now a
    // single exclusive choice of three states, and the admin curation queue is
    // gone from the UI because self-serve Public does that job directly.
    import * as Dialog from '$lib/components/ui/dialog/index.js';
    import * as RadioGroup from '$lib/components/ui/radio-group/index.js';
    import { Button } from '$lib/components/ui/button';
    import { Label } from '$lib/components/ui/label';
    import {
        Share2,
        Copy,
        Loader2,
        AlertCircle,
        Check,
        Globe,
        Lock,
        Link2,
    } from '@lucide/svelte';
    import {
        getApiBase,
        setShareState,
        type ShareState,
        type CloudFile,
    } from '$lib/cloud-sync';

    let {
        open = $bindable(false),
        file = null as CloudFile | null,
        onStateChange = undefined as (() => void) | undefined,
    }: {
        open?: boolean;
        file: CloudFile | null;
        // Fires after a successful transition so My Routes can refresh the row
        // badge without a full reload.
        onStateChange?: (() => void) | undefined;
    } = $props();

    let busy = $state(false);
    let error: string | null = $state(null);
    let state: ShareState = $state('private');
    let shareUrl = $state('');
    let copied = $state(false);
    let aggregate = $state(false);
    let aggregateBusy = $state(false);

    // Seed from the file every time the dialog opens. `publishedRouteId` is the
    // authoritative "this is Public" signal; a live token is discovered by
    // asking the shares endpoint, which is also where its URL comes back.
    $effect(() => {
        if (open && file) {
            error = null;
            shareUrl = '';
            copied = false;
            aggregate = file.includeInAggregate ?? false;
            state = file.publishedRouteId ? 'public' : 'private';
            void loadExistingLink();
        }
    });

    async function loadExistingLink() {
        if (!file || file.publishedRouteId) return;
        try {
            const response = await fetch(`${getApiBase()}/shares?fileId=${file.fileId}`, {
                credentials: 'include',
            });
            if (!response.ok) return;
            const data = await response.json();
            const live = (data.shares ?? [])[0];
            if (live) {
                state = 'link';
                shareUrl = live.shareUrl ?? '';
            }
        } catch {
            // A failed probe just leaves the dialog showing Private; choosing a
            // state re-asserts the truth server-side anyway.
        }
    }

    async function choose(next: ShareState) {
        if (!file || busy || next === state) return;
        busy = true;
        error = null;
        try {
            const result = await setShareState(file.fileId, next);
            state = result.state;
            shareUrl = result.shareUrl ?? '';
            onStateChange?.();
        } catch (e) {
            error = e instanceof Error ? e.message : 'Could not update sharing';
        } finally {
            busy = false;
        }
    }

    // Orthogonal to the three states: anonymity, not sharing. The overlay
    // carries zero identifying properties.
    async function toggleAggregate(next: boolean) {
        if (!file || aggregateBusy) return;
        aggregateBusy = true;
        error = null;
        try {
            const response = await fetch(
                `${getApiBase()}/files/${file.fileId}/aggregate-optin`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ include: next }),
                }
            );
            if (!response.ok) throw new Error('Could not update the overlay opt-in');
            aggregate = next;
            onStateChange?.();
        } catch (e) {
            error = e instanceof Error ? e.message : 'Could not update the overlay opt-in';
        } finally {
            aggregateBusy = false;
        }
    }

    async function copyToClipboard() {
        try {
            await navigator.clipboard.writeText(shareUrl);
            copied = true;
            setTimeout(() => (copied = false), 2000);
        } catch {
            error = 'Failed to copy to clipboard';
        }
    }
</script>

<Dialog.Root bind:open>
    <Dialog.Content class="!max-w-[460px] !w-[90vw] max-h-[85vh] overflow-y-auto">
        <Dialog.Header>
            <Dialog.Title class="flex items-center gap-2">
                <Share2 class="h-5 w-5" />
                Share {file?.fileName || 'route'}
            </Dialog.Title>
        </Dialog.Header>

        <div class="space-y-4">
            {#if error}
                <div
                    class="bg-destructive/10 text-destructive px-4 py-2 rounded-md text-sm flex items-center gap-2"
                >
                    <AlertCircle class="h-4 w-4 flex-shrink-0" />
                    {error}
                </div>
            {/if}

            <RadioGroup.Root
                value={state}
                onValueChange={(v) => choose(v as ShareState)}
                class="space-y-3"
            >
                <div class="flex items-start gap-3">
                    <RadioGroup.Item value="private" id="share-private" disabled={busy} />
                    <Label for="share-private" class="cursor-pointer font-normal space-y-0.5">
                        <span class="flex items-center gap-1.5 font-medium">
                            <Lock class="h-4 w-4" /> Private
                        </span>
                        <span class="block text-xs text-muted-foreground">
                            Only you can see it.
                        </span>
                    </Label>
                </div>

                <div class="flex items-start gap-3">
                    <RadioGroup.Item value="link" id="share-link" disabled={busy} />
                    <Label for="share-link" class="cursor-pointer font-normal space-y-0.5">
                        <span class="flex items-center gap-1.5 font-medium">
                            <Link2 class="h-4 w-4" /> Anyone with the link
                        </span>
                        <span class="block text-xs text-muted-foreground">
                            Hand someone a URL. It stays off the community map.
                        </span>
                    </Label>
                </div>

                <div class="flex items-start gap-3">
                    <RadioGroup.Item value="public" id="share-public" disabled={busy} />
                    <Label for="share-public" class="cursor-pointer font-normal space-y-0.5">
                        <span class="flex items-center gap-1.5 font-medium">
                            <Globe class="h-4 w-4" /> Public on the map
                        </span>
                        <span class="block text-xs text-muted-foreground">
                            Every defcon.run runner can find it and add it to their routes.
                        </span>
                    </Label>
                </div>
            </RadioGroup.Root>

            {#if busy}
                <div class="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 class="h-4 w-4 animate-spin" /> Updating…
                </div>
            {/if}

            {#if state === 'link' && shareUrl}
                <div class="space-y-2">
                    <Label>Share URL</Label>
                    <div class="flex gap-2">
                        <input
                            type="text"
                            readonly
                            value={shareUrl}
                            class="flex-1 border rounded px-3 py-2 text-sm bg-muted/30 truncate"
                        />
                        <Button
                            variant="outline"
                            size="icon"
                            onclick={copyToClipboard}
                            title="Copy to clipboard"
                        >
                            {#if copied}
                                <Check class="h-4 w-4 text-green-600" />
                            {:else}
                                <Copy class="h-4 w-4" />
                            {/if}
                        </Button>
                    </div>
                </div>
            {/if}

            <!-- Orthogonal to the three states above: this is anonymity, not
                 sharing. The overlay carries zero identifying properties. -->
            <div class="pt-4 border-t">
                <label class="flex items-start gap-2 cursor-pointer text-sm">
                    <input
                        type="checkbox"
                        class="mt-0.5"
                        checked={aggregate}
                        disabled={aggregateBusy}
                        onchange={(e) => toggleAggregate(e.currentTarget.checked)}
                    />
                    <span>
                        Also blend into the anonymous heat overlay
                        <span class="block text-xs text-muted-foreground">
                            Adds the shape only — no name, no link back to you.
                        </span>
                    </span>
                </label>
            </div>
        </div>
    </Dialog.Content>
</Dialog.Root>
