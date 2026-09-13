# DC34 stats one-pagers

Regenerates the two DEF CON 34 run stat sheets — a public/shareable page and an
operator copy — straight from live data. Every figure is derived; none are
hardcoded, so re-running mid-con just moves the numbers.

```bash
python3 scripts/dc34-stats/dc34_stats.py --all
```

Takes ~30 s. Writes to `./out/dc34-stats/` (override with `--out`):

| File | What |
|---|---|
| `dc34-by-the-numbers.html` | **Public.** No money, no names, no phone numbers. |
| `dc34-operator-numbers.html` | **Operator.** Money, reach concentration, per-number calls. Do not share. |
| `stats.json` | Every computed figure. |
| `raw/all.json` | Everything pulled, so `--render` needs no AWS. |

`--fetch` pulls only. `--render` rebuilds the pages from the last fetch — the
fast path when you only want to reword something.

## Republishing to the same URLs

The pages are published as Artifacts. To **update in place** rather than mint a
new link, pass the existing URL:

- Public — `https://claude.ai/code/artifact/75c8692f-b234-4eea-a078-50c7b3d98720`
- Operator — `https://claude.ai/code/artifact/94a0758f-1b49-4992-a1f1-8eb402bf643b`

A session that did not publish them will otherwise create new URLs.

## Prerequisites

- `aws` CLI, logged in to **`dc34-application`** (`aws sso login --profile dc34-application`).
- `go` and `~/working/klanker-voice` for phone calls — **optional**. That is a
  different AWS account with its own SSO session; if it fails the pages still
  build and say the call data is missing rather than dying at 90%.
  Fix with `aws sso login --profile klanker-application` and re-run.

## What it reads, and the trap in each

| Source | Trap |
|---|---|
| `run-gpx-electro`, `run-human-electro` | `scan` with **no `--max-items`** so the CLI paginates fully. A page cap truncates silently and every total comes out low. |
| `gpxStravaCache.activities` | A JSON **string**, not a DDB list. It is the *only* source of moving time — `GpxFile` has distance and elevation but no duration. |
| `s3://defcon.run.33.backup` | DC33 is `year` **"2025"** and the entity discriminator is the **plural** `Accomplishments`. The singular matches zero rows and yields a silently empty comparison. Use the `01755225714347` export, not the earlier one. |
| Ghost chat Logs Insights | Day bins are UTC; the query shifts by the con offset first or Sunday lands in Saturday's bucket. |
| `kv telephony calls` | The shipped `bin/kv` goes stale and silently lacks the `calls` subcommand — the script rebuilds it every run. |

## Counting rules baked in

- A **run** is any activity with a recorded distance tagged to a con day. On
  this basis DC34 ≈ +33% km on DC33. Two other bases exist and disagree; the
  heat-map artifact read (same builder both years, geometry only) is printed on
  the public page as a footnote so the narrower number is never hidden. A third
  basis — raw activity rows — *inverts the sign*, because 55 of DC33's 148 rows
  carry no distance at all. Never quote a run count without naming the basis.
- **Hours are a floor.** Moving time only exists where a run joins a cached
  Strava activity. The page prints "measured on N of M runs" and deliberately
  shows **no** year-on-year delta — DC33's total is complete, so a delta would
  invent a decline.
- **Treadmill** = Strava `trainer=true` **or** no summary polyline.
- Days align **by weekday, not by date**: DC33 ran Thu 7–Sun 10 Aug 2025 and
  DC34 Thu 6–Sun 9 Aug 2026, so equal dates are different days of the con.
- A con day that has not happened yet renders as a **dash, never 0** — a zero
  reads as "nobody ran" when it means "still ahead". Same reason calls are
  dropped from the grid entirely when that query did not run.

Pages are emitted as pure ASCII with HTML entities, because the host's charset
is not ours to assume — serving UTF-8 as latin-1 turns every em dash into `â€"`.
