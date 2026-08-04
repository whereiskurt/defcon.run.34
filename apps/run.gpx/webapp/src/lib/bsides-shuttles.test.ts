import { describe, it, expect } from "vitest";
import {
  shuttleFeatureCollection,
  shuttleColor,
  parseFeedDate,
  isStale,
  STALE_AFTER_MS,
  TUSCANY_ANCHOR,
  type ShuttleProperties,
} from "./bsides-shuttles";

/**
 * The B-Sides shuttle feed is a third party's fleet-tracking export. These tests
 * pin the two things that matter about the proxy: it must never republish the
 * vendor's device telemetry (serials, battery, tamper flags, street addresses),
 * and it must degrade to an empty collection rather than throwing, because the
 * map treats "no features" as a quiet layer and an exception as a broken one.
 *
 * FIXTURE is the verbatim upstream response captured 2026-08-04 from
 * geojson.aspx?action=shareinit&sid=175300 — two buses parked at the Tuscany.
 */
const FIXTURE = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-115.160808950166, 36.1127281496922] },
      id: "gps_985645",
      properties: {
        idx: 985645, name: "Shuttle1", model: "", sn: "8882424371", vin: "",
        grp: "Tracking", type: "FiftyFour", kmh: 0, spd: 0.0, hdg: 340, elev: 388,
        batt: 100, volts: -1.0, fuel: -1, notes: "",
        addy: "255 East Flamingo Road Las Vegas", date: "8/04/2026 12:45:00 PM",
        lowbatt: 0, lowfuel: 0, tamper: 0, cellsignal: 15, gpssignal: 7,
        temperature: null, cellassist: false, wired: true, visible: true,
        icon: "pink-bus/pink-bus-345.png", icow: 60,
      },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-115.160839566588, 36.1128090163072] },
      id: "gps_985646",
      properties: {
        idx: 985646, name: "Shuttle2", model: "", sn: "8882439337", vin: "",
        grp: "Tracking", type: "FiftyFour", kmh: 0, spd: 0.0, hdg: 59, elev: 391,
        batt: 100, volts: -1.0, fuel: -1, notes: "",
        addy: "255 East Flamingo Road Las Vegas", date: "8/04/2026 4:15:00 AM",
        lowbatt: 0, lowfuel: 0, tamper: 0, cellsignal: 15, gpssignal: 0,
        temperature: null, cellassist: false, wired: false, visible: true,
        icon: "orange-bus/orange-bus-60.png", icow: 60,
      },
    },
  ],
};

/** Every upstream key we must never emit. */
const FORBIDDEN_KEYS = [
  "sn", "vin", "batt", "volts", "fuel", "tamper", "lowbatt", "lowfuel",
  "cellsignal", "gpssignal", "addy", "notes", "grp", "model", "elev",
  "wired", "icow", "idx", "icon", "temperature", "cellassist", "visible", "spd",
];

