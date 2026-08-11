# Synchronous anchor layers

**When independently-fetched layers each add themselves to a z-stack the moment their own
data resolves, stacking order becomes a network race; fix it by installing a handful of
zero-content "anchor" objects synchronously up front — one per band, each marking its
band's ceiling — so every real layer inserts before its band's anchor and arrival order
stops mattering.**

## Context

You have a layered rendering surface — a map, a canvas stack, a set of DOM overlays — where
z-order is meaningful: markers must sit above route lines, tooltips above markers, and so
on. The layers come from independent sources that each fetch on their own schedule: one
family of overlays from one feed, another from another, check-ins from a third. Each family,
naturally, adds its layers to the stack when *its own* fetch resolves.

On a fast connection everything happens to land in a sensible order and it looks fine. On a
slow connection — or a different mix of cached and cold feeds — the order inverts: the route
lines resolve last and land on *top*, burying the very markers the user is supposed to tap.
The stack order was never designed; it was whatever the network happened to deliver.

## Forces

- **"Append" means "on top."** Most layer APIs add a new layer at the top of the stack by
  default. So "add when my data arrives" silently means "sit above everything that arrived
  before me" — and arrival order is the network's decision, not yours.
- **The ids are dynamic and multiplying.** Layers are per-item (`route-<fileId>`,
  `item-<id>`), created and destroyed as data comes and goes. Any scheme that has to *know*
  each id ahead of time is fighting a set that keeps growing.
- **A repair you have to remember to call isn't a fix.** A central "restack everything"
  sweep works only at the instants someone calls it. A feed that resolves after the last
  sweep floats on top until the next one — the exact flash you were trying to remove, now
  intermittent and harder to reproduce.
- **The order should be legible.** When a stack looks wrong, you want the intended order
  visible in the structure you're debugging, not encoded implicitly in the timing of a
  dozen async callbacks.

## The pattern

Install a small, fixed set of **anchor objects synchronously, once, before any feed
resolves** — one anchor per z-band, in order, each a zero-content placeholder that marks the
CEILING of its band. Every real layer then inserts *before* its band's anchor.

```
  install synchronously at startup, in order (bottom → top):

      ─ anchor: heat ────────┐  band "heat"    : real heat layers insert before this
      ─ anchor: routes ──────┤  band "routes"  : route lines insert before this
      ─ anchor: tracks ──────┤  band "tracks"  : gpx tracks insert before this
      ─ anchor: markers ─────┤  band "markers" : pins/clusters insert before this
      ─ anchor: tools ───────┘  band "tools"   : ephemeral tool overlays insert before this

  addInBand(layer, "markers")  ⇒  insert layer immediately below the "markers" anchor,
                                   no matter when its feed resolved.
```

Because the anchors exist from the start and never move, "insert before band X's anchor"
places a layer in band X regardless of *when* it arrives. Arrival order stops mattering
entirely: the first route and the last route both land under the routes anchor, above the
heat anchor, below the markers anchor. The z-order is now a property of the *band each layer
declares*, not of the race that delivered it.

Anchors are cheap — no content, not rendered — so the only cost is a handful of
placeholders. And they are self-documenting: the intended order is right there in the stack
when you inspect it.

**Why anchors beat the two alternatives:**

- **vs. a central restack sweep:** the sweep only repairs at call time, so anything that
  resolves after the last sweep floats until the next — the flash returns, intermittently.
  Anchors mean a layer is *born* in the right place; there is nothing to re-sweep.
- **vs. an id→band lookup table:** a classifier keyed on layer id has to be maintained as
  new dynamic ids proliferate, and it's a second source of truth about ordering. Anchors
  need no table — a layer names its band at insertion time and that's the whole record.

**Install order and idempotency matter.** Anchors must go in *before* any real content;
anchors appended onto a stack that already holds layers would sit above that content and
drop all of it into the bottom band. Make the install idempotent and have the insert helper
call it defensively, so a surface reset (a basemap swap that wipes layers) self-heals.

## Sibling pattern — hit-testing decoupled from render geometry

