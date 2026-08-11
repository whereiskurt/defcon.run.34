# Persisted client state from stable ids

**Persist toggle state keyed by stable structural ids, storing only leaf rows and deriving
every group/master toggle from "all children on," with an absent id meaning "never touched"
so each call site supplies its own default; and treat a deep link that names a set as an
EXACT-SET selector — named items forced on, unnamed forced off — resolved at each family's
own seeding point so there is no flash of the wrong state.**

## Context

A UI has a tree of toggles the user flips — layers on a map, sections in a panel, filters
in a list — and two things must survive: the user's own choices across reloads, and a
shared link that pre-selects a specific view. Both sound simple and both have a classic set
of bugs that show up only later: a master checkbox that disagrees with its children, a
saved preference that jumps onto the wrong row after data re-orders, a restore that yanks
the camera, a shared link that renders differently for each person who opens it, a flash of
the default view before the link's selection takes hold.

These two problems — *persisted personal state* and *deep-linked exact state* — are tightly
related (they read and write the same visibility) and each has a small set of rules that,
followed together, make the bugs structurally impossible rather than individually fixed.

## Forces

- **Display order is data-driven and unstable.** Folder names, route names, list labels
  come from content that gets re-uploaded and re-ordered. Anything keyed by index or by
  display label will shuffle one item's saved state onto another the moment the data moves.
- **A master toggle is a derived fact, not a stored one.** "All children visible" is
  computable from the children. Storing the master *separately* creates a second source of
  truth that can disagree with the first — and it will, the first time a child changes by a
  path that forgets to update the master.
- **"No stored value" is information, not a problem.** A first-time visitor and a returning
  one are different, and the right default can differ per toggle (some default on, most
  default off). A single global default erases that distinction and forces a migration
  every time the default changes.
- **Restoring state is not the same act as a user toggling it.** The user-action path often
  has side effects — recenter, animate, fit-to-bounds, fire an award. Replaying those on a
  page-load restore is a bug: the map lurches, the analytics double-count.
- **A shared link means the same thing to everyone or it means nothing.** If a link only
  turns layers *on* and leaves the rest to each viewer's saved state, two people following
  the identical URL see different maps. A link that names a set must mean *exactly* that
  set.

## The pattern

### Part 1 — Persisted toggles done right

- **Key by stable structural ids.** Never an array index, never a data-driven display
  label. Use the underlying stable id (a file id, a content id, a fixed constant for
  non-data toggles), spelled through one shared constant/helper so no module hand-writes the
  string form and a typo can't silently orphan a preference.
- **Store only leaves; derive every master.** Persist the individual rows. Compute each
  "master"/group toggle as "all its children on." There is then no second source of truth to
  drift — the master is always exactly what the leaves say.
- **Absent means "never touched"; the call site owns the default.** An id not in the store
  is not `false` — it is *unset*. Each call site passes its own fallback
  (`stored(id, thisTogglesDefault)`). A first-time visitor sees today's designed defaults; a
  returning visitor sees their choices; no migration is needed when a default changes,
  because defaults live at the call sites, not in the stored data.
- **Restore drives the underlying property directly.** To apply a restored value, set the
  low-level state (the visibility property) directly — never call the user-action path,
  which recenters or animates. Restore is silent; only genuine user action gets the side
  effects.
- **Persist defensively.** Accept only well-typed values on read (a half-written or
  hand-edited store degrades to defaults, never feeds junk downstream); prune ids whose
  underlying item no longer exists, but only from a load that holds an authoritative list,
  so a transient fetch failure can't wipe a user's saved state.

### Part 2 — Deep links as exact-set selectors

- **Named on, unnamed off — override persisted state.** A link parameter that names a set
  means *exactly* that set: named items forced on, unnamed items forced off, overriding the
  viewer's saved preferences. This is the whole feature; an "only turns things on" version
  renders a different view per visitor.
- **Resolve at each family's own seeding point — no correction pass.** As each layer/family
  fetches its data and seeds itself, it consults the requested selection *at that moment*
  and adds itself already in the resolved state (added hidden, revealed once, in the right
  final state). There is no later "apply the link" sweep to overwrite it, and because the
  item is never shown in the wrong state first, there is no flash. An "apply afterwards"
  design has to beat both the seeding races and the flash; resolving at the seed avoids
  both.
