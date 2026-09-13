#!/usr/bin/env python3
"""
DC34 run stats one-pagers -- fetch, compute, render.

    python3 scripts/dc34-stats/dc34_stats.py --all

Produces, in --out (default ./out):
    raw/*.json                 everything pulled, so a re-render needs no AWS
    stats.json                 the computed figures
    dc34-by-the-numbers.html   public / shareable  (no money, no identities)
    dc34-operator-numbers.html operator copy       (money, reach, phone numbers)

Re-run any time; every figure is derived, none are hardcoded. `--render` alone
rebuilds the pages from the last fetch, which is the fast path when you only
want to reword something.

WHY PYTHON AND NOT TS: this reads five sources across two AWS accounts and a Go
CLI in another repo. stdlib + the `aws` binary needs no install step and no
node_modules, which matters when the thing has to run once more in two hours.

Sources and the traps each one carries:

  run-gpx-electro / run-human-electro (DDB, profile dc34-application)
      `aws dynamodb scan` with NO --max-items so the CLI paginates fully; a
      --max-items page cap silently truncates and every total comes out low.

  gpxStravaCache.activities
      a JSON *string*, not a DDB list. json.loads it. This is the ONLY source
      of moving time -- GpxFile has distance and elevation but no duration.

  s3://defcon.run.33.backup  (the 2025-08-15 export, NOT the 08-09 one)
      DC33 = `year` "2025" and the entity discriminator is the PLURAL
      `Accomplishments`. The singular matches zero rows and yields a silently
      empty comparison.

  /ecs/run-mqtt-ghosts-run-mqtt-use1-dc34  (Logs Insights)
      day bins are UTC, so shift by the con offset before binning or Sunday
      lands in Saturday's bucket.

  kv telephony calls  (klanker-voice repo, profile klanker-application)
      a DIFFERENT AWS account with its own SSO session. Treated as optional:
      if it fails the pages still build and say so, rather than dying at 90%.
"""
import argparse
import datetime
import glob
import gzip
import json
import os
import re
import shutil
import subprocess
import sys
import time
import zoneinfo

PT = zoneinfo.ZoneInfo("America/Los_Angeles")
REGION = "us-east-1"
PROFILE = "dc34-application"
KV_PROFILE = "klanker-application"   # kv reads a DIFFERENT account

# The six DC34 con days, Wed-Mon. DC33's aligned window is the same six
# weekdays a year earlier -- align by WEEKDAY, never by date: DC33 ran Thu 7 to
# Sun 10 Aug 2025 and DC34 Thu 6 to Sun 9 Aug 2026, so equal dates are
# different days of the con.
DC34_START = datetime.date(2026, 8, 5)   # Wednesday
DC33_START = datetime.date(2025, 8, 6)   # Wednesday
NDAYS = 6
DC34_DAYS = [DC34_START + datetime.timedelta(days=i) for i in range(NDAYS)]
DC33_DAYS = [DC33_START + datetime.timedelta(days=i) for i in range(NDAYS)]
DAY_LABELS = [d.strftime("%a") for d in DC34_DAYS]

GHOST_LOG_GROUP = "/ecs/run-mqtt-ghosts-run-mqtt-use1-dc34"
GPX_BUCKET = "uploads-dc34-run-gpx-use1-80a6b349"
DC33_BUCKET = "defcon.run.33.backup"
DC33_PREFIX = "AWSDynamoDB/01755225714347-c2695bcb/data/"
KV_DIR = os.path.expanduser("~/working/klanker-voice/kv")

# Where each payphone DID physically is. Not derivable from the logs -- kv
# reports the dialed number only. The two "unknown"/"concierge" buckets are
# passed through verbatim and MUST stay distinct: they mean different things
# (no dialed_did line ever emitted vs. resolution ran and returned none).
DID_LOCATIONS = {
    "7254043234": "ReBAR",
    "7254043283": "LV Welcome sign",
    "7254048283": "The Rio",
    "8559164636": "Double Down",
}

HERE = os.path.dirname(os.path.abspath(__file__))


# ---------------------------------------------------------------- shell / aws

def sh(cmd, cwd=None, env=None, check=True, timeout=900):
    e = dict(os.environ)
    e.setdefault("AWS_PROFILE", PROFILE)
    e.setdefault("AWS_REGION", REGION)
    if env:
        e.update(env)
    p = subprocess.run(cmd, cwd=cwd, env=e, capture_output=True, text=True, timeout=timeout)
    if check and p.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd)}\n{p.stderr.strip()[:800]}")
    return p


def aws_json(args):
    return json.loads(sh(["aws"] + args + ["--output", "json"]).stdout)


def ddb_scan(table):
    """Full scan. No --max-items: that caps the page and truncates silently."""
    return aws_json(["dynamodb", "scan", "--table-name", table])["Items"]


def insights(group, start, end, query, timeout=240):
    qid = sh(["aws", "logs", "start-query", "--log-group-name", group,
              "--start-time", str(start), "--end-time", str(end),
              "--query-string", query, "--query", "queryId",
              "--output", "text"]).stdout.strip()
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(4)
        r = aws_json(["logs", "get-query-results", "--query-id", qid])
        if r["status"] == "Complete":
            return [{f["field"]: f["value"] for f in row} for row in r["results"]]
        if r["status"] in ("Failed", "Cancelled", "Timeout"):
            raise RuntimeError(f"insights {r['status']}")
    raise RuntimeError("insights timed out")


