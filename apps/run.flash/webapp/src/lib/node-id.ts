/**
 * Node-ID derivation from the device's X25519 public key — PURE lib.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * Meshtastic 2.8 derives a node's number from its identity key, not its MAC:
 * whenever a keypair exists, the firmware recomputes `my_node_num =
 * crc32(public_key)` at boot (createNewIdentity / ensurePkiKeys). The old
 * MAC-derived number only survives on a device that has never generated keys.
 *
 * That breaks the naive read-during-handshake approach. A freshly flashed board
 * has NO keypair when the wizard's config-dump handshake runs, so `myNodeInfo.
 * myNodeNum` is still MAC-derived. The keypair is generated during the config
 * push that follows — so by the time the device reboots, it comes up under a
 * completely different node ID than the one the handshake reported.
 *
 * Observed live 2026-08-01 on a T-Deck Plus running 2.8.0.b4ff1df: the wizard
 * registered !a1cc1d70 (MAC) while the device joined the mesh as !66b5d888
 * (crc32 of its pubkey). The profile and the mesh disagreed, so meshtk could
 * not attribute the radio's traffic to its owner.
 *
 * Since the run.flash wizard pins 2.8.0.x firmware in BOTH slots (see
 * firmware-versions.json), any device it flashes will renumber this way — so
 * the public key read back after the config push is the authoritative source of
 * the node ID, and computing it beats reading a value that is about to change.
 *
 * NEVER log key material through this module — it only transforms, never emits.
 */

/**
 * IEEE 802.3 CRC-32 (the zlib/PNG polynomial, reflected 0xEDB88320).
 *
 * Byte-for-byte identical to Python's `zlib.crc32` and to the Meshtastic
 * firmware's `crc32Buffer()`, which is what makes the derived node number match
 * what the device actually boots with.
 *
 * The lookup table is built once on first use rather than shipped as a literal
 * — 256 entries of generated data would be noise in review, and the loop costs
 * microseconds on the one call this app makes per flash.
 *
 * @returns the CRC as a SIGNED 32-bit int (JS bitwise ops produce signed);
 *   apply `>>> 0` at the call site when an unsigned value is needed.
 */
export function crc32(bytes: Uint8Array): number {
  const table = getTable();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

let cachedTable: Uint32Array | null = null;

function getTable(): Uint32Array {
  if (cachedTable) return cachedTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  cachedTable = table;
  return table;
}

/**
 * The canonical "!hex" node ID a 2.8 device will boot with, given its X25519
 * public key.
 *
 * Format matches run.human's `canonicalNodeId()` exactly — lowercase, pad-8 —
 * because meshtk composes the DynamoDB pk via `fmt.Sprintf("!%08x", nodeNum)`
 * and a mismatched string means a missed GetItem.
 *
 * Returns `null` (never throws) when the key is absent, undecodable, or not
 * exactly 32 bytes. A null result means "cannot derive" and callers must fall
 * back to the handshake-reported node ID rather than register a guess.
 */
export function nodeIdFromPublicKeyBase64(base64: string): string | null {
  if (!base64) return null;

  let bytes: Uint8Array;
  try {
    const binary = atob(base64);
    bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }

  // X25519 public keys are exactly 32 bytes. Anything else is a truncated or
  // malformed SECURITY_CONFIG read — deriving from it would produce a
  // confidently wrong node ID, which is worse than falling back.
  if (bytes.length !== 32) return null;

  return "!" + crc32(bytes).toString(16).padStart(8, "0");
}
