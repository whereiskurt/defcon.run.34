<script lang="ts">
    import * as Dialog from '$lib/components/ui/dialog/index.js';
    import * as RadioGroup from '$lib/components/ui/radio-group/index.js';
    import { Button } from '$lib/components/ui/button';
    import { Textarea } from '$lib/components/ui/textarea';
    import { Label } from '$lib/components/ui/label';
    import {
        Share2,
        Copy,
        Trash2,
        Loader2,
        AlertCircle,
        Check,
        Globe,
        Lock,
    } from '@lucide/svelte';
    import { getApiBase, type CloudFile } from '$lib/cloud-sync';

    interface Share {
        shareId: string;
        fileId: string;
        version: number;
        accessMode: 'public' | 'private';
        allowedEmails?: string[];
        createdAt: number;
        shareUrl: string;
    }

    // Props
    let {
        open = $bindable(false),
        file = null as CloudFile | null,
    }: {
        open?: boolean;
        file: CloudFile | null;
    } = $props();

    // State
    let loading = $state(false);
    let error: string | null = $state(null);
    let accessMode: 'public' | 'private' = $state('public');
    let emails = $state('');
    let shareUrl = $state('');
    let shares: Share[] = $state([]);
    let copied = $state(false);
    let copiedShareId: string | null = $state(null);

    // Load shares when dialog opens
    $effect(() => {
        if (open && file) {
            loadShares();
            // Reset form state
            accessMode = 'public';
            emails = '';
            shareUrl = '';
            error = null;
        }
    });

    async function loadShares() {
        if (!file) return;

        loading = true;
        error = null;
        try {
            const response = await fetch(`${getApiBase()}/shares?fileId=${file.fileId}`, {
                credentials: 'include',
            });

            if (!response.ok) {
                throw new Error('Failed to load shares');
            }

            const data = await response.json();
            shares = data.shares || [];
        } catch (e) {
            error = e instanceof Error ? e.message : 'Failed to load shares';
        } finally {
            loading = false;
        }
    }

    async function createShare() {
        if (!file) return;

        // Validate emails for private mode
        if (accessMode === 'private') {
            const emailList = parseEmails(emails);
            if (emailList.length === 0) {
                error = 'Please enter at least one email address for private shares';
                return;
            }
        }

        loading = true;
        error = null;
        try {
            const body: {
                fileId: string;
                version: number;
                accessMode: 'public' | 'private';
                allowedEmails?: string[];
            } = {
                fileId: file.fileId,
                version: 1, // Use version 1 for now (current version)
                accessMode,
            };

            if (accessMode === 'private') {
                body.allowedEmails = parseEmails(emails);
            }

            const response = await fetch(`${getApiBase()}/shares`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'Failed to create share');
            }

            const data = await response.json();
            shareUrl = data.shareUrl;

            // Reload shares list
            await loadShares();
        } catch (e) {
            error = e instanceof Error ? e.message : 'Failed to create share';
        } finally {
            loading = false;
        }
    }

    async function revokeShare(shareId: string) {
        if (!confirm('Are you sure you want to revoke this share link?')) {
            return;
        }

        loading = true;
        error = null;
        try {
            const response = await fetch(`${getApiBase()}/shares/${shareId}`, {
                method: 'DELETE',
                credentials: 'include',
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'Failed to revoke share');
            }

            // Reload shares list
            await loadShares();
        } catch (e) {
            error = e instanceof Error ? e.message : 'Failed to revoke share';
        } finally {
            loading = false;
        }
    }

    function parseEmails(input: string): string[] {
        return input
            .split(/[,\n]/)
            .map(email => email.trim().toLowerCase())
            .filter(email => email.length > 0 && email.includes('@'));
    }

    async function copyToClipboard() {
        try {
            await navigator.clipboard.writeText(shareUrl);
            copied = true;
            setTimeout(() => {
                copied = false;
            }, 2000);
        } catch (e) {
            error = 'Failed to copy to clipboard';
        }
    }

    async function copyShareUrl(share: Share) {
        try {
            await navigator.clipboard.writeText(share.shareUrl);
            copiedShareId = share.shareId;
            setTimeout(() => {
                copiedShareId = null;
            }, 2000);
        } catch (e) {
            error = 'Failed to copy to clipboard';
        }
    }

    function formatDate(timestamp: number): string {
        const date = new Date(timestamp);
        return date.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
        });
    }

    function closeDialog() {
        open = false;
    }
</script>

