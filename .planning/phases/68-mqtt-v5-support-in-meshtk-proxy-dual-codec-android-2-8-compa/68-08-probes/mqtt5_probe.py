#!/usr/bin/env python3
"""Production wire probes for the four MQTT v5 parity defects closed in phase 68.

One subcommand per defect, each with a distinguishable observable outcome rather
than a generic "it still connects":

    cr02-idle              a v5 session idle past the reaper window still publishes
    cr03-second-connect    a second CONNECT mid-session is refused, not relayed
    cr04-unmodelled-block  an unmodelled-property PUBLISH is inspected and Blocked
    wr04-subscribe         a v5 SUBSCRIBE is visible to the proxy
    regression-connacks    the four 68-05 CONNACK reason codes are unregressed

Design notes that matter if you change this file:

*   Raw ssl socket, no MQTT client library. A library would normalise away
    exactly the bytes these probes exist to measure, and would refuse to send
    the deliberately illegal frames CR-03 and CR-04 depend on.

*   The frames for CR-03 and CR-04 are the SAME fixtures the upstream unit
    tests use (`attackerConnect` in proxy_v5_parity_test.go and
    `unmodelledPropertyFrame` in proxy_v5_rawpublish_test.go), so the probe and
    the tests exercise identical bytes.

*   Three of the four defects are not distinguishable from the wire alone. A
    relayed second CONNECT and a refused one can both end in a DISCONNECT, and a
    relayed unmodelled-property PUBLISH and a Blocked one can both end in a
    closed socket -- because mosquitto refuses those frames too (measured in
    68-07). What separates "the proxy refused it" from "the broker refused it"
    is the PROXY's own log line. So every subcommand also correlates against
    CloudWatch, keyed on a client id unique to the run. The verdict is the
    conjunction of the wire observation and the log observation.

*   Credentials come from MQTT_USERNAME / MQTT_PASSWORD, are never defaulted,
    never printed and never written to disk. The username is shape-validated
    before use.

Usage:
    export MQTT_USERNAME=<12 hex chars> MQTT_PASSWORD=<...>
    python3 mqtt5_probe.py regression-connacks
    python3 mqtt5_probe.py cr03-second-connect
    python3 mqtt5_probe.py cr04-unmodelled-block
    python3 mqtt5_probe.py wr04-subscribe
    python3 mqtt5_probe.py cr02-idle [--idle-seconds 480]

Each subcommand prints the captured wire bytes as hex, then a single
machine-readable verdict line beginning with "VERDICT " and exits non-zero on
FAIL.
"""

import argparse
import json
import os
import re
import socket
import ssl
import struct
import subprocess
import sys
import time
import uuid

HOST = "mqtt.defcon.run"
PORT = 4433
LOG_GROUP = "/ecs/run-mqtt-meshtk-run-mqtt-use1-dc34"

# The reaper in SetupTracker does NOT evict on a continuous timer: it wakes on a
# 5 * time.Minute ticker and only then applies `now - ConnectTime > 180`. An
# idle window of T seconds therefore contains a qualifying tick for only
# (T - 180) / 300 of possible tick phases -- at T=200 that is under 7%, so an
# UNFIXED image would return ALLOW on ~93% of runs and the probe would "pass"
# while proving nothing. T >= 480 (the 180s threshold plus one full 300s tick
# period) guarantees at least one qualifying tick regardless of phase.
MIN_IDLE_SECONDS = 480

USERNAME_SHAPE = re.compile(r"^[0-9a-f]{12}$")

# MQTT control packet types.
CONNECT, CONNACK, PUBLISH, SUBSCRIBE, SUBACK = 1, 2, 3, 8, 9
PINGREQ, PINGRESP, DISCONNECT = 12, 13, 14

# Fixture identities, matching the upstream tests.
FIXTURE_NODE = 0x435990E4
FIXTURE_GW = "!435990e4"
FIXTURE_CHANNEL = "dc.run"
FIXTURE_TOPIC = "msh/US/2/e/dc.run/!435990e4"

