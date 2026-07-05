import { describe, it, expect } from "vitest";
import {
  PIN_ICONS,
  DEFAULT_PIN_ICON,
  pinIconById,
  isValidPinColor,
  canUsePinIcon,
  allowedPinIcons,
  resolveCheckInPin,
} from "../pin-icons";

const goldstar = pinIconById("goldstar")!;

describe("pin catalog", () => {
  it("has the default icon and unique ids", () => {
    expect(pinIconById(DEFAULT_PIN_ICON)).toBeDefined();
    expect(new Set(PIN_ICONS.map((i) => i.id)).size).toBe(PIN_ICONS.length);
  });

  it("gates secret icons on services", () => {
    expect(canUsePinIcon(goldstar, ["run"])).toBe(false);
    expect(canUsePinIcon(goldstar, ["run", "admin"])).toBe(true);
    expect(allowedPinIcons(["run"]).some((i) => i.id === "goldstar")).toBe(false);
    expect(allowedPinIcons(["admin"]).some((i) => i.id === "goldstar")).toBe(true);
  });

  it("validates colors as #rrggbb only", () => {
    expect(isValidPinColor("#e6007a")).toBe(true);
    expect(isValidPinColor("#FFD700")).toBe(true);
    expect(isValidPinColor("#fff")).toBe(false);
    expect(isValidPinColor("red")).toBe(false);
    expect(isValidPinColor('"><script>')).toBe(false);
    expect(isValidPinColor(undefined)).toBe(false);
  });
});

describe("resolveCheckInPin", () => {
  it("request wins over profile prefs", () => {
    expect(
      resolveCheckInPin(
        { pinIcon: "star", pinColor: "#00e5ff" },
        { pinIcon: "bunny", pinColor: "#e6007a" },
        ["run"]
      )
    ).toEqual({ pinIcon: "star", pinColor: "#00e5ff" });
  });

  it("falls back to profile prefs when request is empty or invalid", () => {
    expect(
      resolveCheckInPin(
        { pinIcon: "not-a-pin", pinColor: "magenta" },
        { pinIcon: "paw", pinColor: "#22c55e" },
        ["run"]
      )
    ).toEqual({ pinIcon: "paw", pinColor: "#22c55e" });
  });

  it("rejects secret icons without the gating service (falls back)", () => {
    expect(
      resolveCheckInPin({ pinIcon: "goldstar" }, undefined, ["run"]).pinIcon
    ).toBeUndefined();
    expect(
      resolveCheckInPin({ pinIcon: "goldstar" }, undefined, ["run", "admin"]).pinIcon
    ).toBe("goldstar");
  });

  it("rejects a secret icon lingering in profile prefs after access is revoked", () => {
    expect(
      resolveCheckInPin({}, { pinIcon: "goldstar", pinColor: "#ffd700" }, ["run"])
    ).toEqual({ pinIcon: undefined, pinColor: "#ffd700" });
  });

  it("stays fully unset for a default pin", () => {
    expect(resolveCheckInPin({}, undefined, ["run"])).toEqual({
      pinIcon: undefined,
      pinColor: undefined,
    });
  });
});