# ------------------------------------------------------------------ DDB value

def V(item, key, default=None):
    v = item.get(key)
    if not v:
        return default
    if "S" in v:
        return v["S"]
    if "N" in v:
        return float(v["N"])
    if "BOOL" in v:
        return v["BOOL"]
    return default


def MV(item, key, default=0.0):
    """Numeric out of an Accomplishment `metadata` map; DC33 mixes N and S."""
    v = item.get("metadata", {}).get("M", {}).get(key)
    if not v:
        return default
    try:
        return float(v["N"]) if "N" in v else float(v["S"])
    except (TypeError, ValueError, KeyError):
        return default


def ent(items, name):
    return [i for i in items if i.get("__edb_e__", {}).get("S") == name]


# --------------------------------------------------------------------- fetch

def fetch(out):
    raw = os.path.join(out, "raw")
    os.makedirs(raw, exist_ok=True)
    now = datetime.datetime.now(tz=PT)

    print("  scanning run-gpx-electro ...", flush=True)
    gpx = ddb_scan("run-gpx-electro")
    print("  scanning run-human-electro ...", flush=True)
    human = ddb_scan("run-human-electro")
    print(f"    gpx {len(gpx)} rows, human {len(human)} rows")

    print("  fetching DC33 export ...", flush=True)
    d33dir = os.path.join(raw, "dc33")
    if os.path.isdir(d33dir):
        shutil.rmtree(d33dir)
    os.makedirs(d33dir)
    sh(["aws", "s3", "cp", "--recursive", f"s3://{DC33_BUCKET}/{DC33_PREFIX}", d33dir, "--quiet"])
    dc33 = []
    for f in sorted(glob.glob(os.path.join(d33dir, "*.json.gz"))):
        with gzip.open(f, "rt") as fh:
            for line in fh:
                if line.strip():
                    dc33.append(json.loads(line)["Item"])
    print(f"    dc33 {len(dc33)} rows")

    print("  fetching heat-map artifacts ...", flush=True)
    artifacts = {}
    for year in ("dc33", "dc34"):
        p = os.path.join(raw, f"heat-{year}.json")
        try:
            sh(["aws", "s3", "cp", f"s3://{GPX_BUCKET}/uploads/HEATMAP/{year}.json", p, "--quiet"])
            artifacts[year] = json.load(open(p))["meta"]
        except Exception as exc:                                   # noqa: BLE001
            print(f"    ! {year} artifact unavailable: {exc}")
            artifacts[year] = None

    print("  querying ghost chat logs ...", flush=True)
    start = int(datetime.datetime.combine(DC34_START, datetime.time(), PT).timestamp())
    end = int(now.timestamp()) + 60
    q = ('parse @message "LLM chat burst completed for conversation from * to * '
         '(* messages)" as radio, ghost, nmsg | filter ispresent(radio) '
         '| stats count() as bursts, sum(nmsg) as sent by radio, ghost, '
         'bin(fromMillis(toMillis(@timestamp) - {}), 1d) as day'
         ).format(_con_offset_ms())
    ghosts = insights(GHOST_LOG_GROUP, start, end, "fields @timestamp | " + q)
    print(f"    ghost buckets {len(ghosts)}")

    print("  running kv telephony ...", flush=True)
    calls, calls_error = fetch_calls(now)
    if calls is None:
        print(f"    ! calls unavailable: {calls_error}")
        print(f"      (if that is an SSO error: aws sso login --profile {KV_PROFILE})")
    else:
        print(f"    calls {len(calls)}")

    blob = {
        "fetchedAt": now.isoformat(),
        "gpx": gpx, "human": human, "dc33": dc33,
        "artifacts": artifacts, "ghosts": ghosts, "calls": calls,
        "callsError": calls_error,
    }
    with open(os.path.join(raw, "all.json"), "w") as fh:
        json.dump(blob, fh)
    return blob


def _con_offset_ms():
    """PT offset in ms, so Insights day bins land on con-local days."""
    off = datetime.datetime.combine(DC34_START, datetime.time(), PT).utcoffset()
    return -int(off.total_seconds() * 1000)


def fetch_calls(now):
    """kv telephony calls. Optional: a different AWS account, own SSO session.

    MUST override AWS_PROFILE. sh() defaults it to dc34-application for every
    other source, and kv honours AWS_PROFILE over its own default -- inheriting
    it points kv at the wrong account, where the log group does not exist. That
    failed exactly like an expired SSO token and cost a debugging round.

    Returns (calls, error). NEVER swallow the reason: a silent None here hid a
    bug in this script and blamed the operator's login for it.
    """
    binary = os.path.join(KV_DIR, "bin", "kv")
    kv_env = {"AWS_PROFILE": KV_PROFILE, "AWS_REGION": REGION}
    try:
        # The shipped binary goes stale and silently lacks `telephony calls`.
        sh(["go", "build", "-o", "bin/kv", "./cmd/..."], cwd=KV_DIR, env=kv_env, timeout=300)
        hours = (now - datetime.datetime.combine(DC34_START, datetime.time(), PT))
        since = f"{int(hours.total_seconds() // 3600) + 1}h"
        p = sh([binary, "telephony", "calls", "--since", since,
                "--view", "calls", "--json"], cwd=KV_DIR, env=kv_env, timeout=300)
        return json.loads(p.stdout)["calls"], None
    except Exception as exc:                                       # noqa: BLE001
        return None, str(exc).strip().splitlines()[-1][:200] if str(exc).strip() else repr(exc)