# The second-CONNECT fixture's deliberately bogus identity (proxy_v5_parity_test.go).
ATTACKER_CLIENT_ID = "mqttastic-second-connect"
ATTACKER_USERNAME = "attacker-username"
ATTACKER_PASSWORD = "attacker-plaintext-password"


# ---------------------------------------------------------------- credentials


def credentials():
    """Read and shape-validate the probe credentials. Never printed."""
    user = os.environ.get("MQTT_USERNAME")
    pw = os.environ.get("MQTT_PASSWORD")
    if not user or not pw:
        die("MQTT_USERNAME and MQTT_PASSWORD must be set; this probe has no defaults")
    if not USERNAME_SHAPE.match(user):
        die("MQTT_USERNAME does not match the expected 12-hex-character shape")
    print(f"[creds] username shape ok (12 hex); password length {len(pw)}")
    return user, pw


def die(msg):
    print(f"VERDICT FAIL {msg}")
    sys.exit(2)


# ------------------------------------------------------------- MQTT encoding


def varint(n):
    out = bytearray()
    while True:
        b = n % 128
        n //= 128
        if n:
            b |= 0x80
        out.append(b)
        if not n:
            return bytes(out)


def utf8(s):
    b = s.encode()
    return struct.pack(">H", len(b)) + b


def binfield(b):
    return struct.pack(">H", len(b)) + b


def frame(pkt_type, flags, body):
    return bytes([(pkt_type << 4) | flags]) + varint(len(body)) + body


def prop_u32(pid, v):
    return bytes([pid]) + struct.pack(">I", v)


def prop_u16(pid, v):
    return bytes([pid]) + struct.pack(">H", v)


def prop_str(pid, s):
    return bytes([pid]) + utf8(s)


def prop_user(k, v):
    return bytes([0x26]) + utf8(k) + utf8(v)


def connect_frame(
    client_id,
    username,
    password,
    protocol_version=5,
    keepalive=60,
    mqttastic_props=True,
    auth_method=None,
):
    """A CONNECT in the mqttastic shape -- the properties a Meshtastic-Android
    2.8 client actually sends, so the proxy sees the frame it will see in
    production rather than a minimal synthetic one."""
    body = utf8("MQTT") + bytes([protocol_version])
    flags = 0x02  # clean start
    if username is not None:
        flags |= 0x80
    if password is not None:
        flags |= 0x40
    body += bytes([flags]) + struct.pack(">H", keepalive)

    if protocol_version >= 5:
        props = b""
        if mqttastic_props:
            props += prop_u32(0x11, 10000)  # SessionExpiryInterval
            props += prop_u16(0x21, 20)  # ReceiveMaximum
            props += prop_u16(0x22, 10)  # TopicAliasMaximum
            props += prop_u32(0x27, 1048576)  # MaximumPacketSize
            props += prop_user("client", "mqttastic")
        if auth_method is not None:
            props += prop_str(0x15, auth_method)  # AuthenticationMethod
        body += varint(len(props)) + props

    body += utf8(client_id)
    if username is not None:
        body += utf8(username)
    if password is not None:
        body += binfield(password.encode())
    return frame(CONNECT, 0, body)


def publish_frame(topic, payload, qos=0, packet_id=None, unmodelled_property=False):
    """A v5 PUBLISH. With unmodelled_property=True the property block is
    `02 7f 00` -- property id 0x7f, outside paho.golang's table -- which is the
    exact CR-04 fixture from proxy_v5_rawpublish_test.go."""
    body = utf8(topic)
    flags = qos << 1
    if qos:
        body += struct.pack(">H", packet_id)
    if unmodelled_property:
        body += bytes([0x02, 0x7F, 0x00])
    else:
        body += b"\x00"
    body += payload
    return frame(PUBLISH, flags, body)


