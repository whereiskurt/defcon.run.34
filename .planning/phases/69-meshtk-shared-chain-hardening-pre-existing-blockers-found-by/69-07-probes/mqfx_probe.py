#!/usr/bin/env python3
"""Production wire probes for the shared-chain hardening defects closed in phase 69.

Derived from the committed `68-08-probes/mqtt5_probe.py`, whose subcommands are kept
working verbatim -- `regression-connacks` in particular is a regression gate for THIS
deploy too, since the four CONNACK reason codes and the four-byte 3.1.1 CONNACK must be
unmoved by a phase that edited the v5 CONNECT failure branches.

    ##  HARD SAFETY RULE  ##################################################
    No subcommand in this file may publish a DECODED (unencrypted) text-message
    envelope. On the pre-fix image that single frame reaches
    RewriteHelloGoodbye -> RewritePayloadString with a nil channel cipher and
    dereferences it: a SIGSEGV in the proxy read loop with no recover() above
    it, which kills the whole PROCESS and drops every connected radio on the
    fleet -- not one connection. MQFX-01 is therefore NEVER probed against
    production. Its production evidence is NEGATIVE (zero `panic`, zero
    `SIGSEGV`, exactly one `Proxy server started` line across the deploy) and
    its POSITIVE proof is 69-01's `TestRewritePayloadStringNilCipherReturnsError`
    plus 69-02's `TestPanicIn*` containment suite.
    #######################################################################

Subcommands, the defect each observes, and what distinguishes PRE from POST:

    regression-connacks     (regression gate, not a defect)
        PRE  PASS -- the four 68-05 captures.
        POST PASS -- byte-identical. A changed byte is a regression, not progress.

    mqfx03-will             MQFX-03, the Last-Will bypass (68-REVIEW CR-02)
        PRE  the Will is forwarded inside the CONNECT, mosquitto fires it on the
             abrupt disconnect, the subscriber receives it, and the proxy logged
             NOTHING about a Will (`grep -n Will` returned nothing in either
             codec before 69-03).
        POST every Will field is cleared before the CONNECT reaches mosquitto:
             the subscriber receives nothing and the proxy logs
             `action=WILL_STRIPPED` carrying this run's unique will topic.

    mqfx04c-connect-connack MQFX-04 / 68-REVIEW WR-02, the silent CONNECT close
        PRE  an unparseable v5 CONNECT is dropped with ZERO bytes back -- the
             silent close that made mqttastic hot-retry.
        POST five bytes back, `2003008100`: DISCONNECT reason 0x81
             (Malformed Packet), with `answered=0x81` on the proxy's own
             MQTT5_PARSE_FAIL line.

    mqfx04d-loginjection    MQFX-04 / 68-REVIEW WR-05, forgeable telemetry
        PRE  one CONNECT produces TWO log records; the second is a fabricated
             `action=AUTH_REJECT` line the client wrote itself.
        POST one CONNECT produces ONE record; the control runes are dropped and
             the whole value comes back strconv.Quote'd, which is 69-03's
             conditional-quoting tamper signal.

    mqfx04a-alias-handparse MQFX-04 / 68-REVIEW WR-01, hand-parse alias blindness
        PRE  a PUBLISH whose property block carries a Topic Alias ahead of an
             unmodelled id is ALLOWED on the hand-parsed path while the codec
             path Blocks the identical intent.
        POST `action=BLOCK, ip=..., reason=topic_alias_uplink` -- the codec
             path's own reason string, reached from the hand-parsed path.

    mqfx04b-subscribe-handparse  MQFX-04 / 68-REVIEW WR-04, uninspected SUBSCRIBE
        PRE  a SUBSCRIBE the codec cannot read is relayed with only an
             `action=MQTT5_PARSE_FAIL` line and no decision at all -- it never
             becomes an InspectorPacket, so no topic rule can ever apply to it.
        POST the parse-fail line is followed by a real decision line carrying
             `mqtt_type=SUBSCRIBE` and this run's unique topic filter.

    mqfx02-data-fields      MQFX-02, the Data field loss (68-REVIEW CR-03)
        PRE  `reply_id`, `emoji` and `want_response` are ZERO on the wire the
             mesh receives -- the rewrite rebuilt Data from three fields.
        POST all three survive the rewrite (in-place mutation).
        Needs the channel key in MESHTK_CHANNEL_KEY. Without it the subcommand
        exits with a distinct SKIP verdict (never a PASS), and 69-01's
        `TestRewritePayloadStringPreservesDataFields` /
        `TestDataFieldsSurviveRewriteOnV5Uplink` stand as the positive proof.

Design notes carried over from 68-08 and re-stated because they still bind:

*   Raw ssl socket, no MQTT client library. A library normalises away exactly the
    bytes these probes exist to measure and refuses to send the deliberately
    illegal frames MQFX-04 depends on.

*   Every verdict is the CONJUNCTION of a wire observation and a log observation.
    Three of Phase 68's four defects were not wire-distinguishable because
    mosquitto refuses the same frames the proxy now refuses; the same caution
    applies here. What separates "the proxy refused it" from "the broker refused
    it" is the PROXY's own log line.

*   Correlation is keyed on an identifier unique to the run -- a client id, or
    for the Will probe a unique will topic, since `action=WILL_STRIPPED` carries
    no client id. Never a wall clock: during an ECS rolling replace BOTH images
    write to the SAME log group, so scope every count with --log-stream.

*   Every CloudWatch wait takes the SPECIFIC substring the caller needs. Waiting
    on any client-id match returns early on the CONNECT line and then reports a
    later decision line as missing (68-08 deviation 1, a real spurious FAIL).

*   Credentials come from MQTT_USERNAME / MQTT_PASSWORD and the channel key from
    MESHTK_CHANNEL_KEY. None is defaulted, none is printed, none is written to
    disk.

Usage:
    export MQTT_USERNAME=<12 hex chars> MQTT_PASSWORD=<...>
    export MESHTK_CHANNEL_KEY=<base64 primary channel key>   # mqfx02 only
    python3 mqfx_probe.py regression-connacks
    python3 mqfx_probe.py mqfx03-will --log-stream <stream>
    ...

Each subcommand prints the captured wire bytes as hex, then a single
machine-readable line beginning with "VERDICT " and exits 0 on PASS, 1 on FAIL,
2 on a usage/precondition error and 3 on SKIP.
"""