<Dialog.Root bind:open onOpenChange={(isOpen) => !isOpen && closeDialog()}>
    <Dialog.Content class="!max-w-[500px] !w-[90vw] max-h-[85vh] overflow-y-auto">
        <Dialog.Header>
            <Dialog.Title class="flex items-center gap-2">
                <Share2 class="h-5 w-5" />
                Share {file?.fileName || 'File'}
            </Dialog.Title>
        </Dialog.Header>

        <div class="space-y-4">
            <!-- Error message -->
            {#if error}
                <div class="bg-destructive/10 text-destructive px-4 py-2 rounded-md text-sm flex items-center gap-2">
                    <AlertCircle class="h-4 w-4 flex-shrink-0" />
                    {error}
                </div>
            {/if}

            <!-- Access Mode Selection -->
            <div class="space-y-3">
                <Label>Access Mode</Label>
                <RadioGroup.Root bind:value={accessMode} class="flex gap-4">
                    <div class="flex items-center gap-2">
                        <RadioGroup.Item value="public" id="public" />
                        <Label for="public" class="flex items-center gap-1 cursor-pointer font-normal">
                            <Globe class="h-4 w-4" />
                            Public
                        </Label>
                    </div>
                    <div class="flex items-center gap-2">
                        <RadioGroup.Item value="private" id="private" />
                        <Label for="private" class="flex items-center gap-1 cursor-pointer font-normal">
                            <Lock class="h-4 w-4" />
                            Private
                        </Label>
                    </div>
                </RadioGroup.Root>
                <p class="text-xs text-muted-foreground">
                    {#if accessMode === 'public'}
                        Anyone with the link can view this file.
                    {:else}
                        Only specified email addresses can access this file.
                    {/if}
                </p>
            </div>

            <!-- Email input for private shares -->
            {#if accessMode === 'private'}
                <div class="space-y-2">
                    <Label for="emails">Allowed Email Addresses</Label>
                    <Textarea
                        id="emails"
                        bind:value={emails}
                        placeholder="Enter email addresses separated by commas or new lines"
                        class="min-h-[80px]"
                        disabled={loading}
                    />
                    <p class="text-xs text-muted-foreground">
                        These users must be signed in to access the shared file.
                    </p>
                </div>
            {/if}

            <!-- Create Share Button -->
            <Button
                class="w-full"
                onclick={createShare}
                disabled={loading}
            >
                {#if loading}
                    <Loader2 class="h-4 w-4 mr-2 animate-spin" />
                {:else}
                    <Share2 class="h-4 w-4 mr-2" />
                {/if}
                Create Share Link
            </Button>

            <!-- Generated Share URL -->
            {#if shareUrl}
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

            <!-- Existing Shares -->
            {#if shares.length > 0}
                <div class="space-y-2 pt-4 border-t">
                    <Label>Existing Shares</Label>
                    <div class="space-y-2 max-h-48 overflow-auto">
                        {#each shares as share}
                            <div class="flex items-center justify-between p-3 bg-muted/30 rounded-md">
                                <div class="flex items-center gap-2 min-w-0 flex-1">
                                    {#if share.accessMode === 'public'}
                                        <Globe class="h-4 w-4 text-blue-500 flex-shrink-0" />
                                    {:else}
                                        <Lock class="h-4 w-4 text-amber-500 flex-shrink-0" />
                                    {/if}
                                    <div class="min-w-0 flex-1">
                                        <div class="text-sm font-medium truncate">
                                            {share.accessMode === 'public' ? 'Public' : 'Private'} share (v{share.version})
                                        </div>
                                        <div class="text-xs text-muted-foreground">
                                            Created {formatDate(share.createdAt)}
                                        </div>
                                        {#if share.accessMode === 'private' && share.allowedEmails}
                                            <div class="text-xs text-muted-foreground truncate">
                                                {share.allowedEmails.length} email{share.allowedEmails.length !== 1 ? 's' : ''}
                                            </div>
                                        {/if}
                                    </div>
                                </div>
                                <div class="flex gap-1 flex-shrink-0">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        class="h-8 w-8"
                                        onclick={() => copyShareUrl(share)}
                                        disabled={loading}
                                        title="Copy share URL"
                                    >
                                        {#if copiedShareId === share.shareId}
                                            <Check class="h-4 w-4 text-green-600" />
                                        {:else}
                                            <Copy class="h-4 w-4" />
                                        {/if}
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        class="h-8 w-8 text-destructive hover:text-destructive"
                                        onclick={() => revokeShare(share.shareId)}
                                        disabled={loading}
                                        title="Revoke share"
                                    >
                                        <Trash2 class="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        {/each}
                    </div>
                </div>
            {/if}

            <!-- Loading indicator for shares -->
            {#if loading && shares.length === 0}
                <div class="flex items-center justify-center py-4">
                    <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
            {/if}
        </div>
    </Dialog.Content>
</Dialog.Root>