def subscribe_frame(packet_id, filters):
    body = struct.pack(">H", packet_id) + b"\x00"
    for f, qos in filters:
        body += utf8(f) + bytes([qos])
    return frame(SUBSCRIBE, 0x02, body)


PINGREQ_FRAME = bytes([0xC0, 0x00])


# ------------------------------------------------------- meshtastic protobuf


def pb_tag(field, wire):
    return varint((field << 3) | wire)


def pb_bytes(field, b):
    return pb_tag(field, 2) + varint(len(b)) + b


def pb_varint(field, v):
    return pb_tag(field, 0) + varint(v)


def pb_fixed32(field, v):
    return pb_tag(field, 5) + struct.pack("<I", v)


def nodeinfo_envelope(hop_limit=3, hop_start=3):
    """A decoded NODEINFO ServiceEnvelope with in-budget hops -- the same shape
    the upstream idle-survival test publishes, so no rewrite rule fires and an
    ALLOW is the expected outcome. Data.bitfield is present: 2.8 firmware drops
    decoded packets that lack it."""
    user = (
        pb_bytes(1, FIXTURE_GW.encode())
        + pb_bytes(2, b"DC34 test")
        + pb_bytes(3, b"T34")
    )
    data = pb_varint(1, 4) + pb_bytes(2, user) + pb_varint(9, 1)  # NODEINFO_APP
    packet = (
        pb_fixed32(1, FIXTURE_NODE)
        + pb_fixed32(2, 0xFFFFFFFF)
        + pb_bytes(4, data)
        + pb_fixed32(6, 0x1234ABCD)
        + pb_varint(9, hop_limit)
        + pb_varint(15, hop_start)
    )
    return (
        pb_bytes(1, packet)
        + pb_bytes(2, FIXTURE_CHANNEL.encode())
        + pb_bytes(3, FIXTURE_GW.encode())
    )


def undecryptable_envelope():
    """A ServiceEnvelope whose MeshPacket carries an ENCRYPTED payload that
    cannot decrypt under any configured channel key, so BlockInvalidEncryption
    fires. A Block is the crisp, side-effect-free signal for CR-04: nothing
    reaches the broker and nothing is injected into the live mesh."""
    ciphertext = bytes(
        (0xA5 ^ (i * 31 + 7)) & 0xFF for i in range(48)
    )  # deterministic, decrypts to garbage under every key
    packet = (
        pb_fixed32(1, FIXTURE_NODE)
        + pb_fixed32(2, 0xFFFFFFFF)
        + pb_bytes(5, ciphertext)
        + pb_fixed32(6, 0x0BADF00D)
        + pb_varint(9, 3)
        + pb_varint(15, 3)
    )
    return (
        pb_bytes(1, packet)
        + pb_bytes(2, FIXTURE_CHANNEL.encode())
        + pb_bytes(3, FIXTURE_GW.encode())
    )


# ------------------------------------------------------------------- the wire