import argparse
import base64
import binascii
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
CON_TREE = "msh/US/2/e/dc.run"

# A node id no real radio owns, used by every phase-69 probe that has to put a
# ServiceEnvelope on the wire. Keeping it distinct from FIXTURE_NODE means a
# phase-69 packet is attributable at a glance in the mesh feed.
PROBE_NODE = 0x69070001
PROBE_GW = "!69070001"

# The second-CONNECT fixture's deliberately bogus identity (proxy_v5_parity_test.go).
ATTACKER_CLIENT_ID = "mqttastic-second-connect"
ATTACKER_USERNAME = "attacker-username"
ATTACKER_PASSWORD = "attacker-plaintext-password"

# The property id no MQTT 5.0 table defines -- the CR-04 / WR-01 / WR-04 fixture
# byte, identical to the one the upstream unit tests use.
UNMODELLED_PROP_ID = 0x7F


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


def channel_key_or_skip():
    """Read the primary channel key. NO default, never printed.

    A missing key is a SKIP, never a PASS: without it the fanned-out packet
    cannot be decrypted and the field-preservation contrast cannot be taken at
    all. Rounding that up to a pass is exactly the repudiation this plan's
    threat register calls T-69-07-09.
    """
    raw = os.environ.get("MESHTK_CHANNEL_KEY")
    if not raw:
        skip("MESHTK_CHANNEL_KEY is not set, so the fanned-out packet cannot be "
             "decrypted and the field contrast cannot be measured. Positive proof "
             "for MQFX-02 is 69-01's TestRewritePayloadStringPreservesDataFields "
             "and TestDataFieldsSurviveRewriteOnV5Uplink, which assert all six "
             "fields after a decrypt round trip on BOTH codecs.")
    try:
        key = base64.b64decode(raw)
    except (binascii.Error, ValueError):
        die("MESHTK_CHANNEL_KEY is not valid base64")
    if len(key) not in (16, 32):
        die(f"MESHTK_CHANNEL_KEY decodes to {len(key)} bytes; want 16 or 32")
    print(f"[key] channel key shape ok ({len(key) * 8}-bit)")
    return key


def die(msg):
    print(f"VERDICT FAIL {msg}")
    sys.exit(2)


def skip(msg):
    print(f"VERDICT SKIP {msg}")
    sys.exit(3)


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
    extra_props=b"",
    will=None,
):
    """A CONNECT in the mqttastic shape -- the properties a Meshtastic-Android
    2.8 client actually sends, so the proxy sees the frame it will see in
    production rather than a minimal synthetic one.

    `extra_props` is appended raw to the property block, which is how the
    unmodelled-id CONNECT fixture (0x7f) is built.

    `will` is (topic, payload). The Will payload MUST NOT be a decoded
    text-message envelope -- see the module docstring's hard safety rule.
    """
    body = utf8("MQTT") + bytes([protocol_version])
    flags = 0x02  # clean start
    if will is not None:
        flags |= 0x04  # will flag, QoS 0, no retain
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
        props += extra_props
        body += varint(len(props)) + props

    body += utf8(client_id)
    if will is not None:
        will_topic, will_payload = will
        if protocol_version >= 5:
            body += varint(0)  # empty Will Properties
        body += utf8(will_topic) + binfield(will_payload)
    if username is not None:
        body += utf8(username)
    if password is not None:
        body += binfield(password.encode())
    return frame(CONNECT, 0, body)


def publish_frame(topic, payload, qos=0, packet_id=None,
                  unmodelled_property=False, props_raw=None):
    """A v5 PUBLISH.

    With unmodelled_property=True the property block is `02 7f 00` -- property
    id 0x7f, outside paho.golang's table -- which is the exact CR-04 fixture
    from proxy_v5_rawpublish_test.go.

    `props_raw` supplies the property block bytes directly (without its length
    varint), which is how the alias-before-unknown ordering is built.
    """
    body = utf8(topic)
    flags = qos << 1
    if qos:
        body += struct.pack(">H", packet_id)
    if props_raw is not None:
        body += varint(len(props_raw)) + props_raw
    elif unmodelled_property:
        body += bytes([0x02, UNMODELLED_PROP_ID, 0x00])
    else:
        body += b"\x00"
    body += payload
    return frame(PUBLISH, flags, body)


def subscribe_frame(packet_id, filters, props_raw=None):
    body = struct.pack(">H", packet_id)
    if props_raw is not None:
        body += varint(len(props_raw)) + props_raw
    else:
        body += b"\x00"
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


def pb_parse(buf):
    """Minimal protobuf wire parser -> {field_number: [value, ...]}.

    Values are int for varint, int for fixed32 (little-endian), bytes for
    length-delimited. Enough to re-read a ServiceEnvelope / MeshPacket / Data
    that the proxy just put on the wire, without vendoring generated code into
    a probe.
    """
    out = {}
    i = 0
    n = len(buf)
    while i < n:
        key, i = _pb_varint_at(buf, i)
        field, wire = key >> 3, key & 7
        if wire == 0:
            v, i = _pb_varint_at(buf, i)
        elif wire == 2:
            ln, i = _pb_varint_at(buf, i)
            v = buf[i:i + ln]
            i += ln
        elif wire == 5:
            v = struct.unpack("<I", buf[i:i + 4])[0]
            i += 4
        elif wire == 1:
            v = struct.unpack("<Q", buf[i:i + 8])[0]
            i += 8
        else:
            raise ValueError(f"unsupported wire type {wire} at offset {i}")
        out.setdefault(field, []).append(v)
    return out