describe("shuttleColor", () => {
  it("reads the livery color from the vendor icon path", () => {
    expect(shuttleColor("pink-bus/pink-bus-345.png").name).toBe("pink");
    expect(shuttleColor("orange-bus/orange-bus-60.png").name).toBe("orange");
  });

  it("returns a hex swatch for every recognized color", () => {
    expect(shuttleColor("pink-bus/pink-bus-345.png").hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(shuttleColor("orange-bus/orange-bus-60.png").hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("falls back to a neutral color instead of dropping an unknown livery", () => {
    // A color we have never seen must still render as a bus, just uncolored.
    const teal = shuttleColor("teal-bus/teal-bus-90.png");
    expect(teal.name).toBe("teal");
    expect(teal.hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
    for (const junk of [undefined, null, "", 42, "nonsense.png"]) {
      const c = shuttleColor(junk);
      expect(c.name).toBe("unknown");
      expect(c.hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

describe("parseFeedDate", () => {
  it("reads the feed's timezone-less stamp as Las Vegas wall-clock time", () => {
    // August is PDT (UTC-7): 12:45 PM local == 19:45 UTC.
    expect(parseFeedDate("8/04/2026 12:45:00 PM")).toBe(Date.parse("2026-08-04T19:45:00Z"));
    expect(parseFeedDate("8/04/2026 4:15:00 AM")).toBe(Date.parse("2026-08-04T11:15:00Z"));
  });

  it("handles noon and midnight without rolling the 12-hour clock", () => {
    expect(parseFeedDate("8/04/2026 12:00:00 PM")).toBe(Date.parse("2026-08-04T19:00:00Z"));
    expect(parseFeedDate("8/04/2026 12:00:00 AM")).toBe(Date.parse("2026-08-04T07:00:00Z"));
  });

  it("honors standard time outside DST", () => {
    // January is PST (UTC-8).
    expect(parseFeedDate("1/15/2026 12:45:00 PM")).toBe(Date.parse("2026-01-15T20:45:00Z"));
  });

  it("returns null for anything it cannot read", () => {
    for (const junk of [undefined, null, "", "not a date", 42, "13/45/2026 99:99:99 XM"]) {
      expect(parseFeedDate(junk)).toBeNull();
    }
  });
});

describe("isStale", () => {
  const now = Date.parse("2026-08-04T21:26:00Z");

  it("treats a recent fix as live", () => {
    expect(isStale(now - 60_000, now)).toBe(false);
  });

  it("treats a fix older than the threshold as stale", () => {
    expect(isStale(now - STALE_AFTER_MS - 1, now)).toBe(true);
  });

  it("treats a missing fix time as stale", () => {
    expect(isStale(null, now)).toBe(true);
  });
});

describe("shuttleFeatureCollection", () => {
  it("emits one feature per bus with its position and heading", () => {
    const fc = shuttleFeatureCollection(FIXTURE);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(2);

    const [a, b] = fc.features.map((f) => f.properties as unknown as ShuttleProperties);
    expect(a.id).toBe("gps_985645");
    expect(a.name).toBe("Shuttle1");
    expect(a.color).toBe("pink");
    expect(a.hdg).toBe(340);
    expect(a.kmh).toBe(0);
    expect(a.lastFixMs).toBe(Date.parse("2026-08-04T19:45:00Z"));

    expect(b.name).toBe("Shuttle2");
    expect(b.color).toBe("orange");
    expect(b.hdg).toBe(59);

    expect((fc.features[0].geometry as GeoJSON.Point).coordinates).toEqual([
      -115.160808950166, 36.1127281496922,
    ]);
  });

  it("never republishes the vendor's device telemetry", () => {
    const fc = shuttleFeatureCollection(FIXTURE);
    for (const f of fc.features) {
      const keys = Object.keys(f.properties ?? {});
      for (const forbidden of FORBIDDEN_KEYS) {
        expect(keys).not.toContain(forbidden);
      }
    }
    // Belt and braces: the serials must not survive anywhere in the payload.
    const serialized = JSON.stringify(fc);
    expect(serialized).not.toContain("8882424371");
    expect(serialized).not.toContain("8882439337");
    expect(serialized).not.toContain("255 East Flamingo");
  });

  it("anchors a bus that reports no usable position at the Tuscany", () => {
    const fc = shuttleFeatureCollection({
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: null, id: "gps_1", properties: { name: "Ghost", icon: "pink-bus/pink-bus-0.png" } },
        { type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, id: "gps_2", properties: { name: "Zero" } },
        { type: "Feature", geometry: { type: "Point", coordinates: ["x", "y"] }, id: "gps_3", properties: { name: "Junk" } },
      ],
    });
    expect(fc.features).toHaveLength(3);
    for (const f of fc.features) {
      expect((f.geometry as GeoJSON.Point).coordinates).toEqual(TUSCANY_ANCHOR);
    }
  });

  it("degrades to an empty collection rather than throwing", () => {
    for (const junk of [
      undefined, null, {}, [], "", 42,
      { type: "FeatureCollection" },
      { type: "FeatureCollection", features: null },
      { type: "FeatureCollection", features: "nope" },
      { type: "Whatever", features: [] },
    ]) {
      const fc = shuttleFeatureCollection(junk);
      expect(fc.type).toBe("FeatureCollection");
      expect(fc.features).toEqual([]);
    }
  });

  it("skips individual malformed features without losing the good ones", () => {
    const fc = shuttleFeatureCollection({
      type: "FeatureCollection",
      features: [null, "nope", 42, FIXTURE.features[0]],
    });
    expect(fc.features).toHaveLength(1);
    expect((fc.features[0].properties as unknown as ShuttleProperties).name).toBe("Shuttle1");
  });

  it("names an unnamed bus rather than emitting a blank label", () => {
    const fc = shuttleFeatureCollection({
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: { type: "Point", coordinates: [-115.16, 36.11] }, id: "gps_9", properties: {} }],
    });
    const p = fc.features[0].properties as unknown as ShuttleProperties;
    expect(p.name.length).toBeGreaterThan(0);
    expect(p.hdg).toBe(0);
    expect(p.lastFixMs).toBeNull();
  });
});
