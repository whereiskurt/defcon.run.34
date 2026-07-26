import { NextResponse } from "next/server";
import { fetchEggMeta } from "@/lib/strapi";

/**
 * GET /api/gpx/public/eggs — Public, UNAUTHENTICATED content for the map
 * easter-egg modals (rainbow arches + the PublicUs coffee cup).
 *
 * Ships with hardcoded `DEFAULT_EGGS` content so the modals render with zero CMS
 * dependency. A CMS editor overrides an egg's title / description / cover image
 * later by publishing a `Route` whose `gpxFileId` is the egg id — exactly the way
 * public routes are enriched (see `fetchEggMeta`). Everything else (eyebrow,
 * address, links, accent) always comes from the defaults here.
 *
 * The studio renders the returned modal on click (see gpx-studio `egg-modal.ts`).
 */

const CACHE_SECONDS = 300;

export type EggLink = { label: string; url: string };

export type EggModal = {
  id: string;
  eyebrow: string;
  title: string;
  titleUrl?: string; // when set, the title renders as a link (hardcoded-only, never from CMS)
  descriptionHtml: string; // server-safe HTML (hardcoded here, or blocksToHtml from CMS)
  address?: string;
  coverImageUrl?: string;
  coverImageDisplayUrl?: string;
  links?: EggLink[];
  accent?: string; // left-tab / link color (hex; hardcoded-only, never from CMS)
};

/** A Google Maps "search this point" link — honest, non-fabricated, and useful. */
function mapLink(lat: number, lon: number): EggLink {
  return { label: "Map it", url: `https://www.google.com/maps/search/?api=1&query=${lat},${lon}` };
}

/**
 * Hardcoded default modal content — ids match the studio geometry
 * (`RAINBOW_ARCHES[].id` and the coffee cup). This is what ships; CMS rows keyed
 * by these ids override title/description/cover later.
 */
