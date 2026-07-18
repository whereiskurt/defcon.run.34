import { describe, it, expect } from "vitest";
import {
  ringtoneForClass,
  resolveRingtone,
  RINGTONES,
  MAX_RINGTONE_LEN,
} from "./meshtastic";
import { isValidRtttl } from "@/lib/rtttl";

describe("ringtoneForClass", () => {
  it("maps each class to its tune", () => {
    expect(ringtoneForClass("rabbit")).toBe(RINGTONES.rabbit);
    expect(ringtoneForClass("wildhare")).toBe(RINGTONES.wildhare);
    expect(ringtoneForClass("og")).toBe(RINGTONES.og);
    expect(ringtoneForClass("admin")).toBe(RINGTONES.admin);
  });
  it("falls back to rabbit for unknown/undefined", () => {
    expect(ringtoneForClass(undefined)).toBe(RINGTONES.rabbit);
    expect(ringtoneForClass("mystery")).toBe(RINGTONES.rabbit);
  });
});

describe("resolveRingtone", () => {
  it("prefers a non-empty per-user ringtone", () => {
    expect(resolveRingtone({ ringtone: "mine:d=8:c", mqttUsertype: "og" })).toBe(
      "mine:d=8:c"
    );
  });
  it("trims the per-user ringtone", () => {
    expect(resolveRingtone({ ringtone: "  mine:d=8:c  " })).toBe("mine:d=8:c");
  });
  it("falls back to class default when ringtone is empty/blank/null", () => {
    expect(resolveRingtone({ ringtone: "   ", mqttUsertype: "wildhare" })).toBe(
      RINGTONES.wildhare
    );
    expect(resolveRingtone({ ringtone: null, mqttUsertype: "admin" })).toBe(
      RINGTONES.admin
    );
    expect(resolveRingtone({ mqttUsertype: "og" })).toBe(RINGTONES.og);
  });
  it("falls back to rabbit with no info at all", () => {
    expect(resolveRingtone(undefined)).toBe(RINGTONES.rabbit);
    expect(resolveRingtone({})).toBe(RINGTONES.rabbit);
  });
  it("falls back to the class default (never truncates) when the personal tune exceeds the cap", () => {
    const long = "x:d=8:" + "c,".repeat(300);
    const resolved = resolveRingtone({ ringtone: long, mqttUsertype: "wildhare" });
    // Must NOT be a mid-note truncation of the personal tune -- it is the valid
    // class default instead.
    expect(resolved).toBe(RINGTONES.wildhare);
    expect(resolved.length).toBeLessThanOrEqual(MAX_RINGTONE_LEN);
  });

  it("falls back to the class default when the personal tune is malformed", () => {
    expect(resolveRingtone({ ringtone: "not a ringtone", mqttUsertype: "og" })).toBe(
      RINGTONES.og
    );
    expect(resolveRingtone({ ringtone: "name:d=8:zzz" })).toBe(RINGTONES.rabbit);
  });

  it("always resolves to a valid RTTTL", () => {
    expect(isValidRtttl(resolveRingtone(undefined))).toBe(true);
    expect(isValidRtttl(resolveRingtone({}))).toBe(true);
    expect(isValidRtttl(resolveRingtone({ ringtone: "", mqttUsertype: "admin" }))).toBe(
      true
    );
  });
});
