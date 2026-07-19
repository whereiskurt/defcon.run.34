/**
 * MeshRadio canonicalization + key-encoding — PURE lib (Phase 66, MRAD-02).
 *
 * The single source of the two write-boundary transforms every MeshRadio writer
 * (register-radio route plan 66-02, backfill plan 66-04, any future writer) must
 * apply identically:
 *
 *   1. nodeId canonicalization (L2): "!" + nodeNum.toString(16).padStart(8,"0")
 *      lowercase. flash pads hex to 8; manual-add historically did NOT, so a
 *      leading-zero nodeNum yielded <8 hex digits. meshtk composes the DynamoDB
 *      pk from a uint32 via fmt.Sprintf("!%08x", nodeNum) — the stored nodeId
 *      string must match byte-for-byte or the GetItem misses.
 *
 *   2. base64 X25519 pubkey → "0x" hex (L3, MRAD-02): the device key travels as
 *      base64 through run.flash and the embedded list, but meshtk's ParseHexKey
 *      (crypto.go) strips "0x" and hex.DecodeString → 32 bytes. Convert ONCE at
 *      the write boundary and validate the decode is exactly 32 bytes.
 *
 * ── Purity contract (L9) ───────────────────────────────────────────────────
 * This module imports NOTHING from the ElectroDB layer (no ./entities/client,
 * no @auth/dynamodb-adapter). It is safe to import from a bare `tsx` backfill
 * script, which the ESM-only adapter would otherwise break. Keep it dependency-
 * free (Node `Buffer` only) so both the Next.js route and a standalone script
 * reuse identical logic.
 *
 * NEVER log key material through this module — it only transforms, never emits.
 */

/**
 * Canonical "!hex" nodeId from a uint32 node number.
 *
 * "!" + (nodeNum >>> 0).toString(16).padStart(8, "0") — lowercase, pad-8 (L2).
 * `>>> 0` coerces to an unsigned 32-bit int so a negative or oversized input
 * still yields the 8-hex-digit form meshtk composes.
 *
 *   canonicalNodeId(0x433d1cec) === "!433d1cec"
 *   canonicalNodeId(0x00abcdef) === "!00abcdef"   // leading-zero byte preserved
 */
export function canonicalNodeId(nodeNum: number): string {
  const u32 = nodeNum >>> 0;
  return "!" + u32.toString(16).padStart(8, "0");
}

/**
 * uint32 node number from a nodeId. Strips a leading "!" and parses the hex as
 * an unsigned 32-bit int (mirrors mesh-map/route.ts hexToNodeNum:16-18).
 *
 *   nodeNumFromNodeId("!433d1cec") === 0x433d1cec
 *   nodeNumFromNodeId("00abcdef")  === 0x00abcdef
 */
export function nodeNumFromNodeId(nodeId: string): number {
  return parseInt(nodeId.replace(/^!/, ""), 16) >>> 0;
}

/**
 * Normalize an already-"!hex" id OR a bare hex string to the canonical pad-8
 * lowercase form, for callers holding a string nodeId (not a nodeNum). Routes
 * the string through nodeNum so padding/casing are applied consistently.
 *
 *   normalizeNodeId("abcdef")   === "!00abcdef"
 *   normalizeNodeId("!abcdef")  === "!00abcdef"
 *   normalizeNodeId("!433D1CEC") === "!433d1cec"
 */
export function normalizeNodeId(nodeId: string): string {
  return canonicalNodeId(nodeNumFromNodeId(nodeId));
}

/**
 * Convert a base64 X25519 public key to "0x" + 64 lowercase hex chars (L3).
 *
 * Asserts the decoded key is EXACTLY 32 bytes (V5 input validation) — a shorter
 * or longer decode throws a descriptive Error so the caller can reject it (400)
 * rather than persist a key meshtk's ParseHexKey would reject. Never logs the
 * key value.
 *
 *   publicKeyBase64ToHex(<32-byte base64>) === "0x" + <64 hex chars>
 */
export function publicKeyBase64ToHex(base64: string): string {
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length !== 32) {
    throw new Error(
      `MeshRadio publicKey must decode to 32 bytes, got ${bytes.length}`
    );
  }
  return "0x" + bytes.toString("hex");
}
