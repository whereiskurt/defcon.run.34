<script lang="ts">
    import { Button } from '$lib/components/ui/button';
    import * as Card from '$lib/components/ui/card';
    import Logo from '$lib/components/Logo.svelte';
    import {
        FileText,
        Route,
        Ruler,
        Globe,
        Lock,
        Loader2,
        AlertCircle,
        Check,
        House,
        LogIn,
    } from '@lucide/svelte';
    import { goto } from '$app/navigation';
    import { base } from '$app/paths';
    import { page } from '$app/stores';
    import { onMount } from 'svelte';

    // Share data types
    interface ShareData {
        share: {
            shareId: string;
            fileId: string;
            version: number;
            accessMode: 'public' | 'private';
            createdAt: number;
        };
        file?: {
            fileName: string;
            trackCount: number;
            totalDistance: number;
        };
    }

    let shareData: ShareData | null = $state(null);
    let pageError: string | null = $state(null);
    let pageLoading = $state(true);
    let loading = $state(false);
    let error: string | null = $state(null);
    let success = $state(false);

    // Get API base path from SvelteKit's base (e.g., /use1/studio -> /use1)
    const API_BASE = base.replace('/studio', '') + '/api/gpx';

    // Load share data on mount
    onMount(async () => {
        const token = $page.params.token;
        if (!token) {
            pageError = 'Invalid share link';
            pageLoading = false;
            return;
        }

        try {
            const response = await fetch(`${API_BASE}/shares/${token}`, {
                credentials: 'include',
            });

            if (!response.ok) {
                if (response.status === 404) {
                    pageError = 'This share link is no longer available or has expired';
                } else if (response.status === 401) {
                    pageError = 'Please sign in to view this share';
                } else if (response.status === 403) {
                    pageError = 'This share is not available to you';
                } else {
                    pageError = 'Failed to load share';
                }
                pageLoading = false;
                return;
            }

            shareData = await response.json();
        } catch (e) {
            pageError = 'Failed to load share';
        } finally {
            pageLoading = false;
        }
    });

    async function acceptShare() {
        const token = $page.params.token;
        if (!token) return;

        loading = true;
        error = null;

        try {
            const response = await fetch(`${API_BASE}/shares/${token}/accept`, {
                method: 'POST',
                credentials: 'include',
            });

            if (!response.ok) {
                if (response.status === 401) {
                    // Redirect to login with return URL
                    const returnUrl = encodeURIComponent(window.location.pathname);
                    window.location.href = `/api/auth/signin?callbackUrl=${returnUrl}`;
                    return;
                }

                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'Failed to add file');
            }

            await response.json();
            success = true;

            // Redirect to app after a short delay to show success message
            setTimeout(() => {
                goto(`${base}/app`);
            }, 1500);
        } catch (e) {
            error = e instanceof Error ? e.message : 'Failed to add file to your storage';
        } finally {
            loading = false;
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
</script>

<div class="grow px-6 py-12 flex flex-col items-center justify-center">
    <div class="w-full max-w-md">
        <!-- Loading state -->
        {#if pageLoading}
            <Card.Card class="text-center">
                <Card.CardContent class="py-12">
                    <Loader2 class="h-12 w-12 animate-spin mx-auto text-muted-foreground" />
                    <p class="mt-4 text-muted-foreground">Loading share...</p>
                </Card.CardContent>
            </Card.Card>

        <!-- Error state -->
        {:else if pageError}
            <Card.Card class="text-center">
                <Card.CardHeader>
                    <div class="flex justify-center mb-4">
                        <AlertCircle class="h-16 w-16 text-destructive" />
                    </div>
                    <Card.CardTitle class="text-xl">
                        {#if pageError === 'Please sign in to view this share'}
                            Sign In Required
                        {:else}
                            Share Unavailable
                        {/if}
                    </Card.CardTitle>
                    <Card.CardDescription>
                        {pageError}
                    </Card.CardDescription>
                </Card.CardHeader>
                <Card.CardContent>
                    <div class="flex flex-col gap-3">
                        {#if pageError === 'Please sign in to view this share'}
                            <Button onclick={() => {
                                const returnUrl = encodeURIComponent(window.location.pathname);
                                window.location.href = `/api/auth/signin?callbackUrl=${returnUrl}`;
                            }}>
                                <LogIn class="h-4 w-4 mr-2" />
                                Sign In
                            </Button>
                        {/if}
                        <Button variant="outline" href="{base}/">
                            <House class="h-4 w-4 mr-2" />
                            Go to Homepage
                        </Button>
                    </div>
                </Card.CardContent>
            </Card.Card>

        <!-- Share loaded successfully -->
        {:else if shareData}
            <Card.Card>
                <Card.CardHeader class="text-center">
                    <div class="flex justify-center mb-4">
                        <Logo class="h-16" iconOnly={true} />
                    </div>
                    <Card.CardTitle class="text-xl flex items-center justify-center gap-2">
                        <FileText class="h-5 w-5" />
                        {shareData.file?.fileName || 'Shared GPX File'}
                    </Card.CardTitle>
                    <Card.CardDescription class="flex items-center justify-center gap-1">
                        {#if shareData.share.accessMode === 'public'}
                            <Globe class="h-4 w-4" />
                            Public share
                        {:else}
                            <Lock class="h-4 w-4" />
                            Private share
                        {/if}
                        <span class="mx-1">-</span>
                        Shared on {formatDate(shareData.share.createdAt)}
                    </Card.CardDescription>
                </Card.CardHeader>

                <Card.CardContent class="space-y-4">
                    <!-- File metadata -->
                    {#if shareData.file}
                        <div class="grid grid-cols-2 gap-4 p-4 bg-muted/30 rounded-lg">
                            <div class="flex items-center gap-2">
                                <Route class="h-4 w-4 text-muted-foreground" />
                                <div>
                                    <div class="text-sm font-medium">
                                        {shareData.file.trackCount}
                                    </div>
                                    <div class="text-xs text-muted-foreground">
                                        Track{shareData.file.trackCount !== 1 ? 's' : ''}
                                    </div>
                                </div>
                            </div>
                            <div class="flex items-center gap-2">
                                <Ruler class="h-4 w-4 text-muted-foreground" />
                                <div>
                                    <div class="text-sm font-medium">
                                        {formatDistance(shareData.file.totalDistance)}
                                    </div>
                                    <div class="text-xs text-muted-foreground">
                                        Total Distance
                                    </div>
                                </div>
                            </div>
                        </div>
                    {/if}

                    <!-- Error message -->
                    {#if error}
                        <div class="bg-destructive/10 text-destructive px-4 py-2 rounded-md text-sm flex items-center gap-2">
                            <AlertCircle class="h-4 w-4 flex-shrink-0" />
                            {error}
                        </div>
                    {/if}

                    <!-- Success message -->
                    {#if success}
                        <div class="bg-green-500/10 text-green-600 px-4 py-2 rounded-md text-sm flex items-center gap-2">
                            <Check class="h-4 w-4 flex-shrink-0" />
                            File added to your storage! Redirecting...
                        </div>
                    {/if}
                </Card.CardContent>

                <Card.CardFooter class="flex flex-col gap-3">
                    <Button
                        class="w-full"
                        onclick={acceptShare}
                        disabled={loading || success}
                    >
                        {#if loading}
                            <Loader2 class="h-4 w-4 mr-2 animate-spin" />
                            Adding to My Files...
                        {:else if success}
                            <Check class="h-4 w-4 mr-2" />
                            Added Successfully!
                        {:else}
                            Add to My Files
                        {/if}
                    </Button>
                    <Button variant="outline" class="w-full" href="{base}/">
                        <House class="h-4 w-4 mr-2" />
                        Go to Homepage
                    </Button>
                </Card.CardFooter>
            </Card.Card>
        {/if}
    </div>
</div>