class Wire:
    def __init__(self, timeout=20):
        ctx = ssl.create_default_context()
        raw = socket.create_connection((HOST, PORT), timeout=timeout)
        self.sock = ctx.wrap_socket(raw, server_hostname=HOST)
        self.sock.settimeout(timeout)
        self.buf = b""
        self.closed = False

    def send(self, data, label=""):
        print(f"  -> {label or 'frame'} ({len(data)}B) {data[:64].hex()}"
              f"{'...' if len(data) > 64 else ''}")
        self.sock.sendall(data)

    def _fill(self, n):
        while len(self.buf) < n:
            try:
                chunk = self.sock.recv(65536)
            except (socket.timeout, ssl.SSLError, OSError):
                raise TimeoutError("read timed out")
            if not chunk:
                self.closed = True
                raise ConnectionError("peer closed")
            self.buf += chunk

    def read_frame(self, timeout=None):
        """Read one complete MQTT frame using only the version-independent
        fixed header -- the same thing the proxy's own readFrame does."""
        if timeout is not None:
            self.sock.settimeout(timeout)
        self._fill(1)
        first = self.buf[0]
        mult, rem, i = 1, 0, 1
        while True:
            self._fill(i + 1)
            b = self.buf[i]
            rem += (b & 0x7F) * mult
            i += 1
            if not b & 0x80:
                break
            mult *= 128
        self._fill(i + rem)
        f = self.buf[: i + rem]
        self.buf = self.buf[i + rem :]
        print(f"  <- type={first >> 4} ({len(f)}B) {f[:64].hex()}"
              f"{'...' if len(f) > 64 else ''}")
        return f

    def expect_closed(self, timeout=15):
        """Returns (closed, trailing_frames)."""
        frames = []
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                frames.append(self.read_frame(timeout=max(1, deadline - time.time())))
            except ConnectionError:
                return True, frames
            except TimeoutError:
                return False, frames
        return False, frames

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass


def connack_probe(**kw):
    """Open a connection, send one CONNECT, capture the CONNACK, close."""
    w = Wire()
    try:
        w.send(connect_frame(**kw), "CONNECT")
        return w.read_frame()
    finally:
        w.close()


def establish(client_id, username, password, keepalive=60):
    """Open an authenticated v5 session and assert the CONNACK is a success."""
    w = Wire()
    w.send(connect_frame(client_id, username, password, keepalive=keepalive), "CONNECT")
    ca = w.read_frame()
    if ca[0] >> 4 != CONNACK:
        w.close()
        die(f"first response was type {ca[0] >> 4}, not CONNACK")
    if len(ca) < 4 or ca[3] != 0x00:
        w.close()
        die(f"CONNACK reason {ca.hex()} is not success -- check the credentials")
    print(f"  [session] established, CONNACK {ca.hex()}")
    return w


# ------------------------------------------------------------ CloudWatch logs


def fetch_logs(pattern, start_ms, stream=None, wait=150, want=1):
    """Poll CloudWatch until `want` matching events appear or `wait` elapses.

    Correlation is by a client id unique to this run, so a match cannot be
    attributed to another task, another probe or a real client -- which is what
    makes it safe to run this during a rolling replace, when two images write to
    the same log group.
    """
    deadline = time.time() + wait
    events = []
    while time.time() < deadline:
        cmd = [
            "aws", "logs", "filter-log-events",
            "--log-group-name", LOG_GROUP,
            "--start-time", str(start_ms),
            "--filter-pattern", f'"{pattern}"',
            "--output", "json",
        ]
        if stream:
            cmd += ["--log-stream-names", stream]
        try:
            out = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
        except subprocess.TimeoutExpired:
            time.sleep(5)
            continue
        if out.returncode != 0:
            print(f"  [logs] query failed: {out.stderr.strip()[:200]}")
            time.sleep(5)
            continue
        events = json.loads(out.stdout or "{}").get("events", [])
        if len(events) >= want:
            break
        time.sleep(8)
    for e in events:
        print(f"  [log:{e['logStreamName']}] {e['message'].strip()[:300]}")
    return events


def grep(events, needle):
    return [e for e in events if needle in e["message"]]


def socket_addr_of(events, client_id):
    """Recover the proxy-side socket address for our session from its own
    MQTT5_CONNECT line, so log actions that key on `ip=` (protocol violation,
    header fail) can be correlated to this run and no other."""
    for e in events:
        if "action=MQTT5_CONNECT" in e["message"] and f"client_id={client_id}" in e["message"]:
            m = re.search(r"ip=([^,\s]+)", e["message"])
            if m:
                return m.group(1)
    return None


def verdict(ok, msg):
    print(f"VERDICT {'PASS' if ok else 'FAIL'} {msg}")
    sys.exit(0 if ok else 1)


def run_id(tag):
    return f"dc34p-{tag}-{uuid.uuid4().hex[:8]}"