A closely related z-stack problem: a thin rendered line is hard to tap. The tempting fix is
a wide *invisible* hit layer under the visible one — but two parallel invisible hit layers
both match a tap between them, and which one wins is arbitrary (again, insertion order). The
better fix decouples hit-testing from render geometry entirely:

- hit-test the pointer against a **pixel radius** sized to the platform's minimum touch
  target (coarse pointers get the full target; a mouse gets a tighter one), and
- among all candidates within that radius, pick the **nearest** one — computed in pixel
  space so "nearest" means nearest *on screen*.

Every nearby line is a candidate; the closest wins; the one you aimed at is the one you get.
No invisible widened geometry to double-match, and the touch target is generous without
distorting what's drawn.

## Key moves

- **Synchronous install, before any feed.** The anchors must predate all content, or the
  first-installed content lands in the wrong band. This is the one ordering constraint that
  the whole pattern rests on.
- **Real placeholder objects, not a table.** Zero-content anchors cost nothing, need no
  maintenance as ids multiply, and make the order visible when debugging.
- **Insert-before-anchor, never move-to-top.** Replace every "bring to front" call with
  "move within band" — a stray `moveToTop` on a selection handler undoes the whole scheme on
  the first click.
- **Idempotent + self-healing.** Have the insert helper re-install anchors defensively so a
  surface/style reset can't strand content in the bottom band.
- **For hit-testing, radius + nearest, not wider invisible geometry.** Decouple the tap
  target from the drawn geometry; pick the closest candidate in pixel space.

## Traps

- **Anchors installed late.** If any content is added before the anchors exist, it falls
  into the bottom band and the stack looks *more* broken, not less. Install at the earliest
  possible point.
- **A rogue move-to-front.** Any code path that sends a layer to the absolute top (often a
  selection or focus handler) defeats the bands on the first interaction. Route all such
  moves through the band-aware helper.
- **A widened invisible hit layer.** It seems simpler than radius+nearest, but two parallel
  ones double-match and hand the tap to whichever was added last — the same async-order bug,
  moved into the interaction layer.
- **Measuring "nearest" in the wrong space.** Nearest in geographic/degree space weights
  axes unequally; project to pixel space so the radius and the distance are in the same
  units the user actually sees.

## When not to use it

- If your layers are all added synchronously in a known order already, you don't have a
  race — an explicit `beforeId` at each add site is enough.
- If there is exactly one band (everything is peers, order is irrelevant), anchors are
  ceremony with no payoff.
- If the rendering surface has a real, declarative z-index you fully control per layer,
  express order there directly rather than through placeholder objects.

## As built (defcon.run 34)

- **Anchor bands:** `apps/run.gpx/gpx-studio/website/src/lib/components/map/z-bands.ts` —
  five synchronous zero-feature anchors (`heat`, `routes`, `tracks`, `markers`, `tools`),
  `installBands` (idempotent, install-order note), `addInBand(map, spec, band, beneath?)`,
  and `moveToBand` replacing bare `moveLayer`-to-top. Documents why real anchors beat both a
  central `restack()` sweep and an id→band lookup table, and the live bug that prompted it
  (cluster badges and ghost pins buried under route lines, 2026-08-02).
- **A consumer inserting into a band:**
  `apps/run.gpx/gpx-studio/website/src/lib/components/map/heatmap-layer.ts` calls
  `addInBand(..., 'heat', beneath)` — the `beneath` preserving DC33-under-DC34 *within* the
  band while the anchor fixes the band itself.
- **Radius / nearest-wins hit-testing:**
  `apps/run.gpx/gpx-studio/website/src/lib/components/map/route-hit.ts` —
  `HIT_RADIUS_TOUCH = 22` (half of Apple's 44 px HIG target) vs. `HIT_RADIUS_MOUSE = 12`,
  `nearestCandidate` picking the closest route in pixel space, and `RouteHitRouter` replacing
  per-layer click handlers with one radius search. Documents why this beats a wide invisible
  hit layer for parallel Strip routes.
