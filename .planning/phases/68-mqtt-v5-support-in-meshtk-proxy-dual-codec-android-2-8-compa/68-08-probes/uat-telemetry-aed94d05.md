# Task 3 UAT corroboration — Android `!aed94d05` on meshtk v0.0.73

All counts scoped with `--log-stream-names meshtk/run-mqtt-meshtk/17a91e1151984604a3783db2d78687b5`
(task def `run-mqtt-use1-dc34:116`, `dc34-run-mqtt-meshtk:v0.0.73`). That task started
~18:52Z and was still the sole running task at 20:52Z, so the entire UAT window is on one
image and no wall-clock attribution is involved.

Client id family: `MeshtasticAndroidMqttProxy-!aed94d05-*`, MQTT username `b84cf62c402c`.

**Kurt's verdict, verbatim:** "OK! looks ok" — he did not state how long he actually idled,
so the idle duration below is derived from telemetry timestamps, not from the report.

## The four corroboration checks

| Check | Result |
|---|---|
| `action=MQTT5_CONNECT` for the phone's client id | ✅ 16 lines, 18:54:04Z → 20:27:54Z |
| `action=ALLOW` lines for its publishes | ✅ 55 `[proxy] ALLOW … from=!aed94d05 … type=POSITION_APP topic=[msh/US/2/e/dc.run/!aed94d05] user=b84cf62c402c` |
| Zero BLOCK carrying the username-required reason | ✅ `"Username required for MQTT"` count = **0** over the whole task lifetime |
| No second `MQTT5_CONNECT` inside the idle window | ⚠️ **see below — this is the check that does not clear the 9-minute bar** |

## Health signals on the same stream (whole task lifetime)

| Signal | Count | Attribution |
|---|---|---|
| `MQTT5_PUBLISH_HEADER_FAIL` | **0** | the 68-07 fail-closed path never fired on a real client |
| `panic` | **0** | |
| `MQTT5_PARSE_FAIL` | 2 | both the `cr04-unmodelled-block` probe, by client id |
| `MQTT5_PROTOCOL_VIOLATION` | 2 | both the `cr03-second-connect` probe, by client id |
| `[proxy] BLOCK` | 2 | both the `cr04` probe (`reason="Failed to decrypt with any known key"`) |

Zero real-client harm from either new code path across ~2 hours, including ~36 minutes of
continuous real Android publishing.

## Why the 9-minute bar is not met

Longest publish-idle-then-successful-publish on a single session with **no intervening
`MQTT5_CONNECT`**:

```
20:10:01Z  action=MQTT5_CONNECT   (client id ...fdcc313a)
   ... 416s with no publish and no reconnect ...
20:16:57Z  action=ALLOW  mqtt_type=PUBLISH  POSITION_APP   <- succeeded
```

**416s = 6m56s.** No window ≥540s (the UAT's nine minutes) exists anywhere in the telemetry.

The currently-open session is long but does **not** discriminate the fix:

```
20:27:54Z  MQTT5_CONNECT, no further CONNECT
20:29:00Z -> 20:52:02Z   25 consecutive successful publishes
session length 24m08s, zero reconnects, zero Blocks
inter-publish gaps: min 4s, median 65s, max 67s
```

A client publishing every ~65s never idles past the reaper's 180s threshold, so this session
would have survived on the **old** code too. Session length alone is not CR-02 evidence.

At 416s the old code's reaper had a qualifying tick for `(416 − 180) / 300` = **78.7%** of
possible tick phases, so the 6m56s observation favours the fix but is probabilistic rather
than guaranteed-discriminating. The guaranteed window is ≥480s, which is what the machine
probe used — and there `cr02-idle` PASSed post-deploy and FAILed pre-deploy at the identical
duration.

## Reconnect cadence, and its actual cause

When the phone is idle it re-establishes on its own every ~1–5 minutes, which is why a
nine-minute connected-idle window may not be reachable with this client at all:

```
CONNECT gaps: 530s, 273s, 219s, 1613s, 124s, 673s, 572s, 127s, 67s, 67s, 285s, 418s, 133s, 396s, 125s
```

Two of the reconnects have an identified proxy-side cause, and it is **not** CR-02 and not
this plan's changes:

```
20:16:57Z level=error failed to write to backend: write tcp 127.0.0.1:38104->127.0.0.1:1884: write: broken pipe
20:16:59Z action=MQTT5_CONNECT   (reconnect 2s later)
20:19:08Z level=error failed to write to backend: write tcp 127.0.0.1:42922->127.0.0.1:1884: write: broken pipe
20:19:12Z action=MQTT5_CONNECT   (reconnect 4s later)
```

The proxy decided ALLOW, then found the proxy→**mosquitto** socket already closed and dropped
the client connection — correct behaviour on a dead backend, on a code path that predates this
phase and is shared with the 3.1.1 loop. The remaining reconnects carry no proxy-side error,
Block or violation at all, so they are client- or network-side.

This proxy↔broker socket death is a **new, separate observation** worth its own investigation.
It is not a regression from 68-06/68-07: `timeout` = 0, `EOF` = 0, and the only two
`level=error` lines on the stream are the two above.

## Status

CR-02 is machine-proven at a guaranteed-discriminating 480s (pre/post contrast recorded in
`transcript-pre-deploy-v0.0.72.txt` and `transcript-post-deploy-v0.0.73.txt`). What this
telemetry does **not** yet establish is the real-Android version of the same claim at the
nine-minute bar the UAT specifies. Recorded as a qualified result pending Kurt's decision
rather than upgraded to a clean pass.