const DEFAULT_EGGS: EggModal[] = [
  {
    id: "lvcc-rebar",
    eyebrow: "Rainbow Bridge",
    title: "ReBar",
    descriptionHtml:
      "<p>A pride-rainbow bridge lands in the Arts District at <strong>ReBar</strong> — " +
      "part dive bar, part antique shop, all of it for sale. Everything you're drinking " +
      "around has a price tag.</p>",
    address: "1225 S Main St, Las Vegas",
    accent: "#750787",
    links: [mapLink(36.1555, -115.1553)],
  },
  {
    id: "lvcc-nuwu",
    eyebrow: "Rainbow Bridge",
    title: "NuWu Cannabis Marketplace",
    titleUrl: "https://www.nuwumain.com/",
    descriptionHtml:
      "<p>The green bridge runs north to <strong>NuWu</strong> — the 24-hour dispensary " +
      "with the country's first cannabis drive-thru, on Las Vegas Paiute land above " +
      "downtown.</p>",
    address: "1235 Paiute Cir, Las Vegas",
    accent: "#1E7D22",
    links: [mapLink(36.1836, -115.1398)],
  },
  {
    id: "lvcc-doubledown",
    eyebrow: "Rainbow Bridge",
    title: "Double Down Saloon",
    titleUrl: "https://doubledownsaloon.com/",
    descriptionHtml:
      "<p>The blacked-out bridge drops you at the <strong>Double Down Saloon</strong> — " +
      "the self-proclaimed Happiest Place on Earth. 24-hour punk-rock dive, home of the " +
      "Bacon Martini and Ass Juice. House rule: you puke, you clean.</p>",
    address: "4640 Paradise Rd, Las Vegas",
    accent: "#9E9E9E",
    links: [mapLink(36.1049, -115.1516)],
  },
  {
    id: "lvcc-lvsign",
    eyebrow: "Rainbow Bridge",
    title: "Welcome to Fabulous Las Vegas",
    descriptionHtml:
      "<p>A pride arch to the <strong>1959 neon landmark</strong> at the south end of the " +
      "Strip. Blink and it's morning — this one's only up Thursday–Sunday at dawn unless " +
      "you've found the secret.</p>",
    address: "5100 Las Vegas Blvd S, Las Vegas",
    accent: "#E40303",
    links: [mapLink(36.0821, -115.1728)],
  },
  {
    id: "dc34-spot",
    eyebrow: "Rally Point",
    title: "🚨 The Spot",
    descriptionHtml:
      "<p>This is <strong>The Spot</strong> — the DEF CON run rally point at " +
      "<strong>LVCC West</strong>. Meet here at <strong>0600 daily</strong> during the " +
      "con; the rabbits leave from here.</p>",
    address: "LVCC West Hall, Las Vegas",
    accent: "#E11D48",
    links: [mapLink(36.135189, -115.158541)],
  },
  {
    id: "dc34-deuce",
    eyebrow: "Strip Transit",
    title: "🚌 The Deuce",
    titleUrl: "https://www.rtcsnv.com/ways-to-travel/routes-schedules/",
    descriptionHtml:
      "<p><strong>The Deuce</strong> — RTC's double-decker crawling Las Vegas Blvd " +
      "24/7, Fremont Street Experience to Mandalay Bay. A day pass buys you " +
      "air-conditioned recovery when your legs give out. Ride the top deck at " +
      "night; hop off at the Strat and walk it down like a rabbit.</p>",
    address: "Las Vegas Blvd, end to end",
    accent: "#0067B1",
    links: [mapLink(36.1473, -115.1553)],
  },
  {
    id: "dc34-monorail",
    eyebrow: "Strip Transit",
    title: "🚝 Las Vegas Monorail",
    titleUrl: "https://www.lvmonorail.com/",
    descriptionHtml:
      "<p>The <strong>Las Vegas Monorail</strong> glides the elevated guideway " +
      "behind the east-Strip casinos — SAHARA to MGM Grand in about 13 minutes, " +
      "every few minutes from 7am. The Convention Center station drops you at " +
      "the LVCC doorstep; hackers have been racing it on foot since forever.</p>",
    address: "SAHARA ↔ MGM Grand, east of the Strip",
    accent: "#22D3EE",
    links: [mapLink(36.13117, -115.15464)],
  },
  {
    id: "dc34-coffee",
    eyebrow: "Rabbit Fuel Stop",
    title: "☕ PublicUs",
    descriptionHtml:
      "<p>Grab a coffee on <strong>Fremont East</strong> before your run — the rabbits' " +
      "favourite fuel stop.</p>",
    address: "1126 Fremont St, Las Vegas",
    accent: "#5C3A21",
    links: [
      {
        label: "PublicUs on Tripadvisor",
        url: "https://www.tripadvisor.ca/Restaurant_Review-g45963-d7827155-Reviews-PublicUs-Las_Vegas_Nevada.html",
      },
    ],
  },
];

export async function GET() {
  try {
    const ids = DEFAULT_EGGS.map((e) => e.id);
    const overrides = await fetchEggMeta(ids); // best-effort; empty when CMS is down

    const eggs: EggModal[] = DEFAULT_EGGS.map((e) => {
      const o = overrides.get(e.id);
      if (!o) return e;
      // CMS overrides only the editable fields; defaults win where CMS is unset.
      return {
        ...e,
        title: o.title ?? e.title,
        descriptionHtml: o.descriptionHtml ?? e.descriptionHtml,
        coverImageUrl: o.coverImageUrl ?? e.coverImageUrl,
        coverImageDisplayUrl: o.coverImageDisplayUrl ?? e.coverImageDisplayUrl,
      };
    });

    return NextResponse.json(
      { eggs },
      {
        headers: {
          "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS}`,
        },
      }
    );
  } catch (error) {
    // Never fail the eggs on a CMS hiccup — ship the hardcoded defaults.
    console.error("Error listing egg modals:", error);
    return NextResponse.json({ eggs: DEFAULT_EGGS });
  }
}
