<script lang="ts">
    import * as Dialog from '$lib/components/ui/dialog/index.js';
    import { Button } from '$lib/components/ui/button';
    import {
        FileDown,
        Loader2,
        AlertCircle,
        CheckCircle,
        Share2,
        Map,
        Route,
    } from '@lucide/svelte';
    import {
        shareAcceptDialogOpen,
        shareAcceptToken,
        closeShareAcceptDialog,
        openCloudStorage,
    } from '$lib/components/cloud/utils.svelte';
    import { isAuthenticated, hasGpxStudioAccess, auth } from '$lib/stores/auth';
    import { loadFromCloud } from '$lib/cloud-sync';
    import { toast } from 'svelte-sonner';

    interface ShareInfo {
        share: {
            shareId: string;
            fileId: string;
            version: number;
            accessMode: 'public' | 'private';
            createdAt: number;
        };
        file: {
            fileName: string;
            trackCount: number;
            totalDistance: number;
        } | null;
    }

    const API_BASE = '/api/gpx';

    // State
    let loading = $state(false);
    let accepting = $state(false);
    let error: string | null = $state(null);
    let shareInfo: ShareInfo | null = $state(null);
    let accepted = $state(false);

    // Load share info when dialog opens
    $effect(() => {
        if ($shareAcceptDialogOpen && $shareAcceptToken) {
            loadShareInfo($shareAcceptToken);
        } else {
            // Reset state when closed
            shareInfo = null;
            error = null;
            accepted = false;
        }
    });

    async function loadShareInfo(token: string) {
        loading = true;
        error = null;
        shareInfo = null;

        try {
            const response = await fetch(`${API_BASE}/shares/${token}`, {
                credentials: 'include',
            });

            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error('This share link is invalid or has expired');
                } else if (response.status === 401) {
                    throw new Error('Please sign in to access this shared file');
                } else if (response.status === 403) {
                    throw new Error('You do not have permission to access this share');
                }
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || 'Failed to load share information');
            }

            shareInfo = await response.json();
        } catch (e) {
            error = e instanceof Error ? e.message : 'Failed to load share';
        } finally {
            loading = false;
        }
    }

    async function acceptShare() {
        if (!$shareAcceptToken) return;

        // Check authentication
        await auth.checkSession();

        if (!$isAuthenticated) {
            error = 'Please sign in to add this file to your storage';
            return;
        }

        if (!$hasGpxStudioAccess) {
            error = 'GPX Studio access required';
            return;
        }

        accepting = true;
        error = null;

        try {
            const response = await fetch(`${API_BASE}/shares/${$shareAcceptToken}/accept`, {
                method: 'POST',
                credentials: 'include',
            });

            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || 'Failed to accept share');
            }

            const result = await response.json();
            accepted = true;

            // Show success toast
            toast.success(`Added "${result.fileName}" to your cloud storage`, {
                description: 'Open View → Cloud Storage to see your files',
                duration: 4000,
            });

            // Close dialog after a moment
            setTimeout(() => {
                closeShareAcceptDialog();
                // Clear the share token from URL
                const url = new URL(window.location.href);
                url.searchParams.delete('share');
                window.history.replaceState({}, '', url.toString());
            }, 1500);
        } catch (e) {
            error = e instanceof Error ? e.message : 'Failed to accept share';
        } finally {
            accepting = false;
        }
    }

    async function loadIntoViewer() {
        if (!$shareAcceptToken || !shareInfo) return;

        closeShareAcceptDialog();

        // Clear the share token from URL
        const url = new URL(window.location.href);
        url.searchParams.delete('share');
        window.history.replaceState({}, '', url.toString());

        try {
            // Load the file directly into the viewer using the share token
            // The loadFromCloud function will need to support loading shared files
            // For now, we'll show a message
            toast.info('To load shared files directly, accept them first', {
                duration: 3000,
            });
        } catch (e) {
            toast.error('Failed to load file');
        }
    }

    function formatDistance(meters: number): string {
        if (meters >= 1000) {
            return `${(meters / 1000).toFixed(1)} km`;
        }
        return `${Math.round(meters)} m`;
    }

    function formatDate(timestamp: number): string {
        const date = new Date(timestamp);
        return date.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        });
    }

    function handleClose() {
        closeShareAcceptDialog();
        // Clear the share token from URL
        const url = new URL(window.location.href);
        url.searchParams.delete('share');
        window.history.replaceState({}, '', url.toString());
    }
