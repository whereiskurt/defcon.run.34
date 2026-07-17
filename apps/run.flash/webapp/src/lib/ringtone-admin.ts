/**
 * Build the serialized Meshtastic AdminMessage that sets the device ringtone
 * (RTTTL). @meshtastic/core exposes no setRingtone() helper, so we mirror its
 * own setCannedMessages pattern: create an AdminMessage with the
 * setRingtoneMessage variant and serialize it. The caller sends the bytes on
 * the ADMIN_APP port via device.sendPacket(bytes, PortNum.ADMIN_APP, "self").
 *
 * Kept OUT of lib/meshtastic.ts (a "use client" module that imports the
 * web-serial transport) so this stays pure + unit-testable in Node.
 */
import { Protobuf } from "@meshtastic/core";
import { create, toBinary } from "@bufbuild/protobuf";
import { isValidRtttl } from "@/lib/rtttl";

/**
 * Serialize an AdminMessage that sets the device ringtone.
 *
 * Refuses to build a message for an empty/malformed RTTTL: writing garbage on
 * the ADMIN_APP port and committing it has been implicated in device boot
 * failures. Callers should gate on isValidRtttl() and skip the push; this throw
 * is the last-line guarantee that no invalid tune is ever serialized.
 */
export function buildRingtoneAdminMessageBytes(rtttl: string): Uint8Array {
  if (!isValidRtttl(rtttl)) {
    throw new Error(
      `Refusing to build ringtone AdminMessage for invalid RTTTL: ${JSON.stringify(rtttl)}`
    );
  }
  const msg = create(Protobuf.Admin.AdminMessageSchema, {
    payloadVariant: { case: "setRingtoneMessage", value: rtttl },
  });
  return toBinary(Protobuf.Admin.AdminMessageSchema, msg);
}
