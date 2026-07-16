import { describe, it, expect } from "vitest";
import {
  ringtoneForClass,
  resolveRingtone,
  RINGTONES,
  MAX_RINGTONE_LEN,
} from "./meshtastic";

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
  it("clamps to the length cap", () => {
    const long = "x:d=8:" + "c,".repeat(300);
    expect(resolveRingtone({ ringtone: long }).length).toBeLessThanOrEqual(
      MAX_RINGTONE_LEN
    );
  });
});
