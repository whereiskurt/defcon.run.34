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

export function buildRingtoneAdminMessageBytes(rtttl: string): Uint8Array {
  const msg = create(Protobuf.Admin.AdminMessageSchema, {
    payloadVariant: { case: "setRingtoneMessage", value: rtttl },
  });
  return toBinary(Protobuf.Admin.AdminMessageSchema, msg);
}