def _pb_varint_at(buf, i):
    shift, val = 0, 0
    while True:
        b = buf[i]
        i += 1
        val |= (b & 0x7F) << shift
        if not b & 0x80:
            return val, i
        shift += 7


def nodeinfo_data(long_name=b"DC34 probe", short_name=b"P69"):
    user = (
        pb_bytes(1, PROBE_GW.encode())
        + pb_bytes(2, long_name)
        + pb_bytes(3, short_name)
    )
    # portnum 4 = NODEINFO_APP; bitfield present (2.8 firmware drops decoded
    # packets that lack it).
    return pb_varint(1, 4) + pb_bytes(2, user) + pb_varint(9, 1)


def envelope(packet_body, channel=FIXTURE_CHANNEL, gateway=PROBE_GW):
    return (
        pb_bytes(1, packet_body)
        + pb_bytes(2, channel.encode())
        + pb_bytes(3, gateway.encode())
    )


def nodeinfo_envelope(hop_limit=3, hop_start=3, node=FIXTURE_NODE,
                      gateway=FIXTURE_GW, packet_id=0x1234ABCD):
    """A decoded NODEINFO ServiceEnvelope with in-budget hops -- the same shape
    the upstream idle-survival test publishes, so no rewrite rule fires and an
    ALLOW is the expected outcome.

    NODEINFO is deliberate: a decoded NODEINFO is inert on the pre-fix image,
    where a decoded TEXT_MESSAGE would be a remote whole-process kill.
    """
    user = (
        pb_bytes(1, gateway.encode())
        + pb_bytes(2, b"DC34 test")
        + pb_bytes(3, b"T34")
    )
    data = pb_varint(1, 4) + pb_bytes(2, user) + pb_varint(9, 1)  # NODEINFO_APP
    packet = (
        pb_fixed32(1, node)
        + pb_fixed32(2, 0xFFFFFFFF)
        + pb_bytes(4, data)
        + pb_fixed32(6, packet_id)
        + pb_varint(9, hop_limit)
        + pb_varint(15, hop_start)
    )
    return (
        pb_bytes(1, packet)
        + pb_bytes(2, FIXTURE_CHANNEL.encode())
        + pb_bytes(3, gateway.encode())
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


# ------------------------------------------------- meshtastic channel crypto


def meshtastic_ctr(key, packet_id, from_node, payload):
    """AES-CTR with the meshtastic nonce, mirroring ServerCmd.DecryptMeshtastic:
    a 16-byte nonce holding the packet id as a little-endian uint32 at offset 0
    and the sending node as a little-endian uint32 at offset 8, rest zero.
    Symmetric -- the same call encrypts and decrypts.
    """
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

    nonce = bytearray(16)
    struct.pack_into("<I", nonce, 0, packet_id)
    struct.pack_into("<I", nonce, 8, from_node)
    c = Cipher(algorithms.AES(key), modes.CTR(bytes(nonce))).encryptor()
    return c.update(payload) + c.finalize()


def text_message_data(text, want_response, dest, source, request_id, reply_id, emoji):
    """A meshtastic.Data carrying TEXT_MESSAGE_APP and every field CR-03 dropped.

    Field numbers per the meshtastic Data message: 1 portnum, 2 payload,
    3 want_response, 4 dest, 5 source, 6 request_id, 7 reply_id, 8 emoji,
    9 bitfield.
    """
    out = pb_varint(1, 1)  # TEXT_MESSAGE_APP
    out += pb_bytes(2, text.encode())
    if want_response:
        out += pb_varint(3, 1)
    out += pb_fixed32(4, dest)
    out += pb_fixed32(5, source)
    out += pb_fixed32(6, request_id)
    out += pb_fixed32(7, reply_id)
    out += pb_fixed32(8, emoji)
    out += pb_varint(9, 1)  # bitfield
    return out


def encrypted_text_envelope(key, packet_id, node, data_bytes, hop_limit=0, hop_start=0):
    """A ServiceEnvelope whose MeshPacket carries an ENCRYPTED TEXT_MESSAGE_APP.

    ENCRYPTED is the whole point and is not negotiable: the decoded form of this
    same packet is the MQFX-01 remote process kill. Encrypted, the proxy decrypts
    it, assigns Meshtastic.Cipher on the decrypt branch, and the censor has
    something to re-encrypt with -- which is the ONLY path on which the CR-03
    field rebuild is observable.

    hop_limit defaults to 0 so the packet is not rebroadcast over RF by any
    radio that receives it.
    """
    ciphertext = meshtastic_ctr(key, packet_id, node, data_bytes)
    packet = (
        pb_fixed32(1, node)
        + pb_fixed32(2, 0xFFFFFFFF)
        + pb_bytes(5, ciphertext)
        + pb_fixed32(6, packet_id)
        + pb_varint(9, hop_limit)
        + pb_varint(15, hop_start)
    )
    return envelope(packet)


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

    def drain(self, seconds, want_type=None, want_bytes=None):
        """Collect frames for `seconds`, returning every frame seen. Used where
        the interesting event is a downlink PUBLISH that may or may not arrive."""
        frames = []
        deadline = time.time() + seconds
        while time.time() < deadline:
            try:
                f = self.read_frame(timeout=max(1, deadline - time.time()))
            except (ConnectionError, TimeoutError):
                break
            frames.append(f)
            if want_type is not None and f[0] >> 4 == want_type:
                if want_bytes is None or want_bytes in f:
                    break
        return frames

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

    def abort(self):
        """Kill the connection ABRUPTLY -- SO_LINGER 0 makes close() emit a TCP
        RST rather than a FIN, so no MQTT DISCONNECT is sent and the broker
        treats the session as having failed. That is the only condition under
        which a Last Will fires."""
        try:
            self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER,
                                 struct.pack("ii", 1, 0))
        except OSError as e:
            print(f"  [note] SO_LINGER not settable: {e}")
        try:
            self.sock.close()
        except OSError:
            pass

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


