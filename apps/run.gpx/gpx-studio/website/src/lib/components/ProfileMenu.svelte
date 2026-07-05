<script lang="ts">
    import { onMount } from 'svelte';
    import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
    import { auth, currentUser, isAuthenticated } from '$lib/stores/auth';
    import { CircleUserRound, LogIn, LogOut, Ticket, PencilRuler } from '@lucide/svelte';

    /**
     * Floating profile menu (top-right, beside the map controls) — the studio's
     * Svelte counterpart of the HeroUI header dropdown on run/bib/flash
     * (run.human `dropdown-user.tsx`). Mostly cross-site links; check-in / QR
     * live on the profile page. CMS entry is admin-gated like run.human's.
     */

    onMount(() => {
        // Cheap and idempotent — CloudStorage also refreshes the session store.
        auth.checkSession();
    });

    // Cross-site links. Prod URLs carry the region label (run.defcon.run/use1/...);
    // dev runs the sites on local ports. Resolved lazily — this page prerenders,
    // so `location` must not be touched at component init.
    function runBase(): string {
        if (location.hostname === 'localhost') return 'http://localhost:3001';
        const m = location.pathname.match(/^\/([a-z0-9]+)\/studio/);
        return `https://run.defcon.run/${m ? m[1] : 'use1'}`;
    }

    function open(url: string) {
        window.open(url, '_blank', 'noopener,noreferrer');
    }

    const initial = $derived(
        ($currentUser?.name || $currentUser?.email || '?').trim().charAt(0).toUpperCase()
    );
    const isAdmin = $derived(($currentUser?.services ?? []).includes('admin'));
</script>

<div class="absolute top-[10px] right-14 z-30">
    {#if $isAuthenticated}
        <DropdownMenu.Root>
            <DropdownMenu.Trigger
                class="flex h-[29px] w-[29px] items-center justify-center rounded-full border-2
                       border-[#00d4aa] bg-background text-sm font-bold shadow-md
                       hover:scale-105 transition-transform"
                aria-label="Profile menu"
            >
                {initial}
            </DropdownMenu.Trigger>
            <DropdownMenu.Content class="w-52" align="end">
                <DropdownMenu.Label>
                    <div class="flex flex-col">
                        <span>{$currentUser?.name ?? 'Runner'}</span>
                        {#if $currentUser?.email}
                            <span class="text-xs font-normal text-muted-foreground"
                                >{$currentUser.email}</span
                            >
                        {/if}
                    </div>
                </DropdownMenu.Label>
                <DropdownMenu.Separator />
                <DropdownMenu.Item onclick={() => open(`${runBase()}/whoami`)}>
                    <CircleUserRound size="16" class="mr-2" />
                    Profile & Check-ins
                </DropdownMenu.Item>
                <DropdownMenu.Item onclick={() => open('https://bib.defcon.run')}>
                    <Ticket size="16" class="mr-2" />
                    Bib Site
                </DropdownMenu.Item>
                {#if isAdmin}
                    <DropdownMenu.Item onclick={() => open('https://cms.defcon.run')}>
                        <PencilRuler size="16" class="mr-2" />
                        CMS
                    </DropdownMenu.Item>
                {/if}
                <DropdownMenu.Separator />
                <DropdownMenu.Item onclick={() => auth.logout()}>
                    <LogOut size="16" class="mr-2" />
                    Sign out
                </DropdownMenu.Item>
            </DropdownMenu.Content>
        </DropdownMenu.Root>
    {:else}
        <button
            type="button"
            class="flex h-[29px] items-center gap-1.5 rounded-full border-2 border-[#00d4aa]
                   bg-background px-3 text-xs font-semibold shadow-md hover:scale-105
                   transition-transform"
            onclick={() => auth.login()}
        >
            <LogIn size="14" />
            Sign in
        </button>
    {/if}
</div>