# ------------------------------------------------------------------- compute

def compute(blob):
    gpx, human, dc33 = blob["gpx"], blob["human"], blob["dc33"]
    fetched = datetime.datetime.fromisoformat(blob["fetchedAt"])

    # --- Strava cache: the only place moving time exists. `activities` is a
    # --- JSON string, and its `trainer` / summary_polyline decide treadmill.
    acts = {}
    for r in ent(gpx, "gpxStravaCache"):
        s = r.get("activities", {}).get("S")
        if s:
            for a in json.loads(s):
                acts[str(a.get("id"))] = a

    def act_for(f):
        sid = V(f, "stravaActivityId")
        return acts.get(str(int(sid))) if sid else None

    # --- DC34: a run is a con-tagged file with a recorded distance.
    con = [f for f in ent(gpx, "GpxFile") if V(f, "conDay")]
    runs = [f for f in con if (V(f, "totalDistance", 0) or 0) > 0]
    matched = [(f, act_for(f)) for f in runs if act_for(f)]

    tread, outdoor = [], []
    for f in runs:
        a = act_for(f)
        indoor = bool(a.get("trainer")) if a else False
        nogeo = (not a.get("map", {}).get("summary_polyline")) if a else ("bounds" not in f)
        (tread if (indoor or nogeo) else outdoor).append((f, a))

    def km(fs):
        return round(sum(V(f, "totalDistance", 0) or 0 for f in fs) / 1000, 1)

    def hrs(pairs):
        return round(sum((a.get("moving_time") or 0) for _, a in pairs if a) / 3600, 1)

    dc34 = {
        "runs": len(runs), "km": km(runs),
        "runners": len({V(f, "userId") for f in runs}),
        "hours": hrs(matched), "hoursRuns": len(matched),
        "elev": round(sum(V(f, "totalElevation", 0) or 0 for f in runs)),
        "treadRuns": len(tread), "treadKm": km([f for f, _ in tread]),
        "treadRunners": len({V(f, "userId") for f, _ in tread}),
        "treadHours": hrs(tread),
        "outRuns": len(outdoor), "outKm": km([f for f, _ in outdoor]),
        "outHours": hrs(outdoor),
        "kmByDay": {d.isoformat(): 0.0 for d in DC34_DAYS},
        "runsByDay": {d.isoformat(): 0 for d in DC34_DAYS},
        "zeroDistance": len(con) - len(runs),
        "untagged": len(ent(gpx, "GpxFile")) - len(con),
        "unmatched": len(runs) - len(matched),
    }
    for f in runs:
        d = V(f, "conDay")
        if d in dc34["kmByDay"]:
            dc34["kmByDay"][d] += (V(f, "totalDistance", 0) or 0) / 1000
            dc34["runsByDay"][d] += 1
    dc34["kmByDay"] = {k: round(v, 1) for k, v in dc34["kmByDay"].items()}
    dc34["avgKm"] = round(dc34["km"] / dc34["runs"], 1) if dc34["runs"] else 0
    dc34["rides"] = sum(1 for _, a in matched
                        if a and "ride" in (a.get("sport_type") or "").lower())

    # --- run.human counters
    bibs = ent(human, "Bib")
    donations = ent(human, "GeneralDonation")
    solves = ent(human, "CtfSolve")
    dc34.update({
        "registered": len(ent(human, "RunUser")),
        "bibs": len(bibs),
        "bibsPaid": sum(1 for b in bibs if (V(b, "paidAmount", 0) or 0) > 0),
        "bibRevenue": round(sum(V(b, "paidAmount", 0) or 0 for b in bibs) / 100, 2),
        "bibInPerson": sum(1 for b in bibs if V(b, "willPayInPerson")),
        "bibBurned": sum(1 for b in bibs if V(b, "burned")),
        "bibPasses": len(ent(human, "BibPickupPass")),
        "donations": len(donations),
        "donationTotal": round(sum(V(d, "amountCents", 0) or 0 for d in donations) / 100, 2),
        "checkins": len(ent(human, "CheckIn")),
        "social": len(ent(human, "SocialPair")),
        "cluster": len(ent(human, "ClusterAward")),
        "ctfSolves": len(solves),
        "ctfChallenges": len(ent(human, "Ctf")),
        "qrScans": int(sum(V(q, "count", 0) or 0 for q in ent(human, "Qrstat"))),
        "qrCodes": len({V(q, "code") for q in ent(human, "Qrstat")}),
        "radios": len(ent(human, "MeshRadio")),
        "radiosFlashed": sum(1 for m in ent(human, "MeshRadio") if V(m, "source") == "flash"),
    })
    dc34["checkinsByDay"] = _by_day(ent(human, "CheckIn"), "createdAt")
    dc34["socialByDay"] = _by_day(ent(human, "SocialPair"), "createdAt")
    dc34["ctfByDay"] = _by_day(solves, "solvedAt")

    tally = {}
    for s in solves:
        tally[V(s, "challenge")] = tally.get(V(s, "challenge"), 0) + 1
    dc34["ctfByChallenge"] = dict(sorted(tally.items(), key=lambda kv: -kv[1]))
    dc34["ctfSingleSolve"] = sum(1 for n in tally.values() if n == 1)

    # --- DC33: PLURAL entity, year 2025, distance-bearing rows only.
    y25 = [a for a in dc33
           if a.get("__edb_e__", {}).get("S") == "Accomplishments"
           and (a.get("year", {}).get("S") or a.get("year", {}).get("N")) == "2025"]
    act33 = [a for a in y25 if a.get("type", {}).get("S") == "activity"]
    d33 = [a for a in act33 if MV(a, "distance") > 0]
    prev = {
        "runs": len(d33),
        "km": round(sum(MV(a, "distance") for a in d33) / 1000, 1),
        "hours": round(sum(MV(a, "moving_time") for a in d33) / 3600, 1),
        "runners": len({a["userId"]["S"] for a in d33}),
        "elev": round(sum(MV(a, "total_elevation_gain") for a in d33)),
        "social": sum(1 for a in y25 if a.get("type", {}).get("S") == "social"),
        "meshctf": sum(1 for a in y25 if a.get("type", {}).get("S") == "meshctf"),
        "activityRows": len(act33),
        "noDistanceRows": len(act33) - len(d33),
        "kmByDay": {d.isoformat(): 0.0 for d in DC33_DAYS},
    }
    outside = 0.0
    for a in d33:
        day = datetime.datetime.fromtimestamp(
            int(a["completedAt"]["N"]) / 1000, PT).date().isoformat()
        if day in prev["kmByDay"]:
            prev["kmByDay"][day] += MV(a, "distance") / 1000
        else:
            outside += MV(a, "distance") / 1000
    prev["kmByDay"] = {k: round(v, 1) for k, v in prev["kmByDay"].items()}
    prev["kmOutsideWindow"] = round(outside, 1)
    prev["avgKm"] = round(prev["km"] / prev["runs"], 1) if prev["runs"] else 0

    # --- ghosts
    g = {"bursts": 0, "messages": 0, "radios": set(), "byDay": {d.isoformat(): 0 for d in DC34_DAYS},
         "byRadio": {}}
    for r in blob["ghosts"] or []:
        n = int(r.get("bursts", 0))
        g["bursts"] += n
        g["messages"] += int(float(r.get("sent", 0)))
        g["radios"].add(r.get("radio"))
        g["byRadio"][r.get("radio")] = g["byRadio"].get(r.get("radio"), 0) + n
        day = (r.get("day") or "")[:10]
        if day in g["byDay"]:
            g["byDay"][day] += n
    top2 = sorted(g["byRadio"].values(), reverse=True)[:2]
    g["radios"] = len(g["radios"])
    g["top2Share"] = round(100 * sum(top2) / g["bursts"]) if g["bursts"] else 0
    g["top2"] = sum(top2)

    # --- calls (optional)
    calls = blob.get("calls")
    if calls is None:
        ph = None
    else:
        per = {}
        for c in calls:
            k = c.get("didLabel") or "unknown"
            e = per.setdefault(k, {"calls": 0, "callers": set(), "solved": 0, "timeout": 0})
            e["calls"] += 1
            e["callers"].add(c["caller"])
            if c.get("outcome") == "announcement_code":
                e["solved"] += 1
            elif c.get("outcome") == "gate_timeout":
                e["timeout"] += 1
        for e in per.values():
            e["callers"] = len(e["callers"])
        solved_by = {c["caller"] for c in calls if c.get("outcome") == "announcement_code"}
        ph = {
            "total": len(calls),
            "callers": len({c["caller"] for c in calls}),
            "minutes": round(sum(c.get("durationSeconds", 0) for c in calls) / 60, 1),
            "solved": sum(1 for c in calls if c.get("outcome") == "announcement_code"),
            "timeout": sum(1 for c in calls if c.get("outcome") == "gate_timeout"),
            "solvers": len(solved_by),
            "perDid": dict(sorted(per.items(), key=lambda kv: -kv[1]["calls"])),
        }

    return {
        "fetchedAt": blob["fetchedAt"],
        "asOf": fetched.strftime("%a %-d %b %H:%M PT"),
        "conOver": fetched.date() > DC34_DAYS[-1],
        "dc34": dc34, "dc33": prev, "ghosts": g, "phones": ph,
        "callsError": blob.get("callsError"),
        "artifacts": blob.get("artifacts") or {},
    }