- **Use stable aliases in the URL, never content-generated ids.** A link parameter should
  carry a durable alias (a folder name, a fixed token) — never a CMS-generated id that
  breaks the moment content is re-uploaded. These links get printed on signage and QR codes;
  they must survive a content refresh.
- **Degrade unknown tokens to "no override," not "empty set."** A typo'd parameter that
  names nothing known should behave as if absent (show normal defaults), not as an empty set
  (hide everything) — a bare basemap reads as a broken site; the normal view reads as a link
  that simply didn't take.
- **Know your one exception.** A toggle that defaults *on* breaks the both-ways rule:
  "unnamed" can't mean "off" for it, or every link that doesn't mention it silently kills it.
  Such a toggle is one-way — a link can turn it on but not off — which is also the right
  privacy trade: a link shouldn't be able to hide people from you by omission.

## Key moves

- **Leaves-only + derived-masters + absent-means-local-default.** These three together
  eliminate the stale-master, index-drift, and migration bugs at once. Any one alone leaves
  a gap.
- **Two paths: silent restore vs. side-effecting user action.** Separate them explicitly.
  The restore path touches only the underlying property; the action path is allowed its
  camera moves and awards.
- **Exact set = named-on + unnamed-off.** Determinism across viewers is the point; both
  directions are required to get it.
- **Resolve at the seed, not afterward.** Consulting the selection where each family lands
  its data is what buys the override AND the no-flash for free.
- **Aliases in URLs.** Durable tokens survive content re-uploads; content ids don't.

## Traps

- **Keying by index or label.** The bug hides until the data re-orders, then quietly moves
  one row's state onto another. Structural ids only.
- **A separately-stored master.** It will disagree with its children the first time a child
  is toggled by a path that forgets it. Derive, don't store.
- **Restore through the user path.** A page load that fits-bounds or animates because it
  replayed the toggle action is worse than the state it was restoring. Drive the property
  directly.
- **Prototype pollution from URL tokens.** A parameter value like `constructor` is a truthy
  hit on a plain object used as a lookup. Use a real map for alias/token lookups keyed on
  untrusted input.
- **Reading a value the host rewrites.** If the platform mutates the URL (or any shared
  state) after load, a later read tells you where things *are*, not what was *asked for*.
  Snapshot the arrival value at module init.
- **The default-on layer read as off.** Applying "unnamed ⇒ off" to a default-on toggle kills
  it on every existing link. Make default-on toggles one-way.

## When not to use it

- If there is no tree — a flat handful of independent toggles with no groups — the
  leaves-and-masters machinery is overhead; persist the toggles directly.
- If state is trivially cheap to recompute or genuinely shouldn't survive a reload, skip
  persistence; not everything deserves to be remembered.
- If you have no shareable/linkable views, Part 2 is unnecessary — the exact-set rules only
  matter when a URL selects state.

## As built (defcon.run 34)

- **Persisted toggles:** `apps/run.gpx/gpx-studio/website/src/lib/stores/layer-visibility.ts`
  — stable-id keys via `LAYER` / `publicRouteLayer(fileId)` / `communityRouteLayer(routeId)`;
  leaves-only with masters derived from "all children visible"; `storedVisible(id, fallback)`
  where the fallback belongs to the call site; the "RESTORE MUST NOT MOVE THE CAMERA"
  contract; type-guarded `initial()` and authoritative-only `pruneLayerVisibility`.
- **Deep-link exact set:** `apps/run.gpx/gpx-studio/website/src/lib/stores/layer-url.ts` —
  `parseLayerParam` (named-on / unnamed-off, alias tokens, unknown ⇒ `null` not empty set,
  `Map` lookup against prototype pollution); "THE SELECTION IS READ AT EACH SEEDING SITE"
  for override-without-flash; `resolveRunnersVisible` as the documented default-on one-way
  exception; `ARRIVAL_HASH` snapshotting the URL the host later rewrites.
- **A consumer applying both at its seed point:**
  `apps/run.gpx/gpx-studio/website/src/lib/components/map/heatmap-layer.ts` `loadMeta()` —
  reads `requestedLayers()` at the seeding point, commits in one store write to avoid a
  two-step restore reading as a user toggle, and drives the raw layout property on restore.
- **Sibling store, same idiom:**
  `apps/run.gpx/gpx-studio/website/src/lib/stores/layer-section-collapse.ts`.
