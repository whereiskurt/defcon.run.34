---
created: 2026-07-30T14:10:00Z
title: "My Maps footer 'Add run' renders on the auth gate screens (Phase 70 regression, live in prod)"
area: run.gpx
priority: high
resolves_phase: 70.1
---

Phase 70 verification gap 1. **Phase-introduced, currently live on gpx.defcon.run
(v0.0.104).** Confirmed independently against the pre-phase blob, not just from the
verifier's report.

## The defect

`apps/run.gpx/gpx-studio/website/src/lib/components/cloud/CloudStorage.svelte:993-998`

The `{#snippet footer()}` is a **sibling** of the auth chain, not a child of its `{:else}`
arm:

```
{#if !$isAuthenticated}      ...gate...
{:else if !$hasGpxStudioAccess} ...gate...
{:else}                      ...file list...
{/if}
{/if}

{#snippet footer()}          <-- outside the chain
    <Button onclick={openAddRun}>👟 Add run</Button>
{/snippet}
```

`DialogShell` renders `footer` unconditionally, so the button paints on both gate screens.

Pre-phase (`6fe5cf20:924-940`) the footer was a plain `<div>` **inside** the `{:else}` arm
and was correctly hidden:

```
        <!-- Footer actions -->
        <div class="flex justify-between gap-3 pt-3 ...">
            <Button onclick={openAddRun}>Add run</Button>
            <Button variant="outline" onclick={() => exportAllFiles([])}>Export</Button>
        </div>
    {/if}          <-- closes {:else}
```

## Why it's more than cosmetic

`openAddRun` (`:566-569`) does `closeCloudStorage(); quickStartOpen.set(true)`.
`QuickStartHub.svelte:62` derives `canShow = $isAuthenticated && $hasGpxStudioAccess` — the
exact two conditions that put you on the gate screen. So on the gate screen the most
prominent button:

1. closes My Maps (taking the Sign In button off screen),
2. opens nothing, and
3. latches `quickStartOpen` at `true` — the reset subscriber only runs while the hub is
   mounted, and it never mounts.

No privilege escalation, no data exposure. It is a dead-end CTA that strands an
unauthenticated user.

## Fix

Move the footer inside the `{:else}` arm, or gate the snippet's body on
`$isAuthenticated && $hasGpxStudioAccess`. The plan-specified behavior (`DialogShell` takes
`footer` as an unconditional prop) is fine — the caller is what needs the guard. Consider
whether `DialogShell` should accept an optional `showFooter` so the next consumer doesn't
hit this.

The 12/12 prod probe could not catch this: it stubs `session.user.services: ['gpxstudio']`,
so it only ever exercises the authenticated branch.

Related: [[2026-07-30-phase-70-version-history-cross-file]] (found in the same review, but
pre-existing, not Phase 70).
