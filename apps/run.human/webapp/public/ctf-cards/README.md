# CTF Cards — art assets

Collectible card art for the **`/ctf/cards`** board (one tile per CTF challenge).

## How to add a card

1. Drop an image here named after a **basic slug**, e.g. `defcon-canceled.webp`.
   - `.webp` is preferred (small, CDN-cached). `.svg` also works.
   - The board tries `<slug>.webp` first, then `<slug>.svg`, then falls back to
     the `_mystery.svg` tile — so a typo degrades gracefully.
   - Recommended framing: **3:4 portrait** (trading-card), ~≤80 KB per card.
2. In the CTF admin form (`/admin/qr/ctf/<challenge>`), set the **Card image**
   field to the slug (e.g. `defcon-canceled` — no extension needed).
3. Solve the challenge (as that user) and the tile reveals the card on the board.

Assets are served by CloudFront under the region basePath
(`/use1/ctf-cards/<slug>.webp`); the page prefixes the path automatically.

## Reserved names (do not delete)

- `_mystery.svg` — the uniform grayed "?" tile shown for every locked/undiscovered
  challenge. Kept intentionally generic so it leaks nothing about hidden cards.
- `_solved.svg` — generic "solved" placeholder shown when a challenge is unlocked
  but has no `cardImage` slug assigned yet.

## Cards on the board

| Slug | Challenge | Notes |
|------|-----------|-------|
| `defcon-canceled` | `dc34-egg` | "DEFINITELY CANCELED !!!" — the `!!!` easter egg. Placeholder SVG shipped; swap for final art anytime. |