def now_ms():
    return int(time.time() * 1000) - 5000


# ------------------------------------------------------------------- probes


def probe_regression_connacks(args):
    """The four 68-05 CONNACK captures. No valid credential is used and none is
    needed: every case is a rejection path, so a regression shows up as a
    changed reason byte and nothing reaches the broker."""
    expected = [
        ("v5 bad credentials", "2003008700",
         dict(client_id=run_id("reg1"), username="not-a-real-user",
              password="not-a-real-password", protocol_version=5)),
        ("protocol level 6", "2003008400",
         dict(client_id=run_id("reg2"), username="not-a-real-user",
              password="not-a-real-password", protocol_version=6)),
        ("v5 enhanced auth", "2003008c00",
         dict(client_id=run_id("reg3"), username="not-a-real-user",
              password="not-a-real-password", protocol_version=5,
              auth_method="SCRAM-SHA-1")),
        ("3.1.1 bad credentials", "20020005",
         dict(client_id=run_id("reg4"), username="not-a-real-user",
              password="not-a-real-password", protocol_version=4,
              mqttastic_props=False)),
    ]
    failures = []
    for name, want, kw in expected:
        print(f"\n[{name}] expect {want}")
        try:
            got = connack_probe(**kw).hex()
        except (ConnectionError, TimeoutError, OSError) as e:
            got = f"<no CONNACK: {e}>"
        print(f"  captured: {got}")
        if got != want:
            failures.append(f"{name}: got {got}, want {want}")
    if failures:
        verdict(False, "reason-code regression -- " + "; ".join(failures))
    verdict(True, "all four CONNACK captures byte-identical to the 68-05 record")


def probe_cr03(args):
    """CR-03: a second CONNECT on an established session must be REFUSED by the
    proxy, not relayed to the broker.

    The wire alone cannot settle this. A relayed second CONNECT makes mosquitto
    answer with its own protocol-error DISCONNECT, which the downlink relays --
    so the client can see the same reason byte either way. The discriminator is
    the proxy's own action=MQTT5_PROTOCOL_VIOLATION line.
    """
    user, pw = credentials()
    cid = run_id("cr03")
    t0 = now_ms()
    print(f"\n[cr03] client_id={cid}")

    w = establish(cid, user, pw)
    attacker = connect_frame(ATTACKER_CLIENT_ID, ATTACKER_USERNAME, ATTACKER_PASSWORD)
    w.send(attacker, "second CONNECT (bogus creds)")
    closed, frames = w.expect_closed(timeout=20)
    w.close()

    disc = [f for f in frames if f[0] >> 4 == DISCONNECT]
    reason = disc[0][2] if disc and len(disc[0]) >= 3 else None
    print(f"  wire: closed={closed} disconnect_frames={len(disc)} "
          f"reason={'None' if reason is None else hex(reason)}")

    print("  [logs] correlating...")
    events = fetch_logs(cid, t0, stream=args.log_stream)
    addr = socket_addr_of(events, cid)
    viol = []
    if addr:
        print(f"  [logs] session socket addr recovered: {addr}")
        viol = grep(fetch_logs(addr, t0, stream=args.log_stream, wait=60),
                    "action=MQTT5_PROTOCOL_VIOLATION")

    ok_wire = reason == 0x82
    ok_log = len(viol) == 1
    if not ok_wire:
        verdict(False, f"no DISCONNECT 0x82 from the proxy (reason={reason})")
    if not ok_log:
        verdict(False, f"MQTT5_PROTOCOL_VIOLATION lines for this session = {len(viol)}, want 1 "
                       "-- the frame was relayed, not refused")
    verdict(True, "second CONNECT refused with DISCONNECT 0x82 and exactly one "
                  "MQTT5_PROTOCOL_VIOLATION logged")