def _by_day(rows, field):
    out = {d.isoformat(): 0 for d in DC34_DAYS}
    for r in rows:
        v = V(r, field)
        if not v:
            continue
        if isinstance(v, str) and "T" in v:
            t = datetime.datetime.fromisoformat(v.replace("Z", "+00:00")).astimezone(PT)
        elif isinstance(v, (int, float)):
            t = datetime.datetime.fromtimestamp(v / 1000 if v > 1e11 else v, PT)
        else:
            continue
        k = t.date().isoformat()
        if k in out:
            out[k] += 1
    return out


# -------------------------------------------------------------------- render

ENT = {"—": "&mdash;", "–": "&ndash;", "·": "&middot;",
       "▲": "&#9650;", "▼": "&#9660;", "×": "&times;",
       "’": "&rsquo;", "≤": "&le;", "≥": "&ge;"}


def esc(s):
    """Every page ships pure ASCII: the host's charset is not ours to assume."""
    for k, v in ENT.items():
        s = s.replace(k, v)
    return re.sub(r"[^\x00-\x7f]", lambda m: "&#%d;" % ord(m.group()), s)


def delta(now, then, invert_ok=True):
    """YoY badge. Ratios past 3x read as a multiple -- '+1024%' means nothing."""
    if not then:
        return '<span class="new">new this year</span>'
    r = now / then
    if r >= 3:
        return f'<span class="up">&#9650; &times;{r:.0f}</span> <span class="was">&middot; {_n(then)} at DC33</span>'
    pct = round((r - 1) * 100)
    cls, arrow = ("up", "&#9650;") if pct >= 0 else ("dn", "&#9660;")
    if not invert_ok:
        cls = "dn"
    return (f'<span class="{cls}">{arrow} {abs(pct)}%</span> '
            f'<span class="was">&middot; {_n(then)} at DC33</span>')


