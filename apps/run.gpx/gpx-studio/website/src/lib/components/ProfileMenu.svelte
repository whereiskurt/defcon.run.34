<script lang="ts">
    import { onMount } from 'svelte';
    import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
    import CustomControl from '$lib/components/map/custom-control/CustomControl.svelte';
    import { auth, currentUser, isAuthenticated } from '$lib/stores/auth';
    import { CircleUserRound, LogIn, LogOut, Ticket, PencilRuler, Moon, Sun } from '@lucide/svelte';
    import { mode, setMode } from 'mode-watcher';
    import { rainbowUnlocked } from '$lib/stores/rainbow';

    /**
     * Floating profile menu — the studio's Svelte counterpart of the HeroUI
     * header dropdown on run/bib/flash (run.human `dropdown-user.tsx`). Mostly
     * cross-site links; check-in / QR live on the profile page. CMS entry is
     * admin-gated like run.human's.
     *
     * Rendered as a mapbox top-right custom control so the avatar + theme sit at
     * the TOP of the vertically-centred right control column (above the zoom /
     * compass / search / geolocate stack), mirroring the centred left toolbar.
     * `order: -1` (see app.css) pulls this control above the native ones even
     * though custom controls are added after them on map load.
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

    // ── Rainbow Bridges unlock (mobile-friendly) ──────────────────────────────
    // Typing "rainbow" (GhostTrigger) is the desktop path; phones have no
    // keyboard here. A long-press on the theme toggle unlocks the egg — hidden,
    // no visible hint. `suppressClick` stops the press from also toggling theme.
    const LONG_PRESS_MS = 600;
    let pressTimer: ReturnType<typeof setTimeout> | null = null;
    let suppressClick = false;

    function pressStart(e: PointerEvent) {
        // Keep the press on the button — never let it reach the map canvas as a
        // pan / box-zoom / double-tap-zoom gesture.
        e.stopPropagation();
        suppressClick = false;
        pressTimer = setTimeout(() => {
            suppressClick = true;
            rainbowUnlocked.set(true);
        }, LONG_PRESS_MS);
    }
    function pressEnd() {
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
    }
    function onThemeClick() {
        if (suppressClick) {
            suppressClick = false;
            return; // long-press already handled — don't also flip the theme
        }
        setMode(mode.current === 'dark' ? 'light' : 'dark');
    }
</script>

<!-- Two-icon vertical pair (avatar over theme) at the top of the centred
     right-hand control column. Transparent wrapper: the buttons carry their own
     circular chrome, so we drop CustomControl's default box/shadow. -->
<CustomControl
    class="profile-control !bg-transparent !shadow-none flex flex-col items-end gap-2"
>
    {#if $isAuthenticated}
        <DropdownMenu.Root>
            <DropdownMenu.Trigger
                class="flex h-[29px] w-[29px] items-center justify-center overflow-hidden rounded-full
                       border-2 border-[#00d4aa] bg-background text-sm font-bold shadow-md
                       hover:scale-105 transition-transform"
                aria-label="Profile menu"
            >
                {#if $currentUser?.image}
                    <img
                        src={$currentUser.image}
                        alt=""
                        referrerpolicy="no-referrer"
                        class="h-full w-full rounded-full object-cover"
                    />
                {:else}
                    {initial}
                {/if}
            </DropdownMenu.Trigger>
            <DropdownMenu.Content class="w-52" align="end" side="left">
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
    <!-- Global light/dark toggle — drives mode-watcher, so it stays in sync with
         the menu's theme radio, and (via LayerControl) swaps the map basemap.
         Long-press unlocks the Rainbow Bridges egg. -->
    <button
        type="button"
        class="theme-toggle flex h-[29px] w-[29px] items-center justify-center rounded-full border-2
               border-[#00d4aa] bg-background shadow-md hover:scale-105 transition-transform"
        aria-label="Toggle dark mode"
        onclick={onThemeClick}
        onpointerdown={pressStart}
        onpointerup={pressEnd}
        onpointerleave={pressEnd}
        onpointercancel={pressEnd}
        oncontextmenu={(e) => e.preventDefault()}
    >
        {#if mode.current === 'dark'}
            <Moon size="15" />
        {:else}
            <Sun size="15" />
        {/if}
    </button>
</CustomControl>

<style>
    /* Kill the iOS long-press callout/selection so the rainbow gesture is clean. */
    .theme-toggle {
        -webkit-touch-callout: none;
        -webkit-user-select: none;
        user-select: none;
        touch-action: manipulation;
    }
</style>