def probe_cr04(args):
    """CR-04: a PUBLISH carrying a property the codec does not model must still
    be inspected and judged.

    The frame wraps an UNDECRYPTABLE envelope, so the expected outcome is a
    Block: nothing reaches the broker and nothing is injected into the live
    mesh. Before the fix the identical bytes were relayed with only a
    MQTT5_PARSE_FAIL line and no decision at all, so the presence of a BLOCK
    correlated to this session is the whole contrast.
    """
    user, pw = credentials()
    cid = run_id("cr04")
    t0 = now_ms()
    print(f"\n[cr04] client_id={cid}")

    w = establish(cid, user, pw)
    frame_bytes = publish_frame(FIXTURE_TOPIC, undecryptable_envelope(),
                                unmodelled_property=True)
    w.send(frame_bytes, "PUBLISH with unmodelled property 0x7f + undecryptable envelope")
    closed, frames = w.expect_closed(timeout=20)
    w.close()
    print(f"  wire: closed={closed} trailing_frames={len(frames)}")

    print("  [logs] correlating...")
    events = fetch_logs(cid, t0, stream=args.log_stream)
    parse_fail_addr = socket_addr_of(events, cid)
    blocks = grep(events, "action=BLOCK")
    proxy_blocks = []
    if parse_fail_addr:
        proxy_blocks = grep(
            fetch_logs(parse_fail_addr, t0, stream=args.log_stream, wait=60),
            "[proxy] BLOCK")

    if not blocks:
        verdict(False, "no action=BLOCK decision for the unmodelled-property PUBLISH "
                       "-- the frame bypassed inspection (CR-04 open)")
    if not proxy_blocks:
        verdict(False, "action=BLOCK present but no [proxy] BLOCK line -- "
                       "inspection ran but the drop was not logged")
    verdict(True, f"unmodelled-property PUBLISH inspected and Blocked "
                  f"({len(blocks)} action=BLOCK, {len(proxy_blocks)} [proxy] BLOCK)")


def probe_wr04(args):
    """WR-04: a v5 SUBSCRIBE must be visible to the proxy with its filters.

    A SUBACK comes back either way -- before the fix the frame was relayed
    unjudged and unlogged -- so the discriminator is a decision log line
    carrying mqtt_type=SUBSCRIBE and this run's own topic filter.
    """
    user, pw = credentials()
    cid = run_id("wr04")
    t0 = now_ms()
    filt = f"msh/US/2/e/dc.run/probe-{cid}/#"
    print(f"\n[wr04] client_id={cid} filter={filt}")

    w = establish(cid, user, pw)
    w.send(subscribe_frame(0x0015, [(filt, 0)]), "SUBSCRIBE")
    suback = None
    try:
        for _ in range(4):
            f = w.read_frame(timeout=15)
            if f[0] >> 4 == SUBACK:
                suback = f
                break
    except (ConnectionError, TimeoutError):
        pass
    w.close()
    print(f"  wire: suback={suback.hex() if suback else None}")

    print("  [logs] correlating...")
    events = fetch_logs(cid, t0, stream=args.log_stream)
    subs = grep(events, "mqtt_type=SUBSCRIBE")
    with_filter = grep(subs, filt)

    if suback is None:
        verdict(False, "no SUBACK -- the subscribe never completed")
    if not subs:
        verdict(False, "no proxy log line with mqtt_type=SUBSCRIBE -- the v5 SUBSCRIBE "
                       "was relayed unjudged and invisible (WR-04 open)")
    if not with_filter:
        verdict(False, "a SUBSCRIBE was logged but without its topic filter")
    verdict(True, "v5 SUBSCRIBE reached the proxy's decision log with its topic filter")