def _did(d):
    """725-404-3234 out of 7254043234; pass non-numeric buckets through."""
    if len(d) == 10 and d.isdigit():
        return f"{d[:3]}-{d[3:6]}-{d[6:]}"
    return d


def _n(v):
    if isinstance(v, float):
        return f"{v:,.1f}" if v % 1 else f"{v:,.0f}"
    return f"{v:,}"


def row(fig, unit, right=""):
    return (f'<div class="row"><div class="figure">{fig}<span class="unit">{unit}</span></div>'
            f'<div class="dots"></div><div class="delta">{right}</div></div>')


def note(text):
    return f'<p class="note">{text}</p>'


def heat(rows, labels):
    """rows: (label, css, [values], partial_index, scale_max, future_from).

    `future_from` is the first column whose day has not happened yet; those
    cells render as a dash, never as 0 -- a zero in a con-day column reads as
    "nobody ran" when it means "the day is still ahead", the same lie an
    unqueried window tells. It is PER ROW because DC33 is finished (every
    column real) while DC34 is mid-con in the very same grid.
    """
    out = ['<div class="heat-grid">', "<div></div>"]
    out += [f'<div class="heat-head">{d}</div>' for d in labels]
    for label, css, vals, partial, top, future_from in rows:
        out.append(f'<div class="heat-label {css}">{label}</div>')
        for i, v in enumerate(vals):
            klass = "cell " + ("th" if css == "then" else "on")
            if future_from is not None and i >= future_from:
                out.append(f'<div class="{klass}"><div class="fill" style="opacity:0"></div>'
                           "<span>&mdash;</span></div>")
                continue
            o = (v / top) if top else 0
            if o > 0.8:
                klass += " dark-text"
            if partial is not None and i == partial:
                klass += " partial"
            out.append(f'<div class="{klass}"><div class="fill" style="opacity:{o:.3f}"></div>'
                       f"<span>{_n(v)}</span></div>")
    out.append("</div>")
    return "\n".join(out)


def _future_index(s):
    """First con day strictly after the fetch date, or None once the con ends."""
    today = datetime.datetime.fromisoformat(s["fetchedAt"]).date()
    return next((i for i, d in enumerate(DC34_DAYS) if d > today), None)


def shell(title, width, body):
    t = open(os.path.join(HERE, "templates", "shell.html")).read()
    return (t.replace("{{TITLE}}", title).replace("{{WIDTH}}", width)
             .replace("{{HEAT_COLS}}", str(NDAYS)).replace("{{BODY}}", body))


