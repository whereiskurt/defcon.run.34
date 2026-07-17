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
        CheckCircle,
        Globe,
        Lock,
        Users,
        Send,
        X,
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
        onSubmitChange = undefined as (() => void) | undefined,
    }: {
        open?: boolean;
        file: CloudFile | null;
        // Called after a successful submit/withdraw (verb ②) so the parent (My Maps)
        // can refresh the row's "submitted" indicator without a full reload.
        onSubmitChange?: (() => void) | undefined;
    } = $props();

    // State — verb ① (friend link)
    let loading = $state(false);
    let error: string | null = $state(null);
    let accessMode: 'public' | 'private' = $state('public');
    let emails = $state('');
    let shareUrl = $state('');
    let shares: Share[] = $state([]);
    let copied = $state(false);
    let copiedShareId: string | null = $state(null);

    // State — verb ② (submit to DEF CON run review queue). Data-only: no URL.
    let submitting = $state(false);
    let submitError: string | null = $state(null);
    let submitted = $state(false);

    // Load shares when dialog opens
    $effect(() => {
        if (open && file) {
            loadShares();
            // Reset form state
            accessMode = 'public';
            emails = '';
            shareUrl = '';
            error = null;
            // Seed verb ② state from the file's server-provided flag.
            submitted = file.shareRequested ?? false;
            submitError = null;
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
                version: file.version || 1,
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

    // Verb ② — submit/withdraw this route to the DEF CON run admin review queue.
    // POST /files/{id}/request-share { requested } sets `shareRequested` server-side.
    // No URL is minted; this is a data flag, not a shareable link (§12 security posture).
    async function setSubmit(requested: boolean) {
        if (!file) return;

        submitting = true;
        submitError = null;
        try {
            const response = await fetch(`${getApiBase()}/files/${file.fileId}/request-share`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ requested }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'Failed to update submission');
            }

            const data = await response.json();
            submitted = data.file?.shareRequested ?? requested;

            // Let the parent refresh the per-row submitted indicator.
            onSubmitChange?.();
        } catch (e) {
            submitError = e instanceof Error ? e.message : 'Failed to update submission';
        } finally {
            submitting = false;
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
            <!-- ── Verb ①: Share with a friend ──
                 A peer link (public or private/email-gated). Never becomes an
                 official DEF CON route. Existing link machinery, unchanged. -->
            <div class="space-y-1">
                <h3 class="flex items-center gap-2 text-sm font-semibold">
                    <Users class="h-4 w-4" />
                    Share with a friend
                </h3>
                <p class="text-xs text-muted-foreground">
                    Create a link to show someone your route. Peer-to-peer — this never
                    makes it an official DEF CON route.
                </p>
            </div>

            <!-- Error message (verb ①) -->
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
                                        {#if share.accessMode === 'private' && share.allowedEmails && share.allowedEmails.length > 0}
                                            <div class="text-xs text-muted-foreground truncate" title={share.allowedEmails.join(', ')}>
                                                {share.allowedEmails[0]}{#if share.allowedEmails.length > 1}<span class="ml-1 text-blue-500 cursor-help">+{share.allowedEmails.length - 1} more</span>{/if}
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

            <!-- ── Verb ②: Submit to DEF CON run ──
                 Flags the file into the admin review queue (sets shareRequested).
                 Data only — NO url is minted and nobody sees it until approved.
                 Deliberately no URL field here (§12 security posture). -->
            <div class="space-y-3 pt-4 border-t">
                <div class="space-y-1">
                    <h3 class="flex items-center gap-2 text-sm font-semibold">
                        <Send class="h-4 w-4" />
                        Submit to DEF CON run
                    </h3>
                    <p class="text-xs text-muted-foreground">
                        Offer this route to the DEF CON run event. An organizer reviews it —
                        no link is created and nobody sees it until it's approved.
                    </p>
                </div>

                <!-- Error message (verb ②) -->
                {#if submitError}
                    <div class="bg-destructive/10 text-destructive px-4 py-2 rounded-md text-sm flex items-center gap-2">
                        <AlertCircle class="h-4 w-4 flex-shrink-0" />
                        {submitError}
                    </div>
                {/if}

                {#if submitted}
                    <div class="flex items-center gap-2 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-4 py-2 rounded-md text-sm">
                        <CheckCircle class="h-4 w-4 flex-shrink-0" />
                        <span class="font-medium">Submitted — pending review</span>
                    </div>
                    <Button
                        variant="outline"
                        class="w-full"
                        onclick={() => setSubmit(false)}
                        disabled={submitting}
                    >
                        {#if submitting}
                            <Loader2 class="h-4 w-4 mr-2 animate-spin" />
                        {:else}
                            <X class="h-4 w-4 mr-2" />
                        {/if}
                        Withdraw submission
                    </Button>
                {:else}
                    <Button
                        class="w-full"
                        onclick={() => setSubmit(true)}
                        disabled={submitting}
                    >
                        {#if submitting}
                            <Loader2 class="h-4 w-4 mr-2 animate-spin" />
                        {:else}
                            <Send class="h-4 w-4 mr-2" />
                        {/if}
                        Submit to DEF CON run
                    </Button>
                {/if}
            </div>
        </div>
    </Dialog.Content>
</Dialog.Root>