def probe_cr02(args):
    """CR-02: a v5 session held publish-idle past the reaper window must still
    be able to publish.

    Before the fix the tracker entry was purged and the next PUBLISH was Blocked
    with "Username required for MQTT" and the socket torn down, so the wire
    signal here is real: after the publish we ping, and a PINGRESP proves the
    session is alive. See MIN_IDLE_SECONDS for why the window cannot be
    shortened.
    """
    if args.idle_seconds < MIN_IDLE_SECONDS:
        die(f"--idle-seconds {args.idle_seconds} is below the {MIN_IDLE_SECONDS}s floor. "
            "The reaper only evaluates its 180s threshold on a 5-minute tick, so a "
            "shorter window would return ALLOW on an UNFIXED image for most tick "
            "phases and the probe would pass while proving nothing.")

    user, pw = credentials()
    cid = run_id("cr02")
    t0 = now_ms()
    print(f"\n[cr02] client_id={cid} idle_target={args.idle_seconds}s")

    w = establish(cid, user, pw, keepalive=60)
    started = time.time()
    while time.time() - started < args.idle_seconds:
        remaining = args.idle_seconds - (time.time() - started)
        time.sleep(min(30, max(1, remaining)))
        w.send(PINGREQ_FRAME, "PINGREQ")
        try:
            resp = w.read_frame(timeout=20)
        except (ConnectionError, TimeoutError) as e:
            w.close()
            verdict(False, f"socket died after {int(time.time() - started)}s idle: {e}")
        if resp[0] >> 4 != PINGRESP:
            print(f"  [note] unexpected frame during idle: type {resp[0] >> 4}")
        print(f"  [idle] {int(time.time() - started)}s elapsed")

    measured = int(time.time() - started)
    print(f"  [idle] measured publish-idle duration: {measured}s")

    w.send(publish_frame(FIXTURE_TOPIC, nodeinfo_envelope()), "PUBLISH NODEINFO")
    w.send(PINGREQ_FRAME, "PINGREQ (liveness check after the publish)")
    alive = False
    try:
        for _ in range(4):
            f = w.read_frame(timeout=20)
            if f[0] >> 4 == PINGRESP:
                alive = True
                break
    except (ConnectionError, TimeoutError) as e:
        print(f"  wire: session died after the post-idle publish: {e}")
    w.close()
    print(f"  wire: session alive after post-idle publish = {alive}")

    print("  [logs] correlating...")
    events = fetch_logs(cid, t0, stream=args.log_stream)
    allows = [e for e in events
              if "action=ALLOW" in e["message"] and "mqtt_type=PUBLISH" in e["message"]]
    addr = socket_addr_of(events, cid)
    user_blocks = []
    if addr:
        user_blocks = grep(
            fetch_logs(addr, t0, stream=args.log_stream, wait=45),
            "Username required for MQTT")

    if user_blocks:
        verdict(False, f"the post-idle publish was Blocked with the username-required "
                       f"reason after {measured}s idle ({len(user_blocks)} lines) -- CR-02 open")
    if not alive:
        verdict(False, f"the session did not survive the post-idle publish "
                       f"(idle {measured}s)")
    if not allows:
        verdict(False, f"no action=ALLOW for a PUBLISH after {measured}s idle")
    verdict(True, f"publish after {measured}s idle was ALLOWed, no username-required "
                  f"Block, session still alive")


PROBES = {
    "regression-connacks": probe_regression_connacks,
    "cr02-idle": probe_cr02,
    "cr03-second-connect": probe_cr03,
    "cr04-unmodelled-block": probe_cr04,
    "wr04-subscribe": probe_wr04,
}


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("probe", choices=sorted(PROBES))
    p.add_argument("--idle-seconds", type=int, default=MIN_IDLE_SECONDS,
                   help=f"cr02-idle only; hard floor {MIN_IDLE_SECONDS}s")
    p.add_argument("--log-stream", default=None,
                   help="scope CloudWatch queries to one task's log stream")
    args = p.parse_args()
    print(f"=== {args.probe} against {HOST}:{PORT} at "
          f"{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} ===")
    PROBES[args.probe](args)


if __name__ == "__main__":
    main()
