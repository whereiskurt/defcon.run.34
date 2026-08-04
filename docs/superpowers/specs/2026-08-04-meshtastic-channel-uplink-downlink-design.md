# Meshtastic channel uplink/downlink — dc.run only

**Date:** 2026-08-04
**App:** `apps/run.flash`

## Problem

The flasher hardcodes `uplinkEnabled: true` / `downlinkEnabled: true` for **every**
channel it pushes (`apps/run.flash/webapp/src/lib/meshtastic.ts:599-600`), inside the
`for` loop over `config.channels`. There is no per-channel control.

That means all five provisioned channels bridge to MQTT:

| idx | name | role | what it is |
|---|---|---|---|
| 0 | `dc.run` | PRIMARY | our event channel |
| 1 | `DEFCONnect` | SECONDARY | DEF CON 34 event firmware, public PSK |
| 2 | `HackerComms` | SECONDARY | DEF CON 34 event firmware, public PSK |
| 3 | `NodeChat` | SECONDARY | DEF CON 34 event firmware, public PSK |
| 4 | `LongFast` | SECONDARY | public default-key bridge channel |

Channels 1-3 carry PSKs that are baked into `meshtastic/firmware event/defcon34`
userPrefs — they are world-readable constants. Bridging them means our radios
forward other attendees' event-channel RF into `mqtt.defcon.run`, and push MQTT
traffic back out onto shared event channels. Neither is intended.

## Decision

**MQTT uplink and downlink are enabled on `dc.run` (index 0) only.** All four
secondary channels — the three DEF CON event channels *and* `LongFast` — get both
flags `false`.

`LongFast` is included deliberately (confirmed with Kurt): our fleet stops feeding
public LongFast RF into our broker.

## Design

### 1. Type — `src/types/config.ts`

Add to `ChannelConfig`:

```ts
uplinkEnabled?: boolean;
downlinkEnabled?: boolean;
```

Optional, defaulting to `false` at the read site. "Unset" is therefore the safe
posture: a channel added later does not accidentally start bridging.

### 2. Config — `src/config/meshtastic.ts`

`dc.run` gets both `true`. `DEFCONnect`, `HackerComms`, `NodeChat`, `LongFast` each
get both `false`, written **explicitly** rather than omitted, so the channel table
states each channel's MQTT posture next to its PSK and position precision.

### 3. Push — `src/lib/meshtastic.ts`

```ts
uplinkEnabled: ch.uplinkEnabled ?? false,
downlinkEnabled: ch.downlinkEnabled ?? false,
```

This is the entire behavioral change. `/api/config` already passes the channel
array through verbatim (`route.ts:95`), so the flags reach the client with no
plumbing.

### 4. Export parity — `src/lib/config-export.ts`

The exporters currently emit **nothing** for uplink/downlink, so manual-setup users
silently get Meshtastic app defaults. The file's own header promises "the values
here are exactly what the flasher pushes", so all three serializers gain the flags:

- `toReadableText` — an `MQTT uplink / downlink: on|off` line per channel.
- `toCliScript` — `--ch-set uplink_enabled <bool> --ch-set downlink_enabled <bool> --ch-index <i>`.
- `toJson` — automatic (straight `JSON.stringify` of the payload).

### 5. Tests — `src/lib/config-export.test.ts`

Extend the fixture with the new flags; add a case asserting idx 0 renders on and
idx 1-4 render off in both the text and CLI serializers.

## Consequences

- Our radios no longer rebroadcast anything from MQTT onto the DEF CON event
  channels. Any ghost/bot content intended for `DEFCONnect` will not land there.
- Our fleet no longer feeds public LongFast RF into `mqtt.defcon.run`. meshtk still
  holds the LongFast key (`apps/run.mqtt/meshtk/meshtk.dc34.yaml`), so it will only
  see LongFast packets that *other* people's uplinking radios put on the broker.
- No server-side dependency: meshtk's fleet config knows only `dc.run` and
  `LongFast`; the three DEF CON event channels are absent, so removing their
  uplink costs nothing currently consumed.

## Verification

Device-config change, no prod-side data dependency. After release + deploy, flash
one radio and confirm in the Meshtastic app under Channels that `dc.run` shows
uplink+downlink on and the other four show both off.