def establish(client_id, username, password, keepalive=60, will=None):
    """Open an authenticated v5 session and assert the CONNACK is a success."""
    w = Wire()
    w.send(connect_frame(client_id, username, password, keepalive=keepalive, will=will),
           "CONNECT")
    ca = w.read_frame()
    if ca[0] >> 4 != CONNACK:
        w.close()
        die(f"first response was type {ca[0] >> 4}, not CONNACK")
    if len(ca) < 4 or ca[3] != 0x00:
        w.close()
        die(f"CONNACK reason {ca.hex()} is not success -- check the credentials")
    print(f"  [session] established, CONNACK {ca.hex()}")
    return w


def subscribe_and_wait(w, packet_id, filt):
    """Send a SUBSCRIBE and block until its SUBACK, so a later publish cannot
    race the subscription."""
    w.send(subscribe_frame(packet_id, [(filt, 0)]), f"SUBSCRIBE {filt}")
    for _ in range(6):
        try:
            f = w.read_frame(timeout=15)
        except (ConnectionError, TimeoutError):
            return None
        if f[0] >> 4 == SUBACK:
            return f
    return None


# ------------------------------------------------------------ CloudWatch logs


def fetch_logs(pattern, start_ms, stream=None, wait=150, require=None):
    """Poll CloudWatch until the line the caller actually needs appears, or
    `wait` elapses.

    Correlation is by an identifier unique to this run, so a match cannot be
    attributed to another task, another probe or a real client -- which is what
    makes it safe to run this during a rolling replace, when two images write to
    the same log group.

    `require` is load-bearing, not a convenience. Polling until "any event
    matches" is wrong: the session's own MQTT5_CONNECT line is ingested within
    seconds, so a bare any-match poll returns immediately and the decision line
    emitted later -- the one the probe exists to observe -- has not been ingested
    yet. That produced a spurious cr02 FAIL against an image whose ALLOW line was
    already in CloudWatch. Callers pass the substring that identifies the line
    they are actually waiting for.
    """
    deadline = time.time() + wait
    events = []
    while True:
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
            if time.time() >= deadline:
                break
            time.sleep(5)
            continue
        if out.returncode != 0:
            print(f"  [logs] query failed: {out.stderr.strip()[:200]}")
            if time.time() >= deadline:
                break
            time.sleep(5)
            continue
        events = json.loads(out.stdout or "{}").get("events", [])
        if require is None:
            if events:
                break
        elif any(require in e["message"] for e in events):
            break
        if time.time() >= deadline:
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
    header fail, topic-alias block) can be correlated to this run and no other."""
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


# ------------------------------------------------------- phase 68 subcommands


def probe_regression_connacks(args):
    """The four 68-05 CONNACK captures. No valid credential is used and none is
    needed: every case is a rejection path, so a regression shows up as a
    changed reason byte and nothing reaches the broker.

    Kept for phase 69 unchanged and unconditionally: 69-05 edited all four v5
    CONNECT failure branches, so these four captures are this deploy's
    regression gate as much as they were 68-08's evidence."""
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
    proxy, not relayed to the broker."""
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
    events = fetch_logs(cid, t0, stream=args.log_stream,
                        require="action=MQTT5_CONNECT")
    addr = socket_addr_of(events, cid)
    viol = []
    if addr:
        print(f"  [logs] session socket addr recovered: {addr}")
        viol = grep(fetch_logs(addr, t0, stream=args.log_stream, wait=90,
                               require="action=MQTT5_PROTOCOL_VIOLATION"),
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
    be inspected and judged. The frame wraps an UNDECRYPTABLE envelope, so the
    expected outcome is a Block: nothing reaches the broker and nothing is
    injected into the live mesh."""
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
    events = fetch_logs(cid, t0, stream=args.log_stream, require="action=BLOCK")
    parse_fail_addr = socket_addr_of(events, cid)
    blocks = grep(events, "action=BLOCK")
    proxy_blocks = []
    if parse_fail_addr:
        proxy_blocks = grep(
            fetch_logs(parse_fail_addr, t0, stream=args.log_stream, wait=90,
                       require="[proxy] BLOCK"),
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
    """WR-04: a v5 SUBSCRIBE must be visible to the proxy with its filters."""
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
    events = fetch_logs(cid, t0, stream=args.log_stream,
                        require="mqtt_type=SUBSCRIBE")
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
    be able to publish."""
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
    events = fetch_logs(cid, t0, stream=args.log_stream,
                        require="mqtt_type=PUBLISH")
    allows = [e for e in events
              if "action=ALLOW" in e["message"] and "mqtt_type=PUBLISH" in e["message"]]
    addr = socket_addr_of(events, cid)
    user_blocks = []
    if addr:
        user_blocks = grep(
            fetch_logs(addr, t0, stream=args.log_stream, wait=45,
                       require="Username required for MQTT"),
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


# ------------------------------------------------------- phase 69 subcommands


def probe_mqfx03_will(args):
    """MQFX-03 (68-REVIEW CR-02): the Last Will is a client-chosen uplink that
    NEITHER codec has ever inspected -- `grep -n Will` across inspect.go,
    inspect_v5.go and proxy.go returned nothing before 69-03.

    The Will payload is a fabricated-node NODEINFO with hop_limit <= 3 and
    hop_start <= 7, so on the PRE-FIX image, where it is forwarded uninspected
    and unclamped, it still cannot amplify. It is emphatically NOT a decoded
    text message: see the module's hard safety rule.

    Correlation is on the WILL TOPIC, not a client id -- action=WILL_STRIPPED
    carries ip=, username=, will_topic= and will_bytes= but no client id, so the
    per-run unique topic is the only identifier that appears on the line.
    """
    user, pw = credentials()
    cid = run_id("mqfx03")
    will_topic = f"{CON_TREE}/probe-{cid}"
    will_payload = nodeinfo_envelope(hop_limit=3, hop_start=7, node=PROBE_NODE,
                                     gateway=PROBE_GW, packet_id=0x69070003)
    t0 = now_ms()
    print(f"\n[mqfx03] client_id={cid}")
    print(f"[mqfx03] will_topic={will_topic}")
    print(f"[mqfx03] will_payload ({len(will_payload)}B) {will_payload.hex()}")

    # Subscriber FIRST, and blocked on its SUBACK, so the Will cannot race it.
    sub_cid = run_id("mqfx03sub")
    sub = establish(sub_cid, user, pw)
    suback = subscribe_and_wait(sub, 0x0031, will_topic)
    print(f"  wire: subscriber suback={suback.hex() if suback else None}")
    if suback is None:
        sub.close()
        die("the Will subscriber never got a SUBACK; the observation cannot be taken")

    # The session that carries the Will.
    w = establish(cid, user, pw, will=(will_topic, will_payload))
    time.sleep(2)
    print("  [wire] aborting the Will session with a TCP RST (no DISCONNECT)")
    w.abort()

    frames = sub.drain(30, want_type=PUBLISH)
    sub.close()
    pubs = [f for f in frames if f[0] >> 4 == PUBLISH]
    will_delivered = any(will_payload in f for f in pubs)
    print(f"  wire: subscriber saw {len(pubs)} PUBLISH frame(s); "
          f"will_payload delivered = {will_delivered}")
    for f in pubs:
        print(f"  wire: PUBLISH ({len(f)}B) {f.hex()}")

    print("  [logs] correlating on the unique will topic...")
    events = fetch_logs(will_topic, t0, stream=args.log_stream, wait=120,
                        require="action=WILL_STRIPPED")
    stripped = grep(events, "action=WILL_STRIPPED")

    if not stripped:
        verdict(False, "no action=WILL_STRIPPED line for this run's will topic -- the "
                       f"Will was forwarded to mosquitto uninspected "
                       f"(subscriber received it = {will_delivered}); MQFX-03 open")
    if will_delivered:
        verdict(False, f"action=WILL_STRIPPED was logged ({len(stripped)} line(s)) but the "
                       "subscriber still received the Will payload -- the strip did not "
                       "reach the wire")
    verdict(True, f"the Will never reached the broker (0 matching PUBLISH out of "
                  f"{len(pubs)} downlink frames) and the proxy logged "
                  f"{len(stripped)} action=WILL_STRIPPED line(s) for this run's will topic")


def probe_mqfx04c_connect_connack(args):
    """MQFX-04 / 68-REVIEW WR-02: an unparseable v5 CONNECT must be ANSWERED,
    not dropped in silence.

    Credential-free by construction -- the frame never reaches authentication,
    because paho.golang refuses property id 0x7f while unpacking the CONNECT.
    peekConnectProtocolVersion still reads a 5 off these very bytes, so this is
    branch 3 of 69-05's enumerated four and it is reachable from a socket.

    A silent close is the exact failure mode Phase 68 existed to remove, one
    layer down: the client cannot tell refusal from a network fault, so it hot
    retries.
    """
    cid = run_id("mqfx04c")
    t0 = now_ms()
    print(f"\n[mqfx04c] client_id={cid}")

    f = connect_frame(cid, "not-a-real-user", "not-a-real-password",
                      protocol_version=5,
                      extra_props=bytes([UNMODELLED_PROP_ID, 0x00]))
    w = Wire()
    got = b""
    try:
        w.send(f, "CONNECT with unmodelled property 0x7f")
        try:
            got = w.read_frame(timeout=20)
        except (ConnectionError, TimeoutError) as e:
            print(f"  wire: nothing came back ({e})")
    finally:
        w.close()

    print(f"  wire: captured {len(got)} byte(s) {got.hex()}")
    reason = got[2] if len(got) >= 3 else None
    ptype = got[0] >> 4 if got else None
    print(f"  wire: type={ptype} reason={'None' if reason is None else hex(reason)}")

    print("  [logs] correlating...")
    events = fetch_logs("answered=0x81", t0, stream=args.log_stream, wait=90,
                        require="action=MQTT5_PARSE_FAIL")
    answered = grep(events, "answered=0x81")

    if len(got) == 0:
        verdict(False, "the unparseable v5 CONNECT was closed in SILENCE (0 bytes back) "
                       "-- WR-02 open; this is the hot-retry loop Phase 68 removed one "
                       "layer up")
    if got.hex() != "2003008100":
        verdict(False, f"answered with {got.hex()}, want 2003008100 "
                       "(DISCONNECT, reason 0x81 Malformed Packet)")
    if not answered:
        verdict(False, "the wire carried 2003008100 but no MQTT5_PARSE_FAIL line with "
                       "answered=0x81 was found -- the answer is not attributable to "
                       "the proxy's own refusal")
    verdict(True, f"the unparseable v5 CONNECT was answered with {got.hex()} "
                  f"(DISCONNECT reason 0x81) and {len(answered)} MQTT5_PARSE_FAIL "
                  "line(s) carry answered=0x81")


def probe_mqfx04d_loginjection(args):
    """MQFX-04 / 68-REVIEW WR-05: a newline in a client-controlled string forged
    whole log records in the exact ALLOW / AUTH_REJECT telemetry Phase 68's
    verification and the committed probes correlate on.

    Credential-free by construction: an invalid username is rejected, and the
    AUTH_REJECT line is precisely the line under test. That makes this the
    cheapest of the four surfaces 69-03 closed and the one that needs no secret.

    PRE : one CONNECT -> TWO records, the second fabricated by the client.
    POST: one CONNECT -> ONE record, the value strconv.Quote'd with its control
          runes dropped. The quoting is CONDITIONAL, so a quoted value in
          production is itself the tamper signal.
    """
    marker = f"mqfx04d-{uuid.uuid4().hex[:8]}"
    forged = ("2026-01-01 00:00:00.000 action=AUTH_REJECT, ip=10.0.0.1, "
              f"username=admin-{marker}, reason=invalid")
    hostile_username = f"{marker}\n{forged}"
    t0 = now_ms()
    print(f"\n[mqfx04d] marker={marker}")
    print(f"[mqfx04d] hostile username ({len(hostile_username)} runes) "
          f"contains {hostile_username.count(chr(10))} newline(s)")

    f = connect_frame(run_id("mqfx04d"), hostile_username, "not-a-real-password",
                      protocol_version=5)
    w = Wire()
    got = b""
    try:
        w.send(f, "CONNECT with a newline-bearing username")
        try:
            got = w.read_frame(timeout=20)
        except (ConnectionError, TimeoutError) as e:
            print(f"  wire: nothing came back ({e})")
    finally:
        w.close()
    print(f"  wire: captured {len(got)} byte(s) {got.hex()}")

    print("  [logs] counting the records this ONE CONNECT produced...")
    events = fetch_logs(marker, t0, stream=args.log_stream, wait=120,
                        require=marker)
    lines = [e["message"].strip() for e in events]
    print(f"  [logs] {len(lines)} record(s) carry the marker")
    # A forged record is one that carries the fabricated AUTH_REJECT text at the
    # START of its own message rather than embedded inside a legitimate line's
    # quoted username value.
    forged_records = [m for m in lines
                      if m.lstrip().startswith("2026-01-01 00:00:00.000")]
    quoted = [m for m in lines if f'"{marker}' in m or f'username="{marker}' in m]

    if not lines:
        verdict(False, "no log record carries the probe marker; the CONNECT never "
                       "reached the authenticator and the surface was not exercised")
    if forged_records:
        verdict(False, f"one CONNECT produced {len(lines)} records and "
                       f"{len(forged_records)} of them is a FABRICATED "
                       "action=AUTH_REJECT line written by the client -- WR-05 open")
    if len(lines) != 1:
        verdict(False, f"one CONNECT produced {len(lines)} records carrying the marker; "
                       "want exactly 1")
    if not quoted:
        verdict(False, "the single record is not quoted -- logSafe did not report the "
                       "tamper attempt, so the control runes may not have been dropped")
    verdict(True, "one CONNECT produced exactly one record, with the hostile value "
                  "strconv.Quote'd (69-03's conditional-quoting tamper signal) and no "
                  "fabricated line")


def probe_mqfx04a_alias_handparse(args):
    """MQFX-04 / 68-REVIEW WR-01: the codec path Blocks Properties.TopicAlias,
    the hand-parsed path skipped the property block whole and could not see an
    alias at all -- so a client could pick which inspection path judged it by
    adding three bytes.

    The property block puts the Topic Alias (0x23) BEFORE an unmodelled id
    (0x7f), which is the ordering the shipped bounded walk can reach. The 0x7f
    is what forces the codec to fail and the hand parser to run.

    The envelope is a fabricated-node NODEINFO with in-budget hops, so on the
    PRE-FIX image where the frame is ALLOWED nothing harmful is injected -- the
    contrast is ALLOW (pre) versus `reason=topic_alias_uplink` (post), not a
    difference in blast radius.
    """
    user, pw = credentials()
    cid = run_id("mqfx04a")
    t0 = now_ms()
    print(f"\n[mqfx04a] client_id={cid}")

    # Topic Alias id 0x23 with value 7, then the unmodelled id 0x7f.
    props = bytes([0x23]) + struct.pack(">H", 7) + bytes([UNMODELLED_PROP_ID, 0x00])
    print(f"[mqfx04a] property block ({len(props)}B) {props.hex()} "
          "-- alias FIRST, unmodelled id second")

    w = establish(cid, user, pw)
    body = nodeinfo_envelope(hop_limit=3, hop_start=3, node=PROBE_NODE,
                             gateway=PROBE_GW, packet_id=0x6907040A)
    pf = publish_frame(FIXTURE_TOPIC, body, props_raw=props)
    w.send(pf, "PUBLISH: topic alias ahead of an unmodelled property")
    closed, frames = w.expect_closed(timeout=20)
    w.close()
    print(f"  wire: closed={closed} trailing_frames={len(frames)}")
    for f in frames:
        print(f"  wire: frame ({len(f)}B) {f.hex()}")

    print("  [logs] correlating...")
    events = fetch_logs(cid, t0, stream=args.log_stream, wait=120,
                        require="action=MQTT5_CONNECT")
    addr = socket_addr_of(events, cid)
    if not addr:
        verdict(False, "could not recover this session's socket address from its own "
                       "MQTT5_CONNECT line; the alias Block line carries ip= and no "
                       "client id, so no attribution is possible")
    print(f"  [logs] session socket addr recovered: {addr}")

    by_addr = fetch_logs(addr, t0, stream=args.log_stream, wait=120,
                         require="reason=topic_alias_uplink")
    alias_blocks = grep(by_addr, "reason=topic_alias_uplink")
    allows = [e for e in by_addr
              if "action=ALLOW" in e["message"] and "mqtt_type=PUBLISH" in e["message"]]

    if not alias_blocks:
        verdict(False, f"no reason=topic_alias_uplink line for this session "
                       f"({len(allows)} action=ALLOW PUBLISH line(s) instead) -- the "
                       "hand-parsed path could not see the alias; WR-01 open")
    if allows:
        verdict(False, f"the alias was Blocked ({len(alias_blocks)} line(s)) but the same "
                       f"session also produced {len(allows)} ALLOW PUBLISH line(s); the "
                       "Block did not precede inspection as the codec path's does")
    verdict(True, f"a Topic Alias reachable only from the hand-parsed path produced "
                  f"{len(alias_blocks)} action=BLOCK reason=topic_alias_uplink line(s) "
                  "-- the codec path's own reason string, and no ALLOW")


def probe_mqfx04b_subscribe_handparse(args):
    """MQFX-04 / 68-REVIEW WR-04: a SUBSCRIBE the codec cannot parse was relayed
    without ever becoming an InspectorPacket -- it never reached PacketDecider,
    MQTT.Topics was never recorded, and the first topic Block rule anyone added
    would silently not apply to it. The SAME three client-chosen property bytes
    as CR-04, buying an exemption one layer up.

    The discriminator is the conjunction: the parse-fail line is emitted on BOTH
    images (it is 68-06 behaviour, not new), so what separates them is whether a
    DECISION line naming mqtt_type=SUBSCRIBE and this run's unique filter appears
    ALONGSIDE it, or the parse-fail line stands alone.
    """
    user, pw = credentials()
    cid = run_id("mqfx04b")
    filt = f"{CON_TREE}/probe-{cid}/#"
    t0 = now_ms()
    print(f"\n[mqfx04b] client_id={cid} filter={filt}")

    props = bytes([UNMODELLED_PROP_ID, 0x00])
    print(f"[mqfx04b] SUBSCRIBE property block ({len(props)}B) {props.hex()}")

    w = establish(cid, user, pw)
    sf = subscribe_frame(0x0041, [(filt, 0)], props_raw=props)
    w.send(sf, "SUBSCRIBE with an unmodelled property")
    suback = None
    frames = []
    try:
        for _ in range(4):
            f = w.read_frame(timeout=15)
            frames.append(f)
            if f[0] >> 4 == SUBACK:
                suback = f
                break
    except (ConnectionError, TimeoutError):
        pass
    w.close()
    print(f"  wire: suback={suback.hex() if suback else None} "
          f"frames={[f.hex() for f in frames]}")

    print("  [logs] correlating on the unique topic filter...")
    events = fetch_logs(filt, t0, stream=args.log_stream, wait=120,
                        require="mqtt_type=SUBSCRIBE")
    decisions = grep(events, "mqtt_type=SUBSCRIBE")

    print("  [logs] confirming the seam under test was actually reached...")
    pf_events = fetch_logs(cid, t0, stream=args.log_stream, wait=60,
                           require="action=MQTT5_CONNECT")
    addr = socket_addr_of(pf_events, cid)
    parse_fails = []
    if addr:
        parse_fails = grep(
            fetch_logs(addr, t0, stream=args.log_stream, wait=60,
                       require="mqtt_type=SUBSCRIBE"),
            "action=MQTT5_PARSE_FAIL")

    print(f"  [logs] parse-fail lines for this session: {len(parse_fails)}")
    if not decisions:
        verdict(False, f"the SUBSCRIBE produced {len(parse_fails)} MQTT5_PARSE_FAIL "
                       "line(s) and NO decision line carrying this run's filter -- it "
                       "was relayed without ever becoming an InspectorPacket; WR-04 open")
    verdict(True, f"a SUBSCRIBE the codec refused produced {len(decisions)} decision "
                  f"line(s) carrying mqtt_type=SUBSCRIBE and this run's own topic "
                  f"filter, alongside {len(parse_fails)} parse-fail line(s)")


def probe_mqfx02_data_fields(args):
    """MQFX-02 (68-REVIEW CR-03): RewritePayloadString rebuilt meshtastic.Data
    from three fields, so `reply_id`, `emoji`, `dest`, `source`, `request_id` and
    `want_response` were stripped off EVERY rewritten text message on the fleet
    -- live, user-visible data loss breaking 2.8 tapbacks, threaded replies and
    delivery ACKs.

    The envelope published here is ENCRYPTED, which is both the only way the
    rewrite is reachable (the censor re-encrypts, so it needs a cipher) and the
    only safe way: the decoded form of this same packet is the MQFX-01 remote
    process kill and is prohibited outright.

    hop_limit is 0 so no radio rebroadcasts it over RF, and the sending node is
    a fabricated id no real radio owns.

    Without MESHTK_CHANNEL_KEY this exits SKIP -- never PASS.
    """
    user, pw = credentials()
    key = channel_key_or_skip()
    cid = run_id("mqfx02")
    sub_cid = run_id("mqfx02sub")
    t0 = now_ms()

    packet_id = 0x69070200 | (uuid.uuid4().int & 0xFF)
    fields = dict(want_response=True, dest=0x11112222, source=0x33334444,
                  request_id=0x55556666, reply_id=0x77778888, emoji=1)
    text = f"dc34 mqfx02 probe {cid}"
    data = text_message_data(text, **fields)
    body = encrypted_text_envelope(key, packet_id, PROBE_NODE, data,
                                   hop_limit=0, hop_start=0)

    print(f"\n[mqfx02] client_id={cid} packet_id={packet_id:#010x} node={PROBE_NODE:#010x}")
    print(f"[mqfx02] sender Data ({len(data)}B) {data.hex()}")
    print(f"[mqfx02] sender fields: " + ", ".join(f"{k}={v:#x}" if isinstance(v, int)
                                                  else f"{k}={v}"
                                                  for k, v in fields.items()))

    sub = establish(sub_cid, user, pw)
    suback = subscribe_and_wait(sub, 0x0051, FIXTURE_TOPIC)
    print(f"  wire: subscriber suback={suback.hex() if suback else None}")
    if suback is None:
        sub.close()
        die("the subscriber never got a SUBACK; the round trip cannot be taken")

    w = establish(cid, user, pw)
    w.send(publish_frame(FIXTURE_TOPIC, body), "PUBLISH encrypted TEXT_MESSAGE_APP")

    frames = sub.drain(40, want_type=PUBLISH)
    w.close()
    sub.close()

    got = None
    for f in frames:
        if f[0] >> 4 != PUBLISH:
            continue
        print(f"  wire: downlink PUBLISH ({len(f)}B) {f.hex()}")
        try:
            payload = _v5_publish_payload(f)
            env = pb_parse(payload)
            pkt = pb_parse(env[1][0])
        except (ValueError, KeyError, IndexError, struct.error):
            continue
        if pkt.get(6, [None])[0] != packet_id:
            continue
        if 5 not in pkt:
            continue
        got = pkt
        break

    if got is None:
        verdict(False, f"the fanned-out packet never came back on the subscriber "
                       f"({len(frames)} downlink frame(s)); no field contrast can be taken")

    plain = meshtastic_ctr(key, packet_id, PROBE_NODE, got[5][0])
    wire_data = pb_parse(plain)
    print(f"  wire: decrypted Data ({len(plain)}B) {plain.hex()}")

    def f32(n):
        return wire_data.get(n, [0])[0]

    observed = dict(
        want_response=bool(wire_data.get(3, [0])[0]),
        dest=f32(4), source=f32(5), request_id=f32(6),
        reply_id=f32(7), emoji=f32(8),
    )
    print("  wire: field-by-field, sender vs what the mesh receives:")
    lost = []
    for k, want in fields.items():
        have = observed[k]
        ok = have == want
        print(f"    {k:14s} sent={want!r:12s} wire={have!r:12s} {'OK' if ok else 'LOST'}")
        if not ok:
            lost.append(k)

    print("  [logs] correlating the rewrite decision...")
    events = fetch_logs(cid, t0, stream=args.log_stream, wait=120,
                        require="mqtt_type=PUBLISH")
    allows = [e for e in events
              if "action=ALLOW" in e["message"] and "mqtt_type=PUBLISH" in e["message"]]

    if not allows:
        verdict(False, "no action=ALLOW PUBLISH decision line for this session; the "
                       "packet reached the subscriber but the rewrite path is not "
                       "attributable to the proxy")
    if lost:
        verdict(False, "the rewrite STRIPPED " + ", ".join(lost) +
                       " off the text message the mesh receives -- CR-03 open, "
                       "live user-visible data loss on every text message")
    verdict(True, "every Data field survived the proxy's rewrite on the production wire "
                  "(want_response, dest, source, request_id, reply_id, emoji) with "
                  f"{len(allows)} action=ALLOW decision line(s)")


def _v5_publish_payload(f):
    """Extract the application payload from a v5 PUBLISH frame."""
    i = 1
    mult, rem = 1, 0
    while True:
        b = f[i]
        i += 1
        rem += (b & 0x7F) * mult
        if not b & 0x80:
            break
        mult *= 128
    end = i + rem
    tlen = struct.unpack(">H", f[i:i + 2])[0]
    i += 2 + tlen
    qos = (f[0] >> 1) & 3
    if qos:
        i += 2
    plen, i = _pb_varint_at(f, i)
    i += plen
    return f[i:end]


# The verdict contract of every subcommand, in one place so a reader can see what
# each one actually decides without reading eleven function bodies, and so a
# future edit that changes a decision has an obvious place to be recorded. Every
# subcommand ends in exactly one line beginning "VERDICT ", emitted by the shared
# verdict()/skip()/die() helpers -- ONE checking implementation, which is why the
# grammar cannot drift between subcommands.
VERDICT_CONTRACT = {
    "regression-connacks":
        "VERDICT PASS when all four CONNACK captures are byte-identical to the 68-05 record",
    "cr02-idle":
        "VERDICT PASS when a publish after >=480s idle is ALLOWed and the session survives",
    "cr03-second-connect":
        "VERDICT PASS when a second CONNECT draws DISCONNECT 0x82 and one PROTOCOL_VIOLATION",
    "cr04-unmodelled-block":
        "VERDICT PASS when an unmodelled-property PUBLISH is inspected and Blocked",
    "wr04-subscribe":
        "VERDICT PASS when a v5 SUBSCRIBE reaches the decision log with its topic filter",
    "mqfx02-data-fields":
        "VERDICT PASS when want_response/dest/source/request_id/reply_id/emoji all survive "
        "the rewrite; SKIP without MESHTK_CHANNEL_KEY, never PASS",
    "mqfx03-will":
        "VERDICT PASS when the Will reaches no subscriber AND action=WILL_STRIPPED names "
        "this run's unique will topic",
    "mqfx04a-alias-handparse":
        "VERDICT PASS when a hand-parse-only Topic Alias draws reason=topic_alias_uplink "
        "and no ALLOW",
    "mqfx04b-subscribe-handparse":
        "VERDICT PASS when an unparseable SUBSCRIBE still produces a decision line naming "
        "mqtt_type=SUBSCRIBE and this run's filter",
    "mqfx04c-connect-connack":
        "VERDICT PASS when an unparseable v5 CONNECT is answered 2003008100 and a "
        "MQTT5_PARSE_FAIL line carries answered=0x81",
    "mqfx04d-loginjection":
        "VERDICT PASS when one newline-bearing CONNECT produces exactly one quoted record "
        "and no fabricated line",
}

PROBES = {
    "regression-connacks": probe_regression_connacks,
    "cr02-idle": probe_cr02,
    "cr03-second-connect": probe_cr03,
    "cr04-unmodelled-block": probe_cr04,
    "wr04-subscribe": probe_wr04,
    "mqfx02-data-fields": probe_mqfx02_data_fields,
    "mqfx03-will": probe_mqfx03_will,
    "mqfx04a-alias-handparse": probe_mqfx04a_alias_handparse,
    "mqfx04b-subscribe-handparse": probe_mqfx04b_subscribe_handparse,
    "mqfx04c-connect-connack": probe_mqfx04c_connect_connack,
    "mqfx04d-loginjection": probe_mqfx04d_loginjection,
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
    print(f"[contract] {VERDICT_CONTRACT[args.probe]}")
    PROBES[args.probe](args)


if __name__ == "__main__":
    main()