def render_public(s):
    a, b, g = s["dc34"], s["dc33"], s["ghosts"]
    live = ("Final figures." if s["conOver"] else
            "The con is still running &mdash; every figure below is a floor, not a total.")
    body = [f'''<header class="masthead">
    <h1>DEF CON 34 Run<br /><span class="accent">By the Numbers</span></h1>
    <div class="dateline">Wed 5 &ndash; Mon 10 August 2026 &nbsp;&middot;&nbsp; Las Vegas
      <span class="live">Counted {s["asOf"]}. {live}</span></div>
  </header>''']

    body.append("<section><h2>The Running</h2>"
        + row(_n(a["km"]), "km covered", delta(a["km"], b["km"]))
        + row(_n(a["runs"]), "runs logged", delta(a["runs"], b["runs"]))
        + row(_n(a["runners"]), "runners ran", delta(a["runners"], b["runners"]))
        + row(_n(a["hours"]), "hours moving",
              f'<span class="new">measured on {a["hoursRuns"]} of {a["runs"]} runs</span>')
        + row(_n(a["avgKm"]), "km average run", delta(a["avgKm"], b["avgKm"]))
        + row(_n(a["elev"]), "m climbed", delta(a["elev"], b["elev"]))
        + row(_n(a["treadKm"]), "km on treadmills",
              f'<span class="new">new this year</span> <span class="was">&middot; '
              f'{a["treadRuns"]} runs, {a["treadRunners"]} runners</span>')
        + row(_n(a["outKm"]), "km outdoors",
              f'<span class="was">{a["outRuns"]} runs on the Strip and beyond</span>')
        + note(f'The hours row carries no year-on-year figure on purpose: {a["unmatched"]} runs '
               f'have no timing source, so {_n(a["hours"])} h is a floor while DC33&rsquo;s '
               f'{_n(b["hours"])} h is complete. Comparing them would invent a decline.')
        + "</section>")

    top = max(list(a["kmByDay"].values()) + list(b["kmByDay"].values()))
    partial = None if s["conOver"] else _partial_index(s)
    fut = _future_index(s)
    body.append('<section class="heat"><h2>Kilometres per Day</h2>'
        + heat([("DC33", "then", list(b["kmByDay"].values()), None, top, None),
                ("DC34", "now", list(a["kmByDay"].values()), partial, top, fut)], DAY_LABELS)
        + f'''<p class="heat-cap">Aligned by weekday, not by date &mdash; DC33 ran Thu 7 to Sun 10
        August 2025, DC34 Thu 6 to Sun 9 August 2026. Both rows share one scale, so a darker cell
        is genuinely a bigger day.{"" if s["conOver"] else
          " <br />* still in progress; a dash is a con day that has not happened yet."}
        <br />DC33 also logged {_n(b["kmOutsideWindow"])} km outside this window; DC34&rsquo;s day
        tag cannot record those.</p></section>''')

    body.append("<section><h2>The Con Around It</h2>"
        + row(_n(a["registered"]), "runners registered",
              f'<span class="was">{round(100*a["runners"]/a["registered"])}% of them logged a run</span>')
        + row(_n(a["bibs"]), "bibs issued", '<span class="new">new this year</span>')
        + row(_n(a["social"]), "runner-to-runner connections", delta(a["social"], b["social"]))
        + row(_n(a["checkins"]), "check-ins", '<span class="new">new this year</span>')
        + row(_n(a["cluster"]), "group-run bonuses",
              '<span class="was">runners who showed up together</span>')
        + row(_n(a["qrScans"]), "QR scans", f'<span class="was">across {a["qrCodes"]} codes</span>')
        + "</section>")

    games = ("<section><h2>The Games</h2>"
        + row(_n(a["ctfSolves"]), "CTF solves", delta(a["ctfSolves"], b["meshctf"]))
        + row(_n(a["ctfChallenges"]), "challenges live",
              '<span class="was">every one of them found</span>')
        + row(_n(a["radios"]), "mesh radios registered",
              f'<span class="was">{a["radiosFlashed"]} flashed in the browser</span>')
        + row(_n(g["bursts"]), "conversations with mesh ghosts",
              f'<span class="was">{_n(g["messages"])} messages sent back</span>'))
    if s["phones"]:
        games += row(_n(s["phones"]["total"]), "calls to the payphones",
                     f'<span class="was">{s["phones"]["solved"]} of them cracked the code</span>')
    games += note("DC33&rsquo;s mesh CTF and DC34&rsquo;s are different games, so that multiple "
                  "measures the new game arriving, not the old one growing.") + "</section>"
    body.append(games)

    art = _artifact_line(s)
    body.append(f'''<div class="method"><h2>How These Were Counted</h2>
    <p>A <b>run</b> is any logged activity carrying a recorded distance, tagged to a con day.
    On that basis DC34 has {_n(a["runs"])} runs and {_n(a["km"])} km against DC33&rsquo;s
    {_n(b["runs"])} and {_n(b["km"])}. {art} Both readings are here so neither hides the other.</p>
    <p>DC33 figures come from a DynamoDB export taken 15 August 2025, after that con closed.
    No individual runner, route, radio or phone number appears on this page.</p></div>''')

    return shell("DEF CON 34 Run &mdash; By the Numbers", "74ch", "\n".join(body))


def _partial_index(s):
    today = datetime.datetime.fromisoformat(s["fetchedAt"]).date()
    return next((i for i, d in enumerate(DC34_DAYS) if d == today), None)


def _artifact_line(s):
    a33, a34 = s["artifacts"].get("dc33"), s["artifacts"].get("dc34")
    if not (a33 and a34):
        return ""
    d = s["dc34"]
    return (f'The heat-map builder &mdash; the one piece of code that has processed both years '
            f'identically &mdash; reads <b>{_n(a34["runCount"])} runs / {_n(a34["totalKm"])} km</b> '
            f'for DC34 against <b>{_n(a33["runCount"])} / {_n(a33["totalKm"])}</b> for DC33. '
            f'It sees only runs with drawable geometry, which is why it is lower.')


