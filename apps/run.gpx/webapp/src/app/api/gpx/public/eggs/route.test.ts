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
  "dc34-deuce",
  "dc34-monorail",
  "dc34-coffee",
  "dc34-payphone",
  "dc34-payphone-sign",
  "dc34-payphone-rio",
  "dc34-payphone-doubledown",
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
    const deuce = body.eggs.find((e) => e.id === "dc34-deuce")!;
    expect(deuce.accent).toBe("#0067B1");
    expect((deuce as { titleUrl?: string }).titleUrl).toContain("rtcsnv.com");
    const mono = body.eggs.find((e) => e.id === "dc34-monorail")!;
    expect(mono.accent).toBe("#22D3EE");
    expect((mono as { titleUrl?: string }).titleUrl).toContain("lvmonorail.com");

    // Payphones: every booth has its bundled CC0 photo; only sign/rio carry
    // the ghost-mode graffiti clue (strat is the clean phone).
    type Graf = { coverGraffiti?: { text: string; tone: string } };
    const strat = body.eggs.find((e) => e.id === "dc34-payphone")!;
    const sign = body.eggs.find((e) => e.id === "dc34-payphone-sign")!;
    const rio = body.eggs.find((e) => e.id === "dc34-payphone-rio")!;
    expect(strat.coverImageDisplayUrl).toBe("/use1/payphones/strat.jpg");
    expect(sign.coverImageDisplayUrl).toBe("/use1/payphones/sign.jpg");
    expect(rio.coverImageDisplayUrl).toBe("/use1/payphones/rio.jpg");
    expect((strat as Graf).coverGraffiti).toBeUndefined();
    expect((sign as Graf).coverGraffiti).toEqual({ text: "1337", tone: "pink" });
    expect((rio as Graf).coverGraffiti).toEqual({ text: "696969", tone: "green" });
    const dd = body.eggs.find((e) => e.id === "dc34-payphone-doubledown")!;
    expect(dd.coverImageDisplayUrl).toBe("/use1/payphones/doubledown.jpg");
    expect((dd as Graf).coverGraffiti).toEqual({ text: "7425678", tone: "violet" });
    expect(dd.descriptionHtml).toContain("1-855-916-4636");
    // The dc34-payphone booth moved to ReBAR (was The Strat).
    expect(strat.address).toContain("ReBAR");
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
