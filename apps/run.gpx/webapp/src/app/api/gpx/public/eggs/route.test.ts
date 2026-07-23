import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The public egg-modal endpoint must ship its hardcoded defaults with zero CMS
 * dependency (so the modals work without a run.cms deploy), and a CMS override
 * must replace ONLY the editable fields (title/description/cover) while leaving
 * eyebrow/address/links/accent from the defaults. These tests pin both.
 *
 * With STRAPI_API_TOKEN unset (the vitest default), `fetchEggMeta` short-circuits
 * before any network call, so the first test exercises the pure defaults path.
 */

// Order matches DEFAULT_EGGS in route.ts. (lvcc-doubledown had been added
// there without updating this list — fixed alongside adding dc34-spot.)
const EXPECTED_IDS = [
  "lvcc-rebar",
  "lvcc-nuwu",
  "lvcc-doubledown",
  "lvcc-lvsign",
  "dc34-spot",
  "dc34-coffee",
];

type EggModal = {
  id: string;
  eyebrow: string;
  title: string;
  descriptionHtml: string;
  address?: string;
  coverImageUrl?: string;
  coverImageDisplayUrl?: string;
  links?: { label: string; url: string }[];
  accent?: string;
};

beforeEach(() => {
  vi.resetModules();
  vi.doUnmock("@/lib/strapi");
});

describe("GET /api/gpx/public/eggs", () => {
  it("ships all four hardcoded default eggs when the CMS is unconfigured", async () => {
    const { GET } = await import("./route");
    const res = await GET();
    const body = (await res.json()) as { eggs: EggModal[] };

    expect(body.eggs.map((e) => e.id)).toEqual(EXPECTED_IDS);
    for (const e of body.eggs) {
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.eyebrow.length).toBeGreaterThan(0);
      expect(e.descriptionHtml).toMatch(/^<p>/); // rendered, non-empty body
      expect(e.accent).toMatch(/^#[0-9A-Fa-f]{6}$/); // hardcoded hex accent
    }
    const coffee = body.eggs.find((e) => e.id === "dc34-coffee")!;
    expect(coffee.links?.[0]?.url).toContain("tripadvisor");
  });

  it("CMS overrides only the editable fields; defaults win elsewhere", async () => {
    vi.doMock("@/lib/strapi", () => ({
      fetchEggMeta: vi.fn(
        async () =>
          new Map([
            [
              "dc34-coffee",
              {
                title: "CMS Coffee",
                descriptionHtml: "<p>from the cms</p>",
                coverImageDisplayUrl: "https://cms.example/x.jpg",
              },
            ],
          ])
      ),
    }));

    const { GET } = await import("./route");
    const res = await GET();
    const body = (await res.json()) as { eggs: EggModal[] };
    const coffee = body.eggs.find((e) => e.id === "dc34-coffee")!;

    // Editable fields overridden by the CMS row.
    expect(coffee.title).toBe("CMS Coffee");
    expect(coffee.descriptionHtml).toBe("<p>from the cms</p>");
    expect(coffee.coverImageDisplayUrl).toBe("https://cms.example/x.jpg");
    // Non-editable fields preserved from the default.
    expect(coffee.eyebrow).toBe("Rabbit Fuel Stop");
    expect(coffee.address).toContain("Fremont");
    expect(coffee.links?.[0]?.url).toContain("tripadvisor");

    // An egg with no override is untouched.
    const rebar = body.eggs.find((e) => e.id === "lvcc-rebar")!;
    expect(rebar.title).toBe("ReBar");
  });
});