def render_operator(s):
    a, b, g, p = s["dc34"], s["dc33"], s["ghosts"], s["phones"]
    total = round(a["bibRevenue"] + a["donationTotal"], 2)
    unpaid = a["bibs"] - a["bibsPaid"] - a["bibInPerson"]
    live = ("Final figures." if s["conOver"] else "Con still running. Every figure is a floor.")
    body = [f'''<header class="masthead">
    <span class="stamp">Operator copy &mdash; contains money and reach data</span>
    <h1>DC34 Run<br /><span class="accent">Operator Numbers</span></h1>
    <div class="dateline">Wed 5 &ndash; Mon 10 August 2026 &nbsp;&middot;&nbsp; us-east-1
      <span class="live">Counted {s["asOf"]}. {live}</span></div>
  </header>''']

    body.append("<section><h2>Money</h2>"
        + row(f"${total:,.2f}", "taken in total", '<span class="new">Stripe live</span>')
        + row(f'${a["bibRevenue"]:,.2f}', "bib payments",
              f'{a["bibsPaid"]} of {a["bibs"]} bibs paid &mdash; '
              f'<span class="bad">{round(100*a["bibsPaid"]/a["bibs"])}%</span>')
        + row(f'${a["donationTotal"]:,.2f}', "donations",
              f'{a["donations"]} donors, ${a["donationTotal"]/max(a["donations"],1):,.2f} average')
        + row(_n(a["bibInPerson"]), "bibs marked pay-in-person", "not yet reconciled")
        + row(f'${a["bibRevenue"]/max(a["bibsPaid"],1):,.2f}', "average paid bib",
              f'${a["bibRevenue"]/max(a["bibs"],1):,.2f} per bib issued')
        + note(f'{unpaid} of {a["bibs"]} bibs carry no payment and no pay-in-person mark. If that '
               f'is intended (free entry by default) the revenue line is working as designed; if '
               f'not, it is the single largest gap on this page.')
        + "</section>")

    body.append("<section><h2>Running &mdash; Distance Basis</h2>"
        + row(_n(a["km"]), "km covered", delta(a["km"], b["km"]))
        + row(_n(a["runs"]), "runs logged", delta(a["runs"], b["runs"]))
        + row(_n(a["runners"]), "distinct runners", delta(a["runners"], b["runners"]))
        + row(_n(a["hours"]), "hours moving",
              f'{a["hoursRuns"]} of {a["runs"]} runs timed')
        + row(_n(a["elev"]), "m climbed", delta(a["elev"], b["elev"]))
        + row(_n(a["treadKm"]), "km treadmill",
              f'{a["treadRuns"]} runs &middot; {a["treadRunners"]} runners &middot; {_n(a["treadHours"])} h')
        + row(_n(a["outKm"]), "km outdoor",
              f'{a["outRuns"]} runs &middot; {_n(a["outHours"])} h')
        + "</section>")

    top = max(list(a["kmByDay"].values()) + list(b["kmByDay"].values()))
    partial = None if s["conOver"] else _partial_index(s)
    fut = _future_index(s)
    grids = heat([("DC33 km", "then", list(b["kmByDay"].values()), None, top, None),
                  ("DC34 km", "now", list(a["kmByDay"].values()), partial, top, fut)], DAY_LABELS)
    act_rows = [("Check-ins", "", list(a["checkinsByDay"].values())),
                ("Social", "", list(a["socialByDay"].values())),
                ("CTF solves", "", list(a["ctfByDay"].values())),
                ("Ghost chats", "", list(g["byDay"].values()))]
    grids += heat([(lbl, css, vals, partial, max(vals) or 1, fut) for lbl, css, vals in act_rows],
                  DAY_LABELS)
    call_note = ("" if p else " Calls are absent from this grid: the kv query did not run, so a "
                 "zero cell would mean unmeasured rather than none.")
    body.append('<section class="heat"><h2>Per Day, Weekday-Aligned</h2>' + grids
        + f'<p class="heat-cap">The two km rows share one scale so the years compare directly; '
          f'each activity row below scales to its own maximum, so read those down a row, never '
          f'across.{call_note}{"" if s["conOver"] else
            " <br />* still in progress; a dash is a con day that has not happened yet."}</p></section>')

    reach = ("<section><h2 class=\"warn\">Reach &mdash; Who Actually Showed Up</h2>"
        + row(f'{round(100*a["runners"]/a["registered"])}%', "of registered runners ran",
              f'<span class="bad">{a["runners"]} of {a["registered"]}</span>')
        + row(f'{round(100*a["bibBurned"]/a["bibs"])}%', "of bibs were picked up",
              f'<span class="bad">{a["bibBurned"]} of {a["bibs"]}</span> &middot; {a["bibPasses"]} passes')
        + row(f'{round(100*g["radios"]/a["radios"])}%', "of radios talked to a ghost",
              f'<span class="bad">{g["radios"]} of {a["radios"]}</span>')
        + row(f'{g["top2Share"]}%', "of ghost chat is 2 people",
              f'<span class="bad">{g["top2"]} of {g["bursts"]}</span>'))
    if p:
        reach += row("100%", "of phone solves is few callers",
                     f'<span class="bad">{p["solvers"]} callers</span> &middot; {p["callers"]} total')
    if a["ctfByChallenge"]:
        topc, topn = next(iter(a["ctfByChallenge"].items()))
        reach += row(f'{round(100*topn/a["ctfSolves"])}%', "of CTF solves is one flag",
                     f'{topn} of {a["ctfSolves"]} on <b>{topc}</b>')
    reach += note("Every side-channel works and every side-channel is being found by roughly a "
                  "dozen people. The constraint is discovery, not the experiences.") + "</section>"
    body.append(reach)

    if p:
        rows = "".join(
            f'<tr><td>{_did(did)}</td><td>{DID_LOCATIONS.get(did, "&mdash;")}</td>'
            f'<td class="num">{e["calls"]}</td><td class="num">{e["callers"]}</td>'
            f'<td class="num">{e["solved"]}</td><td class="num">{e["timeout"]}</td></tr>'
            for did, e in p["perDid"].items())
        body.append('<section><h2>Payphones &mdash; Per Number</h2><div class="scroll"><table>'
            '<thead><tr><th>Number</th><th>Where</th><th class="num">Calls</th>'
            '<th class="num">Callers</th>'
            '<th class="num">Solved</th><th class="num">Timed out</th></tr></thead>'
            f'<tbody>{rows}</tbody></table></div>'
            + note(f'{p["total"]} calls, {p["callers"]} callers, {_n(p["minutes"])} minutes of talk. '
                   f'<b>{round(100*p["timeout"]/p["total"])}% time out at the gate</b> '
                   f'&mdash; {p["timeout"]} of {p["total"]}. The Red Phone (945-369-0089) is a '
                   f'personal handset and produces no records by design.') + "</section>")
    else:
        body.append('<section><h2>Payphones</h2>'
            + note("Call data unavailable this run &mdash; <code>kv telephony</code> could not "
                   "reach CloudWatch. Fix with <code>aws sso login --profile "
                   "klanker-application</code> and re-run; nothing else on this page depends "
                   "on it.") + "</section>")

    if a["ctfByChallenge"]:
        items = list(a["ctfByChallenge"].items())
        head, tail = items[:9], items[9:]
        mx = head[0][1]
        rows = "".join(f'<tr><td>{k}</td><td class="solves">{v}</td>'
                       f'<td class="share"><span class="bar" style="width:{100*v/mx:.1f}%"></span></td></tr>'
                       for k, v in head)
        if tail:
            n = sum(v for _, v in tail)
            rows += (f'<tr><td>{len(tail)} others</td><td class="solves">{n}</td>'
                     f'<td class="share"><span class="bar" style="width:{100*n/mx:.1f}%"></span></td></tr>')
        body.append('<section><h2>CTF &mdash; Where the Solves Landed</h2><div class="scroll"><table>'
            '<thead><tr><th>Challenge</th><th class="solves">Solves</th><th class="share">Share</th>'
            f'</tr></thead><tbody>{rows}</tbody></table></div>'
            + note(f'{a["ctfChallenges"]} challenges live, all found at least once. '
                   f'{a["ctfSingleSolve"]} have exactly one solve.') + "</section>")

    body.append('<section><h2 class="warn">Data Quality &mdash; Read Before Quoting</h2>'
        + row(_n(a["untagged"]), "GpxFiles carry no con day",
              '<span class="bad">invisible to heat map and board</span>')
        + row(_n(a["unmatched"]), "con runs have no timing source", "hours are a floor")
        + row(_n(a["zeroDistance"]), "con runs record zero distance", "excluded from every total")
        + row(_n(b["noDistanceRows"]), "DC33 rows lack distance entirely",
              f'of {b["activityRows"]} &middot; why DC33 shows {b["runs"]}')
        + row(_n(a["rides"]), "rides tagged as con runs", "auto-tag excludes rides; these were manual")
        + note("DC33 counts by true completion date and logged "
               f'{_n(b["kmOutsideWindow"])} km outside this six-day window. DC34&rsquo;s con-day tag '
               "only permits Aug 5&ndash;10, so it structurally cannot record the same spread.")
        + "</section>")

    body.append(f'''<div class="method"><h2>Sources</h2>
    <p><b>DC34</b> &mdash; full scans of <code>run-gpx-electro</code> and
    <code>run-human-electro</code> plus the cached Strava payloads for moving time.
    <b>DC33</b> &mdash; <code>s3://{DC33_BUCKET}</code>, prefix <code>{DC33_PREFIX}</code>,
    filtered to <code>Accomplishments</code> with <code>year=2025</code>.
    <b>Phones</b> &mdash; <code>kv telephony calls</code>. <b>Ghosts</b> &mdash; Logs Insights
    over <code>{GHOST_LOG_GROUP}</code>.</p>
    <p>Regenerate with <code>scripts/dc34-stats/dc34_stats.py --all</code>. Do not share this
    copy &mdash; it carries payment totals and per-number call data.</p></div>''')

    return shell("DC34 Run &mdash; Operator Numbers", "78ch", "\n".join(body))