</script>

<Dialog.Root open={$shareAcceptDialogOpen} onOpenChange={(isOpen) => !isOpen && handleClose()}>
    <Dialog.Content class="!max-w-[450px] !w-[90vw]">
        <Dialog.Header>
            <Dialog.Title class="flex items-center gap-2">
                <Share2 class="h-5 w-5" />
                Shared GPX File
            </Dialog.Title>
        </Dialog.Header>

        <div class="space-y-4">
            <!-- Loading state -->
            {#if loading}
                <div class="flex flex-col items-center justify-center py-8">
                    <Loader2 class="h-8 w-8 animate-spin text-muted-foreground mb-3" />
                    <p class="text-sm text-muted-foreground">Loading share information...</p>
                </div>
            {:else if error}
                <!-- Error state -->
                <div class="bg-destructive/10 text-destructive px-4 py-3 rounded-md text-sm flex items-start gap-3">
                    <AlertCircle class="h-5 w-5 flex-shrink-0 mt-0.5" />
                    <div>
                        <p class="font-medium">Unable to load share</p>
                        <p class="text-sm opacity-90 mt-1">{error}</p>
                    </div>
                </div>
                <div class="flex justify-end">
                    <Button variant="outline" onclick={handleClose}>
                        Close
                    </Button>
                </div>
            {:else if accepted}
                <!-- Success state -->
                <div class="flex flex-col items-center justify-center py-6">
                    <CheckCircle class="h-12 w-12 text-green-600 mb-3" />
                    <p class="text-lg font-medium">File Added!</p>
                    <p class="text-sm text-muted-foreground text-center mt-1">
                        The file has been added to your cloud storage.
                    </p>
                </div>
            {:else if shareInfo}
                <!-- Share info -->
                <div class="bg-muted/30 rounded-lg p-4 space-y-3">
                    {#if shareInfo.file}
                        <div class="flex items-start gap-3">
                            <Map class="h-10 w-10 text-primary flex-shrink-0" />
                            <div class="min-w-0 flex-1">
                                <h3 class="font-semibold text-lg truncate">
                                    {shareInfo.file.fileName}
                                </h3>
                                <div class="flex items-center gap-3 text-sm text-muted-foreground mt-1">
                                    <span class="flex items-center gap-1">
                                        <Route class="h-4 w-4" />
                                        {shareInfo.file.trackCount} track{shareInfo.file.trackCount !== 1 ? 's' : ''}
                                    </span>
                                    {#if shareInfo.file.totalDistance > 0}
                                        <span>
                                            {formatDistance(shareInfo.file.totalDistance)}
                                        </span>
                                    {/if}
                                </div>
                            </div>
                        </div>
                    {:else}
                        <div class="flex items-center gap-3">
                            <Map class="h-10 w-10 text-primary flex-shrink-0" />
                            <div>
                                <h3 class="font-semibold">GPX File</h3>
                                <p class="text-sm text-muted-foreground">Version {shareInfo.share.version}</p>
                            </div>
                        </div>
                    {/if}

                    <div class="text-xs text-muted-foreground pt-2 border-t border-border/50">
                        Shared on {formatDate(shareInfo.share.createdAt)} •
                        {shareInfo.share.accessMode === 'public' ? 'Public link' : 'Private share'}
                    </div>
                </div>

                <!-- Authentication check -->
                {#if !$isAuthenticated}
                    <div class="bg-amber-500/10 text-amber-700 dark:text-amber-300 px-4 py-3 rounded-md text-sm">
                        <p class="font-medium">Sign in required</p>
                        <p class="text-sm opacity-90 mt-1">
                            Please sign in to add this file to your cloud storage.
                        </p>
                    </div>
                {/if}

                <!-- Actions -->
                <div class="flex flex-col gap-2 pt-2">
                    <Button
                        class="w-full"
                        onclick={acceptShare}
                        disabled={accepting || !$isAuthenticated}
                    >
                        {#if accepting}
                            <Loader2 class="h-4 w-4 mr-2 animate-spin" />
                            Adding to Cloud Storage...
                        {:else}
                            <FileDown class="h-4 w-4 mr-2" />
                            Add to My Cloud Storage
                        {/if}
                    </Button>
                    <Button
                        variant="outline"
                        class="w-full"
                        onclick={handleClose}
                    >
                        Cancel
                    </Button>
                </div>
            {/if}
        </div>
    </Dialog.Content>
</Dialog.Root>
