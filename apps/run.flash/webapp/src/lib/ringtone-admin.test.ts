import { describe, it, expect } from "vitest";
import { Protobuf } from "@meshtastic/core";
import { fromBinary } from "@bufbuild/protobuf";
import { buildRingtoneAdminMessageBytes } from "./ringtone-admin";

describe("buildRingtoneAdminMessageBytes", () => {
  it("encodes an AdminMessage carrying the RTTTL as setRingtoneMessage", () => {
    const tune = "og:d=8,o=5,b=110:g,p,g,p,e,p,c,2g";
    const bytes = buildRingtoneAdminMessageBytes(tune);
    expect(bytes).toBeInstanceOf(Uint8Array);
    const decoded = fromBinary(Protobuf.Admin.AdminMessageSchema, bytes);
    expect(decoded.payloadVariant.case).toBe("setRingtoneMessage");
    expect(decoded.payloadVariant.value).toBe(tune);
  });
});