# ----------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description="DC34 stats one-pagers")
    ap.add_argument("--out", default=os.path.join(os.getcwd(), "out", "dc34-stats"))
    ap.add_argument("--fetch", action="store_true", help="pull sources only")
    ap.add_argument("--render", action="store_true", help="rebuild pages from last fetch")
    ap.add_argument("--all", action="store_true", help="fetch then render (default)")
    args = ap.parse_args()
    do_fetch = args.fetch or args.all or not (args.fetch or args.render)
    do_render = args.render or args.all or not (args.fetch or args.render)

    os.makedirs(args.out, exist_ok=True)
    cache = os.path.join(args.out, "raw", "all.json")

    if do_fetch:
        print("fetching ...")
        blob = fetch(args.out)
    else:
        if not os.path.exists(cache):
            sys.exit(f"no cached fetch at {cache} -- run with --all first")
        blob = json.load(open(cache))
        print(f"using cached fetch from {blob['fetchedAt']}")

    if not do_render:
        return

    print("computing ...")
    stats = compute(blob)
    with open(os.path.join(args.out, "stats.json"), "w") as fh:
        json.dump(stats, fh, indent=1, default=str)

    for name, html in (("dc34-by-the-numbers.html", render_public(stats)),
                       ("dc34-operator-numbers.html", render_operator(stats))):
        path = os.path.join(args.out, name)
        with open(path, "w") as fh:
            fh.write(esc(html))
        print(f"  wrote {path}")

    d = stats["dc34"]
    print(f"\n{d['km']} km / {d['runs']} runs / {d['runners']} runners / {d['hours']} h "
          f"(as of {stats['asOf']})")
    if stats["phones"] is None:
        print(f"NOTE: call data missing -- {blob.get('callsError')}")


if __name__ == "__main__":
    main()
